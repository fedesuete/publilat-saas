// Web Push del Chat App (notificar al jugador con la PWA cerrada). Cola BullMQ PROPIA
// ("chat-push"), aislada de las colas de WhatsApp. Gateado por VAPID_*: sin claves, es no-op.
import webpush from "web-push";
import { Queue, Worker, type Job } from "bullmq";
import { prisma } from "./prisma.js";

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:soporte@publi.lat";

export function pushEnabled(): boolean {
  return Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
}
export function publicVapidKey(): string {
  return VAPID_PUBLIC;
}

if (pushEnabled()) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const parsed = new URL(REDIS_URL);
const connection = { host: parsed.hostname, port: Number(parsed.port || 6379), ...(parsed.password ? { password: parsed.password } : {}) };
const QUEUE = "chat-push"; // cola NUEVA, no toca las de WhatsApp

let queue: Queue | null = null;
let worker: Worker | null = null;

export interface PushPayload { title: string; body: string; url?: string }

// Envía a UNA suscripción; si el navegador la reporta expirada (404/410), la borra.
async function sendToSub(subId: string, payload: PushPayload): Promise<void> {
  const sub = await prisma.chatPushSub.findUnique({ where: { id: subId } });
  if (!sub) return;
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
    );
  } catch (e) {
    const status = (e as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) {
      await prisma.chatPushSub.delete({ where: { id: sub.id } }).catch(() => undefined); // sub muerto
    } else {
      console.warn("[chat-push] envío falló:", e instanceof Error ? e.message : String(e));
    }
  }
}

// Encola push a todas las suscripciones de un JUGADOR (mensaje del operador sin socket vivo).
export async function enqueuePlayerPush(userId: string, playerId: string, payload: PushPayload): Promise<void> {
  if (!pushEnabled()) return;
  const subs = await prisma.chatPushSub.findMany({ where: { userId, playerId }, select: { id: true } });
  await Promise.all(subs.map((s) => enqueue(s.id, payload)));
}

// Encola push a TODAS las suscripciones de una CUENTA (broadcast/promos del operador).
export async function enqueueAccountBroadcast(userId: string, payload: PushPayload): Promise<number> {
  if (!pushEnabled()) return 0;
  const subs = await prisma.chatPushSub.findMany({ where: { userId }, select: { id: true } });
  await Promise.all(subs.map((s) => enqueue(s.id, payload)));
  return subs.length;
}

async function enqueue(subId: string, payload: PushPayload): Promise<void> {
  if (queue) {
    await queue.add("push", { subId, payload }, { removeOnComplete: true, removeOnFail: 100, attempts: 3, backoff: { type: "exponential", delay: 3000 } });
  } else {
    void sendToSub(subId, payload); // fallback en proceso si la cola no arrancó (dev sin Redis)
  }
}

export async function initChatPushQueue(): Promise<void> {
  if (!pushEnabled() || queue) return;
  try {
    queue = new Queue(QUEUE, { connection });
    worker = new Worker(QUEUE, async (job: Job) => sendToSub(job.data.subId as string, job.data.payload as PushPayload), { connection });
    worker.on("failed", (job, err) => console.error(`[chat-push] job falló:`, err?.message, job?.id));
    console.log("[chat-push] cola de Web Push lista");
  } catch (e) {
    console.error("[chat-push] no se pudo iniciar la cola:", e instanceof Error ? e.message : String(e));
  }
}

export async function closeChatPushQueue(): Promise<void> {
  await worker?.close().catch(() => undefined);
  await queue?.close().catch(() => undefined);
  worker = null; queue = null;
}
