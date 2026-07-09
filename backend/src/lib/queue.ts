// Colas/jobs con BullMQ + Redis. Dos jobs repetibles:
//  - line-expiry: desactiva líneas vencidas (status -> inactive).
//  - capi-retry: reintenta los MetaEvent fallidos (reenvía el evento a Meta).
import { Queue, Worker, type Job } from "bullmq";
import { prisma } from "./prisma.js";
import { emitToUser } from "./io.js";
import { sendCapiEvent } from "./meta-capi.js";
import { resolveUserPixel } from "./pixel.js";
import { consumeDayAndActivate } from "./access.js";
import { connectionState, restartInstance } from "./evolution.js";
import { getPhoneQuality } from "./wa-cloud.js";
import { decryptSecret } from "./crypto.js";
import { notify } from "./notifications.js";

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

// Procesa las líneas vencidas: si el usuario aún tiene días, renueva 24h (consume 1 día);
// si no, la desactiva. Modelo: 1 día = 1 línea activa por 24h. Devuelve cuántas desactivó.
export async function expireLines(): Promise<number> {
  const now = new Date();
  const expired = await prisma.waLine.findMany({
    where: { status: "active", expiresAt: { lt: now } },
    select: { id: true, userId: true, connected: true, label: true },
  });
  let deactivated = 0;
  for (const l of expired) {
    // Solo renueva líneas conectadas (las desconectadas no consumen días).
    if (l.connected) {
      const renewed = await consumeDayAndActivate(l.userId, l.id, l.label);
      if (renewed) {
        emitToUser(l.userId, "wa:status", { lineId: l.id, state: "renewed", connected: true });
        continue;
      }
    }
    await prisma.waLine.update({ where: { id: l.id }, data: { status: "inactive" } });
    emitToUser(l.userId, "wa:status", { lineId: l.id, state: "expired", connected: l.connected });
    deactivated++;
  }
  if (deactivated) console.log(`[line-expiry] desactivadas ${deactivated} línea(s) sin crédito`);
  return deactivated;
}

// Reintenta los MetaEvent fallidos (últimas 24h). Reconstruye el evento desde el Contact
// y lo reenvía con el pixel del usuario. Marca "sent" al lograrlo. Idempotente: Meta
// deduplica por event_id, así que reintentar no genera doble conteo.
const CAPI_MAX_ATTEMPTS = 5;

// Reintenta los eventos CAPI fallidos. Por defecto solo los que no superaron el tope de
// intentos (los que sí = "dead-letter", se reprocesan a mano desde el admin con includeDead).
export async function retryFailedCapi(opts?: { includeDead?: boolean; max?: number }): Promise<number> {
  const failed = await prisma.metaEvent.findMany({
    where: {
      status: "failed",
      contactId: { not: null },
      ...(opts?.includeDead ? {} : { attempts: { lt: CAPI_MAX_ATTEMPTS } }),
    },
    orderBy: { createdAt: "asc" },
    take: opts?.max ?? 50,
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
        data: { status: "sent", attempts: { increment: 1 }, pixelId: result.pixelId, payload: result.payload as object, response: result.response as object },
      });
      ok++;
    } catch (e) {
      // Suma un intento; al llegar al tope queda dead-letter (no se reintenta más solo).
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.metaEvent.update({
        where: { id: ev.id },
        data: { attempts: { increment: 1 }, response: { error: msg } },
      });
    }
  }
  if (ok) console.log(`[capi-retry] reenviados ${ok}/${failed.length} evento(s)`);
  return ok;
}

