// Iniciar una conversación de WhatsApp DESDE CERO con un número que nunca escribió (pedido del
// dueño 2026-09-13). Hasta ahora el Inbox sólo mostraba charlas que empezaba el cliente: si querías
// escribirle vos a alguien, había que hacerlo del celular y el CRM no se enteraba.
//
// ADITIVO a propósito: NO toca inbox.ts ni el flujo de atribución (§9.6). Reusa el mismo camino de
// envío del panel (sendToContact → gate de calentamiento → Message → emit al Inbox), así la charla
// aparece en el Inbox y en el CRM igual que cualquier otra.
//
// Antes de crear nada VERIFICA contra WhatsApp que el número exista (y corrige el "9" argentino que
// falta): sin eso nacían contactos fantasma y los mensajes se iban al vacío figurando "enviado"
// (incidente de los 46 envíos perdidos, 2026-08-31).
import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { sendToContact } from "../lib/wa-send.js";
import { resolveWhatsAppNumber } from "../lib/leadgen-send.js";

export const nuevoChatRouter = Router();

const schema = z.object({
  phone: z.string().min(6).max(30),
  name: z.string().trim().max(80).optional(),
  message: z.string().trim().min(1).max(4000),
  lineId: z.string().max(40).optional(), // opcional: desde qué línea escribir
});

// Últimos 8 dígitos: alcanza para reconocer a la misma persona aunque el número esté guardado con o
// sin el "9" argentino, con 0 adelante o con el 15 viejo.
const cola8 = (p: string) => p.replace(/\D/g, "").slice(-8);

// POST /api/nuevo-chat — crea (o reusa) el contacto y manda el primer mensaje.
nuevoChatRouter.post("/", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Completá el número y el mensaje." });
  }
  const userId = req.userId!;
  const { name, message } = parsed.data;
  const phoneRaw = parsed.data.phone.replace(/\D/g, "");
  if (phoneRaw.length < 6) return res.status(400).json({ error: "Ese número no parece válido." });

  // 1) Línea desde la que se escribe: la elegida (si es suya y está viva) o la activa menos usada.
  const base = { userId, connected: true, status: "active", NOT: { phone: "" }, expiresAt: { gt: new Date() } };
  const line =
    (parsed.data.lineId
      ? await prisma.waLine.findFirst({ where: { ...base, id: parsed.data.lineId }, select: { id: true, sessionId: true, provider: true } })
      : null) ??
    (await prisma.waLine.findFirst({
      where: base,
      orderBy: { lastUsedAt: { sort: "asc", nulls: "first" } },
      select: { id: true, sessionId: true, provider: true },
    }));
  if (!line) {
    return res.status(400).json({ error: "No tenés ninguna línea de WhatsApp conectada con días vigentes.", code: "line_required" });
  }

  // 2) ¿El número tiene WhatsApp? Corrige de paso el "9" que falta en los números argentinos.
  const chequeo = line.provider === "cloud"
    ? ({ estado: "sin_chequeo" } as const)
    : await resolveWhatsAppNumber(phoneRaw, line.sessionId);
  if (chequeo.estado === "no_existe") {
    return res.status(400).json({ error: "Ese número no tiene WhatsApp. Revisalo y probá de nuevo.", code: "sin_whatsapp" });
  }
  const phone = chequeo.estado === "ok" ? chequeo.phone : phoneRaw;
  const waJid = chequeo.estado === "ok" ? chequeo.chatId : null;

  // 3) ¿Ya lo tenemos? Si existe, NO duplicamos: se reusa su ficha y su historial.
  const existentes = await prisma.contact.findMany({
    where: { userId, phone: { not: null } },
    select: { id: true, phone: true, waJid: true, name: true, lineId: true },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  const objetivo = cola8(phone);
  let contact =
    existentes.find((c) => waJid && c.waJid === waJid) ??
    existentes.find((c) => c.phone && cola8(c.phone) === objetivo) ??
    null;
  const yaExistia = !!contact;

  if (!contact) {
    const creado = await prisma.contact.create({
      data: {
        userId,
        externalId: crypto.randomUUID(),
        phone,
        ...(waJid ? { waJid } : {}),
        ...(name ? { name } : {}),
        lineId: line.id,
        source: "manual", // lo empezamos NOSOTROS (no vino de anuncio ni de formulario)
        stage: "CONTACTADO",
      },
      select: { id: true, phone: true, waJid: true, name: true, lineId: true },
    });
    contact = creado;
  } else {
    // Completa lo que falte sin pisar lo que ya había (el alias del cliente manda).
    const patch: Record<string, unknown> = {};
    if (waJid && !contact.waJid) patch.waJid = waJid;
    if (!contact.lineId) patch.lineId = line.id;
    if (name && !contact.name) patch.name = name;
    if (Object.keys(patch).length) await prisma.contact.update({ where: { id: contact.id }, data: patch });
  }

  // 4) Primer mensaje por el camino de siempre (respeta el cupo de calentamiento y lo deja en el Inbox).
  const enviado = await sendToContact(userId, contact.id, message);
  if (!enviado) {
    return res.status(502).json({
      error: yaExistia
        ? "No se pudo enviar el mensaje (revisá que la línea esté conectada y el cupo de calentamiento). El contacto quedó en tu lista."
        : "El contacto se creó pero el mensaje no salió (revisá la línea y el cupo de calentamiento).",
      contactId: contact.id,
      code: "no_enviado",
    });
  }
  return res.status(201).json({ ok: true, contactId: contact.id, yaExistia });
});
