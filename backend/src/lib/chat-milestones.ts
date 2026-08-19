// Hitos del jugador VISIBLES para el operador en el hilo del Chat App: "📲 instaló la app" y
// "🔔 activó las notificaciones". Entran como mensajes senderType "system" (el panel ya los
// renderiza como chip centrado) + emit en vivo. Dedupeado por (conversación, metadata.kind):
// cada hito aparece UNA sola vez aunque el disparador se repita (re-suscripciones, re-aperturas).
// 100% best-effort: cualquier error se traga — NUNCA rompe el subscribe ni el arranque de la PWA.
import { prisma } from "./prisma.js";
import { emitChat } from "./io.js";

export type PlayerMilestone = "app_installed" | "push_on";

export async function postPlayerMilestone(
  userId: string,
  playerId: string,
  kind: PlayerMilestone,
  body: string,
): Promise<void> {
  try {
    const conv = await prisma.chatConversation.findFirst({ where: { userId, playerId }, select: { id: true } });
    if (!conv) return;
    const already = await prisma.chatMessage.findFirst({
      where: { conversationId: conv.id, senderType: "system", metadata: { path: ["kind"], equals: kind } },
      select: { id: true },
    });
    if (already) return;
    const msg = await prisma.chatMessage.create({
      data: { userId, conversationId: conv.id, senderType: "system", body, metadata: { kind } },
      select: { id: true, senderType: true, body: true, metadata: true, createdAt: true },
    });
    await prisma.chatConversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: new Date(), lastMessagePreview: body.slice(0, 120), unreadOperator: { increment: 1 } },
    });
    emitChat(`chat:${userId}`, "chat:message", {
      conversationId: conv.id,
      message: { id: msg.id, senderType: msg.senderType, body: msg.body, image: null, buttons: null, link: null, copy: null, createdAt: msg.createdAt },
    });
  } catch {
    /* best-effort */
  }
}
