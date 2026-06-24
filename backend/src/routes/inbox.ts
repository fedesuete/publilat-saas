// Inbox (Fase 2): conversación por lead y envío de mensajes salientes.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { emitToUser } from "../lib/io.js";
import { sendText } from "../lib/evolution.js";

export const inboxRouter = Router();

// Verifica que el contacto sea del usuario.
async function getOwnedContact(userId: string, contactId: string) {
  return prisma.contact.findFirst({ where: { id: contactId, userId } });
}

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
      const preview = last
        ? last.body ||
          (last.mediaType
            ? last.mediaType.includes("pdf")
              ? "📄 Comprobante (PDF)"
              : "📷 Imagen"
            : "")
        : "";
      return {
        id: c.id,
        label: c.name || c.code || c.phone || c.externalId.slice(0, 8),
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
    select: { id: true, direction: true, body: true, mediaType: true, mediaData: true, createdAt: true },
  });
  // Las imágenes se devuelven como data URL para mostrarlas directo en el <img>.
  const messages = rows.map((m) => ({
    id: m.id,
    direction: m.direction,
    body: m.body,
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
  if (!line?.sessionId) return res.status(400).json({ error: "La línea no está disponible" });

  // Preferimos el JID crudo (soporta direcciones @lid de privacidad); si no, el teléfono.
  const destination = contact.waJid ?? contact.phone;
  try {
    await sendText(line.sessionId, destination, parsed.data.body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return res.status(502).json({ error: "No se pudo enviar el mensaje", detail: message });
  }

  const message = await prisma.message.create({
    data: { contactId: contact.id, lineId: line.id, direction: "out", body: parsed.data.body },
  });
  emitToUser(req.userId!, "inbox:message", {
    contactId: contact.id,
    message: { id: message.id, direction: "out", body: message.body, createdAt: message.createdAt },
  });
  return res.status(201).json({ message: { id: message.id, direction: "out", body: message.body, createdAt: message.createdAt } });
});
