// Borrar conversaciones y mensajes del Inbox (pedido de clientes, 2026-09-14).
//
// ADITIVO: NO toca inbox.ts ni el flujo de atribución (§9.6). Reglas que sigue:
//   · Borrar una CONVERSACIÓN borra sus MENSAJES, no el contacto: el lead, su etapa, su monto y
//     sus identificadores de atribución (fbclid/fbp/external_id) quedan intactos en el CRM. Como el
//     Inbox lista sólo contactos CON mensajes, la charla desaparece de la lista; si la persona
//     vuelve a escribir, aparece de nuevo (limpia).
//   · Borrar un MENSAJE intenta además borrarlo EN WHATSAPP (para todos), como el "eliminar para
//     todos" de la app. WhatsApp sólo lo permite un rato después de enviado: si ya no se puede, se
//     borra igual del panel y se avisa que en el teléfono del cliente sigue estando.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const chatsRouter = Router();

// Borrado "para todos" en WhatsApp vía WAHA. Best-effort: cualquier fallo devuelve false y el
// mensaje se borra igual del panel (el operador sabe que del otro lado sigue).
async function borrarEnWhatsApp(sessionId: string | null, chatId: string | null, waMessageId: string | null): Promise<boolean> {
  const base = process.env.WAHA_BASE_URL, key = process.env.WAHA_API_KEY;
  if (!sessionId || !chatId || !waMessageId) return false;
  if ((process.env.WA_ENGINE ?? "").toLowerCase() !== "waha" || !base || !key) return false;
  // El id viaja en dos formatos según por dónde entró el mensaje (crudo o serializado
  // "true_<jid>_<id>"): probamos los dos, igual que en el dedup del webhook.
  const cola = waMessageId.includes("_") ? waMessageId.split("_").pop()! : waMessageId;
  const ids = [...new Set([waMessageId, cola, `true_${chatId}_${cola}`])];
  for (const id of ids) {
    try {
      const r = await fetch(
        `${base}/api/${encodeURIComponent(sessionId)}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(id)}`,
        { method: "DELETE", headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(9000) },
      );
      if (r.ok) return true;
    } catch { /* probamos el siguiente formato */ }
  }
  return false;
}

// DELETE /api/chats/:contactId — borra la conversación (sus mensajes). El contacto NO se borra.
chatsRouter.delete("/:contactId", async (req, res) => {
  const contact = await prisma.contact.findFirst({
    where: { id: req.params.contactId, userId: req.userId! },
    select: { id: true },
  });
  if (!contact) return res.status(404).json({ error: "Conversación no encontrada" });
  const { count } = await prisma.message.deleteMany({ where: { contactId: contact.id } });
  return res.json({ ok: true, borrados: count });
});

// DELETE /api/chats/:contactId/mensajes/:messageId — borra UN mensaje (y en WhatsApp si se puede).
chatsRouter.delete("/:contactId/mensajes/:messageId", async (req, res) => {
  const msg = await prisma.message.findFirst({
    where: { id: req.params.messageId, contact: { id: req.params.contactId, userId: req.userId! } },
    select: { id: true, direction: true, waMessageId: true, contact: { select: { waJid: true, phone: true } }, line: { select: { sessionId: true, provider: true } } },
  });
  if (!msg) return res.status(404).json({ error: "Mensaje no encontrado" });

  // Sólo tiene sentido borrar "para todos" lo que mandamos nosotros por una línea QR.
  let enWhatsApp = false;
  if (msg.direction === "out" && msg.line?.provider !== "cloud") {
    const chatId = msg.contact.waJid ?? (msg.contact.phone ? `${msg.contact.phone.replace(/\D/g, "")}@c.us` : null);
    enWhatsApp = await borrarEnWhatsApp(msg.line?.sessionId ?? null, chatId, msg.waMessageId);
  }
  await prisma.message.delete({ where: { id: msg.id } });
  return res.json({ ok: true, enWhatsApp });
});
