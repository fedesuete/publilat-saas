// Inbox (Fase 2): conversación por lead y envío de mensajes salientes.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { emitToUser } from "../lib/io.js";
import { getEngine } from "../lib/wa-engine.js";
import { sendCloudText, isOutsideWindowError, graphErrorMessage, listTemplates, sendCloudTemplate } from "../lib/wa-cloud.js";
import { decryptSecret } from "../lib/crypto.js";
import { checkWarmupGate } from "../lib/warmup.js";

export const inboxRouter = Router();

// Verifica que el contacto sea del usuario.
async function getOwnedContact(userId: string, contactId: string) {
  return prisma.contact.findFirst({ where: { id: contactId, userId } });
}

// Número mostrable del contacto (incluye direcciones @lid de privacidad).
function displayNumber(c: { phone: string | null; waJid: string | null; code: string | null }): string {
  if (c.phone) return c.phone;
  if (c.waJid) return c.waJid.split("@")[0];
  return c.code ?? "";
}

// Etiqueta corta de un media para el preview de la lista.
function mediaPreview(mediaType: string | null): string {
  if (!mediaType) return "";
  if (mediaType.includes("pdf")) return "📄 Comprobante (PDF)";
  if (mediaType.startsWith("audio")) return "🎤 Audio";
  if (mediaType.startsWith("image")) return "📷 Imagen";
  return "📎 Archivo";
}

// ---- Respuestas rápidas / mensajes guardados (deben ir antes de las rutas con :contactId) ----
inboxRouter.get("/quick-replies", async (req, res) => {
  const items = await prisma.quickReply.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: "asc" } });
  return res.json({ items });
});

const quickSchema = z.object({ title: z.string().min(1).max(60), body: z.string().min(1).max(2000) });
inboxRouter.post("/quick-replies", async (req, res) => {
  const parsed = quickSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const item = await prisma.quickReply.create({ data: { userId: req.userId!, title: parsed.data.title, body: parsed.data.body } });
  return res.status(201).json({ item });
});

inboxRouter.delete("/quick-replies/:id", async (req, res) => {
  const item = await prisma.quickReply.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!item) return res.status(404).json({ error: "No encontrado" });
  await prisma.quickReply.delete({ where: { id: item.id } });
  return res.json({ ok: true });
});

// GET /api/inbox/conversations — lista de chats con preview, línea y no-leídos.
inboxRouter.get("/conversations", async (req, res) => {
  const userId = req.userId!;
  const contacts = await prisma.contact.findMany({
    where: { userId, messages: { some: {} } },
    include: {
      line: { select: { label: true, phone: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { direction: true, body: true, mediaType: true, createdAt: true },
      },
    },
  });

  const conversations = contacts
    .map((c) => {
      const last = c.messages[0];
      // No-leídos = mensajes entrantes desde la última respuesta saliente (pendientes).
      let unread = 0;
      for (const m of c.messages) {
        if (m.direction === "out") break;
        unread++;
      }
      const preview = last ? last.body || mediaPreview(last.mediaType) : "";
      const number = displayNumber(c);
      return {
        id: c.id,
        // alias = nombre de WhatsApp; si no lo tenemos, mostramos el número/código.
        name: c.name || null,
        number,
        label: c.name || number || c.externalId.slice(0, 8),
        stage: c.stage,
        line: c.line ? c.line.label || c.line.phone : null,
        preview,
        lastAt: (last?.createdAt ?? c.createdAt).toISOString(),
        unread,
      };
    })
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());

  return res.json({ conversations, count: conversations.length });
});

// GET /api/inbox/:contactId/messages — historial de la conversación.
inboxRouter.get("/:contactId/messages", async (req, res) => {
  const contact = await getOwnedContact(req.userId!, req.params.contactId);
  if (!contact) return res.status(404).json({ error: "Contacto no encontrado" });

  const rows = await prisma.message.findMany({
    where: { contactId: contact.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, direction: true, body: true, status: true, error: true, mediaType: true, mediaData: true, createdAt: true },
  });
  // Las imágenes se devuelven como data URL para mostrarlas directo en el <img>.
  const messages = rows.map((m) => ({
    id: m.id,
    direction: m.direction,
    body: m.body,
    status: m.status,
    error: m.error,
    createdAt: m.createdAt,
    mediaUrl: m.mediaData ? `data:${m.mediaType ?? "image/jpeg"};base64,${m.mediaData}` : null,
  }));
  return res.json({ messages });
});

const sendSchema = z.object({ body: z.string().min(1).max(4096) });

