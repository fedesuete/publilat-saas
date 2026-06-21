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

// GET /api/inbox/:contactId/messages — historial de la conversación.
inboxRouter.get("/:contactId/messages", async (req, res) => {
  const contact = await getOwnedContact(req.userId!, req.params.contactId);
  if (!contact) return res.status(404).json({ error: "Contacto no encontrado" });

  const messages = await prisma.message.findMany({
    where: { contactId: contact.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, direction: true, body: true, createdAt: true },
  });
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
