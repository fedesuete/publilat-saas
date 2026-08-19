// Aviso de CLIENTE NUEVO de Publi.lat (alta self-service): manda un WhatsApp + un email al dueño con
// los datos del que se registró, para poder contactarlo y ayudarlo a arrancar. Best-effort: nunca frena
// el alta. Se dispara desde POST /api/auth/register.
import { prisma } from "./prisma.js";
import { getEngine } from "./wa-engine.js";
import { sendMail } from "./mailer.js";

const NOTIFY_PHONE = (process.env.SIGNUP_NOTIFY_PHONE ?? "595975112248").replace(/\D/g, "");
const NOTIFY_EMAIL = process.env.SIGNUP_NOTIFY_EMAIL ?? "federicobogado1997@gmail.com";

export async function notifyNewSignup(u: { name?: string | null; email: string; phone?: string | null; interests?: string[] }): Promise<void> {
  const interesa = u.interests && u.interests.length ? `\n🔎 Le interesa: ${u.interests.join(" · ")}` : "";
  const text =
    `🆕 *Nuevo cliente en Publi.lat*\n\n` +
    `👤 ${u.name?.trim() || "(sin nombre)"}\n` +
    `✉️ ${u.email}\n` +
    `📱 ${u.phone?.trim() || "(sin teléfono)"}` +
    interesa +
    `\n\nContactalo para ayudarlo a arrancar 🚀`;

  // Email (best-effort)
  void sendMail(NOTIFY_EMAIL, "🆕 Nuevo cliente en Publi.lat", text.replace(/\*/g, "")).catch(() => undefined);

  // WhatsApp desde una línea Baileys conectada del admin (best-effort, no bloquea)
  if (!NOTIFY_PHONE) return;
  try {
    const line = await prisma.waLine.findFirst({
      where: { provider: { not: "cloud" }, connected: true, status: "active", sessionId: { not: null }, user: { is: { role: "ADMIN" } } },
      select: { sessionId: true },
      orderBy: { createdAt: "asc" },
    });
    if (line?.sessionId) {
      await getEngine().sendText(line.sessionId, NOTIFY_PHONE, text);
    }
  } catch (e) {
    console.error("[signup-notify] WhatsApp falló:", e instanceof Error ? e.message : String(e));
  }
}