// POST /api/inbox/:contactId/messages — envía un mensaje por WhatsApp y lo guarda.
inboxRouter.post("/:contactId/messages", async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  }
  const contact = await getOwnedContact(req.userId!, req.params.contactId);
  if (!contact) return res.status(404).json({ error: "Contacto no encontrado" });
  if (!contact.phone) return res.status(400).json({ error: "El contacto aún no tiene teléfono (no escribió todavía)" });
  if (!contact.lineId) return res.status(400).json({ error: "El contacto no tiene línea asociada" });

  const line = await prisma.waLine.findFirst({ where: { id: contact.lineId, userId: req.userId! } });
  if (!line) return res.status(400).json({ error: "La línea no está disponible" });

  // Rampa de calentamiento (líneas Baileys nuevas): cupo de envíos por 24 h.
  const gate = await checkWarmupGate(line);
  if (!gate.ok) return res.status(429).json({ error: gate.reason, code: "WARMUP_LIMIT" });

  // Preferimos el JID crudo (soporta direcciones @lid de privacidad); si no, el teléfono.
  const destination = contact.waJid ?? contact.phone;
  let waMessageId: string | undefined;
  if (line.provider === "cloud") {
    // WhatsApp Cloud API oficial (líneas CTWA). La Graph API usa sólo el número.
    if (!line.wabaPhoneNumberId || !line.accessToken) {
      return res.status(400).json({ error: "La línea Cloud no está configurada" });
    }
    try {
      const sent = await sendCloudText(line, (contact.phone ?? destination).replace(/\D/g, ""), parsed.data.body);
      waMessageId = sent?.messages?.[0]?.id ?? undefined;
    } catch (e) {
      if (isOutsideWindowError(e)) {
        return res.status(409).json({
          error: "Fuera de la ventana de 24 h. Para reabrir la conversación necesitás enviar una plantilla aprobada.",
          requiresTemplate: true,
        });
      }
      return res.status(502).json({ error: "No se pudo enviar el mensaje", detail: graphErrorMessage(e) });
    }
  } else {
    if (!line.sessionId) return res.status(400).json({ error: "La línea no está disponible" });
    try {
      const sent = await getEngine().sendText(line.sessionId, destination, parsed.data.body);
      waMessageId = sent?.key?.id ?? undefined;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return res.status(502).json({ error: "No se pudo enviar el mensaje", detail: message });
    }
  }

  // Guardamos el waMessageId: el eco fromMe del webhook se deduplica contra él. OJO:
  // con WAHA el eco llega casi instantáneo y puede ganarle la carrera a este create
  // (unique de waMessageId) — en ese caso reusamos la fila que ya insertó el webhook.
  let message;
  try {
    message = await prisma.message.create({
      data: { contactId: contact.id, lineId: line.id, direction: "out", body: parsed.data.body, waMessageId },
    });
  } catch (e) {
    const dup = waMessageId ? await prisma.message.findUnique({ where: { waMessageId } }) : null;
    if (!dup) throw e;
    message = dup;
  }
  emitToUser(req.userId!, "inbox:message", {
    contactId: contact.id,
    message: { id: message.id, direction: "out", body: message.body, status: message.status, createdAt: message.createdAt },
  });
  return res.status(201).json({ message: { id: message.id, direction: "out", body: message.body, status: message.status, createdAt: message.createdAt } });
});

// GET /api/inbox/:contactId/templates — plantillas APROBADAS de la línea Cloud del contacto.
inboxRouter.get("/:contactId/templates", async (req, res) => {
  const contact = await getOwnedContact(req.userId!, req.params.contactId);
  if (!contact) return res.status(404).json({ error: "Contacto no encontrado" });
  if (!contact.lineId) return res.json({ templates: [] });
  const line = await prisma.waLine.findFirst({ where: { id: contact.lineId, userId: req.userId! } });
  if (!line || line.provider !== "cloud" || !line.wabaId || !line.accessToken) {
    return res.json({ templates: [] }); // solo aplica a líneas Cloud API
  }
  try {
    const all = await listTemplates(line.wabaId, decryptSecret(line.accessToken));
    return res.json({ templates: all.filter((t) => t.status === "APPROVED") });
  } catch (e) {
    return res.status(502).json({ error: "No se pudieron traer las plantillas", detail: graphErrorMessage(e) });
  }
});

const templateSchema = z.object({
  name: z.string().min(1),
  language: z.string().min(2).max(10),
  params: z.array(z.string()).optional(),
});

