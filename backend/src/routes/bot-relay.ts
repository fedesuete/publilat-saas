// Puente cajero de un SOCIO (línea de Valentino). Rutas que el bot externo llama para (1) mandar un texto
// por la línea y (2) avisar una CARGA ya verificada para disparar el Purchase CAPI. Auth por token propio
// (header `x-bot-token` == env BOT_RELAY_TOKEN), NO Bearer. APAGADO sin token (503).
//
// Habilitado por pedido EXPLÍCITO del dueño (ver §9.6). NO acredita fichas ni maneja plata: el /purchase
// es solo la SEÑAL de marketing a Meta (value real, ya verificada del lado del socio contra el PSP).
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { sendToContact } from "../lib/wa-send.js";
import { markPurchase } from "../lib/purchase.js";

export const botRelayRouter = Router();

// Auth: header x-bot-token == BOT_RELAY_TOKEN (comparación timing-safe). Sin token configurado → 503.
function requireBotToken(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.BOT_RELAY_TOKEN;
  if (!expected) return res.status(503).json({ error: "bot-relay deshabilitado" });
  const got = req.get("x-bot-token") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "token inválido" });
  return next();
}

const sendSchema = z.object({
  lineId: z.string().min(1),
  phone: z.string().min(6),
  message: z.string().min(1).max(4096),
});

// POST /api/bot-relay/send — el bot manda un texto por la línea. Usa sendToContact (la MISMA vía del
// inbox): registra el saliente en la conversación y lo emite, así el chat se ve completo en el panel.
botRelayRouter.post("/send", requireBotToken, async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "input inválido" });
  const { lineId, phone, message } = parsed.data;
  try {
    const line = await prisma.waLine.findUnique({ where: { id: lineId }, select: { id: true, userId: true } });
    if (!line) return res.status(404).json({ error: "línea no encontrada" });
    const digits = phone.replace(/\D/g, "");
    let contact = await prisma.contact.findFirst({ where: { userId: line.userId, phone: digits }, orderBy: { createdAt: "desc" } });
    if (!contact) {
      contact = await prisma.contact.create({
        data: { userId: line.userId, externalId: crypto.randomUUID(), phone: digits, lineId: line.id, source: "wa", stage: "CONTACTADO" },
      });
    }
    const ok = await sendToContact(line.userId, contact.id, message);
    return res.json({ ok });
  } catch (e) {
    console.error("[bot-relay/send]", e instanceof Error ? e.message : String(e));
    return res.status(500).json({ error: "error interno" });
  }
});

const purchaseSchema = z.object({
  phone: z.string().min(6),
  amount: z.number().positive(),
  currency: z.string().min(2).max(8).optional(),
});

// POST /api/bot-relay/purchase — el bot avisa una carga YA verificada (plata real, matcheada contra el PSP
// antes de cargar) → dispara el Purchase CAPI con value=amount, por el mismo markPurchase que la detección
// de comprobantes. eventId ÚNICO por llamada para que Meta cuente cada carga (no dedup). NO acredita nada.
botRelayRouter.post("/purchase", requireBotToken, async (req, res) => {
  const parsed = purchaseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "input inválido" });
  const { phone, amount, currency } = parsed.data;
  try {
    const digits = phone.replace(/\D/g, "");
    // Resolvemos el tenant por el contacto cuya línea está en el forward (la del socio): así no cruzamos
    // cuentas ni dependemos de recibir el tenant en el body. Si no hay forward, caemos a match global.
    let forwardLineIds: string[] = [];
    try { forwardLineIds = Object.keys(JSON.parse(process.env.BOT_FORWARD || "{}")); } catch { forwardLineIds = []; }
    const contact = forwardLineIds.length
      ? await prisma.contact.findFirst({ where: { phone: digits, lineId: { in: forwardLineIds } }, orderBy: { createdAt: "desc" } })
      : await prisma.contact.findFirst({ where: { phone: digits }, orderBy: { createdAt: "desc" } });
    if (!contact) {
      console.warn("[bot-relay/purchase] sin contacto para el teléfono → no disparo Purchase");
      return res.json({ ok: true, skipped: "no_contact" }); // 200 igual: no queremos reintentos infinitos del bot
    }
    const eventId = `${contact.externalId}:relay:${Date.now()}`; // único por carga → Meta cuenta cada una
    const r = await markPurchase(contact.userId, contact.id, amount, currency ?? "ARS", { eventId });
    return res.json({ ok: !!r?.ok });
  } catch (e) {
    console.error("[bot-relay/purchase]", e instanceof Error ? e.message : String(e));
    return res.status(500).json({ error: "error interno" });
  }
});
