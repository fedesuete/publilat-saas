// Notificaciones del usuario: persiste + emite en tiempo real por Socket.IO.
import { prisma } from "./prisma.js";
import { emitToUser } from "./io.js";

export type NotificationType = "lead" | "purchase" | "line_down" | "line_quality" | "system";

export async function notify(userId: string, type: NotificationType, title: string, body?: string): Promise<void> {
  try {
    const n = await prisma.notification.create({ data: { userId, type, title, body } });
    emitToUser(userId, "notification", {
      id: n.id, type: n.type, title: n.title, body: n.body, read: n.read, createdAt: n.createdAt,
    });
  } catch (e) {
    console.error("[notify] error:", e instanceof Error ? e.message : String(e));
  }
}