// POST /api/inbox/:contactId/template — envía una plantilla (reabre la conversación).
inboxRouter.post("/:contactId/template", async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const contact = await getOwnedContact(req.userId!, req.params.contactId);
  if (!contact) return res.status(404).json({ error: "Contacto no encontrado" });
  if (!contact.lineId) return res.status(400).json({ error: "El contacto no tiene línea asociada" });
  const line = await prisma.waLine.findFirst({ where: { id: contact.lineId, userId: req.userId! } });
  if (!line || line.provider !== "cloud") return res.status(400).json({ error: "Las plantillas son solo para líneas Cloud API" });
  if (!line.wabaPhoneNumberId || !line.accessToken) return res.status(400).json({ error: "La línea Cloud no está configurada" });

  const to = (contact.phone ?? contact.waJid ?? "").replace(/\D/g, "");
  if (!to) return res.status(400).json({ error: "El contacto no tiene teléfono" });
  let waMessageId: string | undefined;
  try {
    const sent = await sendCloudTemplate(line, to, parsed.data.name, parsed.data.language, parsed.data.params);
    waMessageId = sent?.messages?.[0]?.id ?? undefined;
  } catch (e) {
    return res.status(502).json({ error: "No se pudo enviar la plantilla", detail: graphErrorMessage(e) });
  }

  const body = `📋 Plantilla: ${parsed.data.name}${parsed.data.params?.length ? ` (${parsed.data.params.join(", ")})` : ""}`;
  const message = await prisma.message.create({ data: { contactId: contact.id, lineId: line.id, direction: "out", body, waMessageId } });
  emitToUser(req.userId!, "inbox:message", {
    contactId: contact.id,
    message: { id: message.id, direction: "out", body, createdAt: message.createdAt },
  });
  return res.status(201).json({ message: { id: message.id, direction: "out", body, createdAt: message.createdAt } });
});

const audioSchema = z.object({ audio: z.string().min(1) }); // base64 (con o sin prefijo data:)

// POST /api/inbox/:contactId/audio — envía una nota de voz por WhatsApp y la guarda.
inboxRouter.post("/:contactId/audio", async (req, res) => {
  const parsed = audioSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const contact = await getOwnedContact(req.userId!, req.params.contactId);
  if (!contact) return res.status(404).json({ error: "Contacto no encontrado" });
  if (!contact.lineId) return res.status(400).json({ error: "El contacto no tiene línea asociada" });

  const line = await prisma.waLine.findFirst({ where: { id: contact.lineId, userId: req.userId! } });
  if (!line) return res.status(400).json({ error: "La línea no está disponible" });
  if (line.provider === "cloud") {
    return res.status(400).json({ error: "El envío de audios todavía no está disponible en líneas Cloud API." });
  }
  if (!line.sessionId) return res.status(400).json({ error: "La línea no está disponible" });

  // Rampa de calentamiento (líneas Baileys nuevas): cupo de envíos por 24 h.
  const gate = await checkWarmupGate(line);
  if (!gate.ok) return res.status(429).json({ error: gate.reason, code: "WARMUP_LIMIT" });

  const mimeMatch = parsed.data.audio.match(/^data:([^;]+);base64,/);
  const mime = mimeMatch?.[1] ?? "audio/ogg";
  const base64 = parsed.data.audio.replace(/^data:[^;]+;base64,/, "");
  const destination = contact.waJid ?? contact.phone;
  if (!destination) return res.status(400).json({ error: "El contacto aún no tiene teléfono" });
  let waMessageId: string | undefined;
  try {
    const sent = await getEngine().sendWhatsAppAudio(line.sessionId, destination, base64);
    waMessageId = sent?.key?.id ?? undefined;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return res.status(502).json({ error: "No se pudo enviar el audio", detail: message });
  }

  // Mismo cuidado que en el texto: el eco fromMe de WAHA puede insertar primero.
  let message;
  try {
    message = await prisma.message.create({
      data: { contactId: contact.id, lineId: line.id, direction: "out", body: "", mediaType: mime, mediaData: base64, waMessageId },
    });
  } catch (e) {
    const dup = waMessageId ? await prisma.message.findUnique({ where: { waMessageId } }) : null;
    if (!dup) throw e;
    message = dup;
  }
  const mediaUrl = `data:${mime};base64,${base64}`;
  emitToUser(req.userId!, "inbox:message", {
    contactId: contact.id,
    message: { id: message.id, direction: "out", body: "", status: message.status, mediaUrl, createdAt: message.createdAt },
  });
  return res.status(201).json({ message: { id: message.id, direction: "out", body: "", status: message.status, mediaUrl, createdAt: message.createdAt } });
});
