// Envío de texto a un contacto por su línea (Baileys o Cloud), guardando el mensaje
// saliente y emitiéndolo al Inbox. Reutilizado por el motor de automatizaciones.
import { prisma } from "./prisma.js";
import { emitToUser } from "./io.js";
import { sendText } from "./evolution.js";
import { sendCloudText } from "./wa-cloud.js";
import { checkWarmupGate } from "./warmup.js";

export async function sendToContact(userId: string, contactId: string, text: string): Promise<boolean> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, userId } });
  if (!contact?.lineId) return false;
  const line = await prisma.waLine.findFirst({ where: { id: contact.lineId, userId } });
  if (!line) return false;
  const destination = contact.waJid ?? contact.phone;
  if (!destination) return false;

  // Rampa de calentamiento: cubre TODOS los envíos del motor de flujos (este es el
  // único camino, incluidas las reanudaciones por BullMQ). Si el cupo se agotó, el
  // paso se saltea (queda logueado y el dueño recibe la notificación del gate).
  const gate = await checkWarmupGate(line);
  if (!gate.ok) {
    console.warn(`[wa-send] envío bloqueado por calentamiento (línea ${line.id}, contacto ${contactId})`);
    return false;
  }

  let waMessageId: string | undefined;
  try {
    if (line.provider === "cloud") {
      if (!line.wabaPhoneNumberId || !line.accessToken) return false;
      const sent = await sendCloudText(line, (contact.phone ?? destination).replace(/\D/g, ""), text);
      waMessageId = sent?.messages?.[0]?.id ?? undefined;
    } else {
      if (!line.sessionId) return false;
      const sent = await sendText(line.sessionId, destination, text);
      waMessageId = sent?.key?.id ?? undefined;
    }
  } catch (e) {
    console.error("[wa-send] error:", e instanceof Error ? e.message : String(e));
    return false;
  }

  const msg = await prisma.message.create({ data: { contactId, lineId: line.id, direction: "out", body: text, waMessageId } });
  emitToUser(userId, "inbox:message", {
    contactId,
    message: { id: msg.id, direction: "out", body: text, createdAt: msg.createdAt },
  });
  return true;
}
