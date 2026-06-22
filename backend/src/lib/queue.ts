// Colas/jobs con BullMQ + Redis. Dos jobs repetibles:
//  - line-expiry: desactiva líneas vencidas (status -> inactive).
//  - capi-retry: reintenta los MetaEvent fallidos (reenvía el evento a Meta).
import { Queue, Worker, type Job } from "bullmq";
import { prisma } from "./prisma.js";
import { emitToUser } from "./io.js";
import { sendCapiEvent } from "./meta-capi.js";
import { resolveUserPixel } from "./pixel.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const parsed = new URL(REDIS_URL);
const connection = {
  host: parsed.hostname,
  port: Number(parsed.port || 6379),
  ...(parsed.password ? { password: parsed.password } : {}),
};

const QUEUE_NAME = "line-expiry";

let queue: Queue | null = null;
let worker: Worker | null = null;

// Desactiva las líneas vencidas y avisa por socket. Devuelve cuántas venció.
export async function expireLines(): Promise<number> {
  const now = new Date();
  const expired = await prisma.waLine.findMany({
    where: { status: "active", expiresAt: { lt: now } },
    select: { id: true, userId: true, connected: true },
  });
  for (const l of expired) {
    await prisma.waLine.update({ where: { id: l.id }, data: { status: "inactive" } });
    emitToUser(l.userId, "wa:status", { lineId: l.id, state: "expired", connected: l.connected });
  }
  if (expired.length) console.log(`[line-expiry] desactivadas ${expired.length} línea(s)`);
  return expired.length;
}

// Reintenta los MetaEvent fallidos (últimas 24h). Reconstruye el evento desde el Contact
// y lo reenvía con el pixel del usuario. Marca "sent" al lograrlo. Idempotente: Meta
// deduplica por event_id, así que reintentar no genera doble conteo.
export async function retryFailedCapi(): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const failed = await prisma.metaEvent.findMany({
    where: { status: "failed", createdAt: { gte: since }, contactId: { not: null } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  let ok = 0;
  for (const ev of failed) {
    const contact = await prisma.contact.findUnique({ where: { id: ev.contactId! } });
    if (!contact) continue;
    const eventName: "Lead" | "Purchase" = ev.eventName === "Purchase" ? "Purchase" : "Lead";
    const creds = await resolveUserPixel(ev.userId, eventName);
    try {
      const result = await sendCapiEvent({
        eventName,
        externalId: contact.externalId,
        fbp: contact.fbp ?? undefined,
        fbc: contact.fbc ?? undefined,
        phone: contact.phone ?? undefined,
        eventSourceUrl: contact.landingUrl ?? undefined,
        pixelId: creds?.pixelId,
        capiToken: creds?.capiToken,
        ...(eventName === "Purchase"
          ? { value: (contact.amount ?? 0) / 100, currency: "ARS", eventId: `${contact.externalId}:purchase` }
          : { eventId: contact.externalId }),
      });
      await prisma.metaEvent.update({
        where: { id: ev.id },
        data: { status: "sent", pixelId: result.pixelId, payload: result.payload as object, response: result.response as object },
      });
      ok++;
    } catch {
      /* queda failed; se reintenta en el próximo ciclo (hasta 24h) */
    }
  }
  if (ok) console.log(`[capi-retry] reenviados ${ok}/${failed.length} evento(s)`);
  return ok;
}

// Arranca el worker y programa los chequeos periódicos. Idempotente.
export async function initQueues(): Promise<void> {
  if (queue) return;
  try {
    queue = new Queue(QUEUE_NAME, { connection });
    worker = new Worker(
      QUEUE_NAME,
      async (job: Job) => (job.name === "capi-retry" ? retryFailedCapi() : expireLines()),
      { connection }
    );
    worker.on("failed", (job, err) => console.error(`[queue:${job?.name}] job falló:`, err?.message));

    // jobId fijo => no se duplica entre reinicios.
    await queue.add("expire", {}, { repeat: { every: 60_000 }, jobId: "expire-repeat", removeOnComplete: true, removeOnFail: 50 });
    await queue.add("capi-retry", {}, { repeat: { every: 300_000 }, jobId: "capi-retry-repeat", removeOnComplete: true, removeOnFail: 50 });
    console.log("[queue] BullMQ listo (vencimiento 60s + reintento CAPI 5min)");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[queue] no se pudo iniciar BullMQ (¿Redis arriba?):", msg);
  }
}

// Cierra worker y cola para un shutdown limpio.
export async function closeQueues(): Promise<void> {
  await worker?.close().catch(() => undefined);
  await queue?.close().catch(() => undefined);
  worker = null;
  queue = null;
}
