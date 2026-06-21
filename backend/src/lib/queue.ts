// Colas/jobs con BullMQ + Redis (Fase 4). Hoy: vencimiento automático de líneas.
// Regla de negocio: 1 día = 1 línea activa por 24h. Al vencer (expiresAt), la línea
// sale de rotación (status -> inactive). No desconecta la sesión de WhatsApp.
import { Queue, Worker } from "bullmq";
import { prisma } from "./prisma.js";
import { emitToUser } from "./io.js";

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

// Arranca el worker y programa el chequeo periódico. Idempotente.
export async function initQueues(): Promise<void> {
  if (queue) return;
  try {
    queue = new Queue(QUEUE_NAME, { connection });
    worker = new Worker(QUEUE_NAME, async () => expireLines(), { connection });
    worker.on("failed", (_job, err) => console.error("[line-expiry] job falló:", err?.message));

    // Chequeo cada 60s. jobId fijo => no se duplica entre reinicios.
    await queue.add(
      "expire",
      {},
      { repeat: { every: 60_000 }, jobId: "expire-repeat", removeOnComplete: true, removeOnFail: 50 }
    );
    console.log("[queue] BullMQ listo (vencimiento de líneas cada 60s)");
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
