// Colas/jobs con BullMQ + Redis. Dos jobs repetibles:
//  - line-expiry: desactiva líneas vencidas (status -> inactive).
//  - capi-retry: reintenta los MetaEvent fallidos (reenvía el evento a Meta).
import { Queue, Worker, type Job } from "bullmq";
import { prisma } from "./prisma.js";
import { emitToUser } from "./io.js";
import { sendCapiEvent } from "./meta-capi.js";
import { resolveUserPixel } from "./pixel.js";
import { consumeDayAndActivate } from "./access.js";
import { getEngine } from "./wa-engine.js";
import { getPhoneQuality } from "./wa-cloud.js";
import { decryptSecret } from "./crypto.js";
import { notify } from "./notifications.js";
import { sendAdminMail } from "./mailer.js";
import { checkWaWebVersion } from "./wa-version.js";
import { alertLineDown, alertLowBalance } from "./line-alert.js";
import { alertCapiFailures } from "./capi-guard.js";

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
  // Poda de la tabla de idempotencia de webhooks: 2 días alcanzan de sobra (los eventos
  // duplicados llegan en segundos). Mantiene la tabla chica.
  await prisma.inboundDedup
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } } })
    .catch(() => undefined);
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
    if (!creds) continue; // sin pixel del cliente no hay a dónde reenviar (no gastamos intentos)
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
  // Avisa al cliente + admin si hay eventos que agotaron los reintentos (token/pixel roto).
  await alertCapiFailures().catch(() => undefined);
  return ok;
}

// Chequea la salud de cada línea activa: conexión (Baileys) y calidad (Cloud API).
// Guarda el estado y notifica al dueño si se desconecta o baja la calidad.
export async function checkLineHealth(): Promise<void> {
  // Chequeamos las activas Y las inactivas que siguen CONECTADAS (ej. una línea que se quedó
  // sin días pero su WhatsApp sigue vinculado): si esa se cae, el dueño igual debe enterarse.
  const lines = await prisma.waLine.findMany({
    where: { OR: [{ status: { not: "inactive" } }, { connected: true }] },
  });
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
        const state = await getEngine().connectionState(inst);
        connected = state === "open";
        if (line.connected && !connected) {
          // Auto-recuperación: sesiones que quedan trabadas en close/connecting suelen
          // volver con un restart de la instancia, SIN re-escanear el QR (flapping 428).
          console.log(`[line-health] línea ${line.id} en "${state}": intento restart automático`);
          const restarted = await getEngine().restartInstance(inst);
          if (restarted) {
            await new Promise((r) => setTimeout(r, 15000));
            connected = (await getEngine().connectionState(inst)) === "open";
          }
          if (!connected) {
            // Campana + email al dueño y admin (dedupe 6 h en el helper compartido).
            await alertLineDown(line);
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

// Vigila la versión de WhatsApp Web fijada en Evolution: si venció o vence en <=7 días,
// avisa a los admins (in-app + email). Una versión vencida hace que la sesión conecte y
// reciba pero los envíos se DESCARTEN en silencio — hay que renovarla antes de que pase.
export async function checkWaVersionJob(): Promise<void> {
  const st = await checkWaWebVersion();
  if (!st) return; // sin CONFIG_SESSION_PHONE_VERSION en el env, o fetch fallido: nada que hacer
  if (!st.needsAction) return;
  const detail =
    st.daysLeft === null
      ? `La versión fijada (${st.pinned}) YA NO FIGURA como vigente: lo más probable es que haya vencido y los envíos se estén descartando en silencio.`
      : `La versión fijada (${st.pinned}) vence en ${st.daysLeft} día${st.daysLeft === 1 ? "" : "s"} (${st.expiresAt?.toISOString().slice(0, 10)}).`;
  const body =
    `${detail}\n\nActualizá CONFIG_SESSION_PHONE_VERSION=${st.latest} en el .env del VPS ` +
    `(/opt/publilat/.env) y levantá Evolution de nuevo: docker compose -f docker-compose.vps.yml up -d evolution`;
  const title = "⚠️ Renovar la versión de WhatsApp Web (Evolution)";
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  let alerted = false;
  for (const a of admins) {
    // Aviso una vez cada 20 h por admin (el job corre varias veces al día).
    const recent = await prisma.notification.findFirst({
      where: { userId: a.id, title, createdAt: { gte: new Date(Date.now() - 20 * 60 * 60 * 1000) } },
      select: { id: true },
    });
    if (recent) continue;
    await notify(a.id, "system", title, body);
    alerted = true;
  }
  // El email acompaña al primer aviso in-app del día (o va solo si no hay admins en la DB).
  if (alerted || admins.length === 0) void sendAdminMail(title, body);
  console.warn(`[wa-version] ${detail}`);
}

// Avisa a los clientes ~10 h y ~3 h ANTES de que se les acabe el saldo, para que recarguen
// y su servicio no se corte. Solo avisa a quien NO tiene días para renovar (si tiene, la
// línea se renueva sola). Un aviso por CLIENTE (la línea que vence primero), con dedupe.
export async function checkLowBalance(): Promise<void> {
  const now = Date.now();
  const horizon = new Date(now + 10.5 * 60 * 60 * 1000); // miramos hasta ~10 h adelante
  const lines = await prisma.waLine.findMany({
    where: { status: "active", connected: true, expiresAt: { gt: new Date(now), lt: horizon } },
    select: { id: true, userId: true, label: true, phone: true, expiresAt: true },
  });
  // Por cliente, la línea que vence PRIMERO marca cuándo se frena su operación.
  const soonestByUser = new Map<string, (typeof lines)[number]>();
  for (const l of lines) {
    if (!l.expiresAt) continue;
    const cur = soonestByUser.get(l.userId);
    if (!cur || (cur.expiresAt && l.expiresAt < cur.expiresAt)) soonestByUser.set(l.userId, l);
  }
  for (const [userId, line] of soonestByUser) {
    // Si tiene días, la línea se renueva sola al vencer: no hace falta avisar.
    const credit = await prisma.credit.findUnique({ where: { userId }, select: { days: true } });
    if ((credit?.days ?? 0) >= 1) continue;
    const hoursLeft = (line.expiresAt!.getTime() - now) / (60 * 60 * 1000);
    const threshold = hoursLeft <= 3 ? 3 : hoursLeft <= 10 ? 10 : null;
    if (!threshold) continue;
    // Dedupe atómico por (cliente, umbral, vencimiento): un aviso por umbral y ciclo.
    const key = `lowbal:${userId}:${threshold}:${line.expiresAt!.toISOString().slice(0, 13)}`;
    try {
      await prisma.inboundDedup.create({ data: { key } });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") continue; // ya avisado
      continue;
    }
    await alertLowBalance({ id: line.id, userId, label: line.label, phone: line.phone }, hoursLeft);
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
        if (job.name === "low-balance") return checkLowBalance();
        if (job.name === "wa-version-check") return checkWaVersionJob();
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
    await queue.add("low-balance", {}, { repeat: { every: 1_800_000 }, jobId: "low-balance-repeat", removeOnComplete: true, removeOnFail: 50 });
    await queue.add("wa-version-check", {}, { repeat: { every: 43_200_000 }, jobId: "wa-version-check-repeat", removeOnComplete: true, removeOnFail: 50 });
    console.log("[queue] BullMQ listo (vencimiento 60s + CAPI 5min + salud 5min + saldo 30min + versión WA Web 12h)");
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