// Chequea la salud de cada línea activa: conexión (Baileys) y calidad (Cloud API).
// Guarda el estado y notifica al dueño si se desconecta o baja la calidad.
export async function checkLineHealth(): Promise<void> {
  const lines = await prisma.waLine.findMany({ where: { status: { not: "inactive" } } });
  for (const line of lines) {
    // Número externo: no hay sesión propia que monitorear (el WhatsApp vive en otro sistema).
    if (line.provider === "external") continue;
    try {
      let connected = line.connected;
      let quality = line.qualityRating;
      if (line.provider === "cloud") {
        if (line.wabaPhoneNumberId && line.accessToken) {
          const q = await getPhoneQuality(line.wabaPhoneNumberId, decryptSecret(line.accessToken));
          if (q?.qualityRating) {
            const prev = line.qualityRating;
            quality = q.qualityRating;
            if (quality !== prev && (quality === "RED" || quality === "YELLOW")) {
              await notify(line.userId, "line_quality", `Calidad de línea ${quality === "RED" ? "ROJA" : "AMARILLA"}`,
                `La calidad de "${line.label ?? line.phone}" bajó a ${quality}. Cuidá la frecuencia/contenido para no perder el número.`);
            }
          }
        }
      } else {
        const inst = line.sessionId ?? `line_${line.id}`;
        const state = await connectionState(inst);
        connected = state === "open";
        if (line.connected && !connected) {
          // Auto-recuperación: sesiones que quedan trabadas en close/connecting suelen
          // volver con un restart de la instancia, SIN re-escanear el QR (flapping 428).
          console.log(`[line-health] línea ${line.id} en "${state}": intento restart automático`);
          const restarted = await restartInstance(inst);
          if (restarted) {
            await new Promise((r) => setTimeout(r, 15000));
            connected = (await connectionState(inst)) === "open";
          }
          if (!connected) {
            await notify(line.userId, "line_down", "Línea desconectada",
              `Tu WhatsApp "${line.label ?? line.phone}" se desconectó. Intentamos reconectar automáticamente; si sigue caída, entrá a WhatsApp y tocá "Conectar / Ver QR".`);
          }
        }
      }
      await prisma.waLine.update({ where: { id: line.id }, data: { connected, qualityRating: quality ?? null, lastCheckedAt: new Date() } });
      emitToUser(line.userId, "wa:health", { lineId: line.id, connected, qualityRating: quality ?? null });
    } catch (e) {
      console.error("[line-health] error en línea", line.id, e instanceof Error ? e.message : String(e));
    }
  }
}

// Programa la reanudación de una secuencia tras un delay (para el motor de automatizaciones).
export function scheduleFlowResume(runId: string, delaySec: number): void {
  if (queue) {
    void queue.add("flow-resume", { runId }, { delay: delaySec * 1000, removeOnComplete: true, removeOnFail: 50 });
  } else {
    // Fallback en proceso si la cola no está lista (dev sin Redis).
    setTimeout(() => { void import("./flow-engine.js").then((m) => m.resumeFlowRun(runId)).catch(() => undefined); }, delaySec * 1000);
  }
}

// Arranca el worker y programa los chequeos periódicos. Idempotente.
export async function initQueues(): Promise<void> {
  if (queue) return;
  try {
    queue = new Queue(QUEUE_NAME, { connection });
    worker = new Worker(
      QUEUE_NAME,
      async (job: Job) => {
        if (job.name === "capi-retry") return retryFailedCapi();
        if (job.name === "line-health") return checkLineHealth();
        if (job.name === "flow-resume") {
          const { resumeFlowRun } = await import("./flow-engine.js");
          return resumeFlowRun(job.data.runId as string);
        }
        return expireLines();
      },
      { connection }
    );
    worker.on("failed", (job, err) => console.error(`[queue:${job?.name}] job falló:`, err?.message));

    // jobId fijo => no se duplica entre reinicios.
    await queue.add("expire", {}, { repeat: { every: 60_000 }, jobId: "expire-repeat", removeOnComplete: true, removeOnFail: 50 });
    await queue.add("capi-retry", {}, { repeat: { every: 300_000 }, jobId: "capi-retry-repeat", removeOnComplete: true, removeOnFail: 50 });
    await queue.add("line-health", {}, { repeat: { every: 300_000 }, jobId: "line-health-repeat", removeOnComplete: true, removeOnFail: 50 });
    console.log("[queue] BullMQ listo (vencimiento 60s + reintento CAPI 5min + salud de línea 5min)");
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
