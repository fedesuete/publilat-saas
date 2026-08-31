// Motor de ENVÍOS MASIVOS: recorre la audiencia elegida y manda UNA variante al azar (texto o audio)
// por contacto, espaciando cada envío. Aditivo: reusa el mismo camino de envío que el Inbox y el
// auto-responder de leads (warmup incluido); no toca la atribución.
//
// El loop vive en memoria y persiste progreso en BulkCampaign. Si el proceso se reinicia, la campaña
// queda en "paused" al bootear (nunca sigue sola sin que alguien lo pida): mandar mensajes a gente
// real no es algo que deba reanudarse solo tras una caída.
import { prisma } from "./prisma.js";
import { emitToUser } from "./io.js";
import { parseVariants, pickVariant, sendLeadVariant } from "./leadgen-send.js";
import { renderLeadReply } from "./lead-template.js";

const running = new Set<string>(); // userIds con una corrida activa en ESTE proceso

export interface Audience { total: number; sample: Array<{ id: string; name: string | null; phone: string | null }> }

// Contactos que matchean los filtros de la campaña (los que recibirían el mensaje).
export async function audienceFor(c: {
  userId: string; audSource: string | null; audStage: string; audMaxDays: number | null; audLimit: number;
}, take?: number): Promise<Audience> {
  const where: Record<string, unknown> = {
    userId: c.userId,
    stage: c.audStage,
    phone: { not: null },
  };
  if (c.audSource) where.source = c.audSource;
  if (c.audMaxDays) where.createdAt = { gte: new Date(Date.now() - c.audMaxDays * 24 * 3600 * 1000) };
  const total = await prisma.contact.count({ where });
  const sample = await prisma.contact.findMany({
    where, orderBy: { createdAt: "desc" }, take: take ?? Math.min(c.audLimit, 10),
    select: { id: true, name: true, phone: true },
  });
  return { total, sample };
}

// Línea desde la que sale la campaña: la elegida (si sigue activa) o la activa menos usada.
async function pickLine(userId: string, preferred: string | null): Promise<string | null> {
  const base = { userId, connected: true, status: "active", NOT: { phone: "" }, expiresAt: { gt: new Date() } };
  if (preferred) {
    const p = await prisma.waLine.findFirst({ where: { ...base, id: preferred }, select: { id: true } });
    if (p) return p.id;
  }
  const any = await prisma.waLine.findFirst({ where: base, orderBy: { lastUsedAt: { sort: "asc", nulls: "first" } }, select: { id: true } });
  return any?.id ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Arranca la corrida. Devuelve el error si no puede arrancar; null si arrancó.
export async function startCampaign(userId: string): Promise<string | null> {
  if (running.has(userId)) return "La campaña ya está enviando.";
  const camp = await prisma.bulkCampaign.findUnique({ where: { userId } });
  if (!camp) return "No hay campaña configurada.";
  const variants = parseVariants(camp.variants);
  if (!variants.length) return "Cargá al menos un mensaje o audio antes de enviar.";
  const lineId = await pickLine(userId, camp.lineId);
  if (!lineId) return "No tenés ninguna línea de WhatsApp activa con días vigentes.";

  await prisma.bulkCampaign.update({
    where: { userId },
    data: { status: "running", sent: 0, failed: 0, lastRunAt: new Date(), lastError: null },
  });
  running.add(userId);
  void runLoop(userId, lineId).catch(async (e) => {
    console.error("[bulk] loop caído:", e instanceof Error ? e.message : String(e));
    running.delete(userId);
    await prisma.bulkCampaign.update({
      where: { userId }, data: { status: "paused", lastError: e instanceof Error ? e.message : String(e) },
    }).catch(() => undefined);
  });
  return null;
}

export async function stopCampaign(userId: string): Promise<void> {
  running.delete(userId); // el loop lo ve en el próximo ciclo y corta
  await prisma.bulkCampaign.update({ where: { userId }, data: { status: "paused" } }).catch(() => undefined);
}

// El loop: por cada contacto elegible manda una variante y espera el intervalo configurado.
async function runLoop(userId: string, lineId: string): Promise<void> {
  const camp = await prisma.bulkCampaign.findUnique({ where: { userId } });
  if (!camp) { running.delete(userId); return; }
  const variants = parseVariants(camp.variants);
  const { sample: destinatarios } = await audienceFor(camp, camp.audLimit);
  console.log(`[bulk] user ${userId}: ${destinatarios.length} destinatarios, ${variants.length} variantes`);

  let sent = 0, failed = 0;
  for (let i = 0; i < destinatarios.length; i++) {
    if (!running.has(userId)) { console.log("[bulk] detenida por el usuario"); break; }
    const c = destinatarios[i];
    // El contacto puede haber cambiado de etapa mientras tanto (le contestaron, lo movieron): re-chequeo.
    const fresh = await prisma.contact.findUnique({ where: { id: c.id }, select: { id: true, name: true, stage: true, lineId: true } });
    if (!fresh || fresh.stage !== camp.audStage) continue;
    if (fresh.lineId !== lineId) {
      await prisma.contact.update({ where: { id: c.id }, data: { lineId } }).catch(() => undefined);
    }
    const variant = pickVariant(variants)!;
    const lf = await prisma.leadForm.findFirst({ where: { contactId: c.id }, select: { answers: true } });
    const text = variant.kind === "text"
      ? renderLeadReply(variant.body, { name: fresh.name, phone: null, email: null, answers: Array.isArray(lf?.answers) ? (lf!.answers as Array<{ q: string; a: string }>) : [] })
      : undefined;
    let ok = false;
    try {
      ok = await sendLeadVariant(userId, c.id, variant, text);
    } catch (e) {
      console.error("[bulk] error enviando:", e instanceof Error ? e.message : String(e));
    }
    if (ok) {
      sent++;
      await prisma.contact.update({ where: { id: c.id }, data: { stage: "CONTACTADO" } }).catch(() => undefined);
    } else failed++;
    await prisma.bulkCampaign.update({ where: { userId }, data: { sent, failed } }).catch(() => undefined);
    emitToUser(userId, "bulk:progress", { sent, failed, total: destinatarios.length, status: "running" });

    if (i < destinatarios.length - 1 && running.has(userId)) {
      const min = Math.max(5, camp.pauseMinS);
      const max = Math.max(min, camp.pauseMaxS);
      await sleep((min + Math.random() * (max - min)) * 1000);
    }
  }
  running.delete(userId);
  await prisma.bulkCampaign.update({ where: { userId }, data: { status: "done", sent, failed } }).catch(() => undefined);
  emitToUser(userId, "bulk:progress", { sent, failed, total: destinatarios.length, status: "done" });
  console.log(`[bulk] user ${userId} terminó: ${sent} enviados, ${failed} fallidos`);
}

export function isRunning(userId: string): boolean {
  return running.has(userId);
}
