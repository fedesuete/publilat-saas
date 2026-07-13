// Alerta de línea de WhatsApp caída: campana in-app (dueño) + email (dueño + admin), con
// dedupe de 6 h para que una línea que flapea no genere spam. La usan DOS caminos:
//  - el job checkLineHealth (caída detectada por el chequeo periódico),
//  - el webhook connection.update (caída reportada al instante por el motor).
// Sin este helper compartido, el email solo salía por el job y se perdían muchas caídas.
import { prisma } from "./prisma.js";
import { notify } from "./notifications.js";
import { sendMail, sendAdminMail } from "./mailer.js";

export async function alertLineDown(line: { id: string; userId: string; label: string | null; phone: string }): Promise<void> {
  const name = line.label || line.phone || "tu línea";
  const body = `Tu WhatsApp "${name}" se desconectó. Entrá a Publi.lat → WhatsApp y tocá "Conectar / Ver QR" para volver a vincularlo (tus chats no se pierden).`;
  // Dedupe: si ya avisamos esta misma caída en las últimas 6 h, no repetimos el email.
  const recent = await prisma.notification.findFirst({
    where: { userId: line.userId, type: "line_down", body, createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) } },
    select: { id: true },
  });
  await notify(line.userId, "line_down", "Línea desconectada", body);
  if (recent) return; // ya se avisó por email hace poco

  const owner = await prisma.user.findUnique({ where: { id: line.userId }, select: { email: true } });
  const panel = (process.env.PANEL_BASE_URL ?? "").split(",")[0] || "https://app.publi.lat";
  if (owner?.email) {
    void sendMail(owner.email, `⚠️ Tu línea de WhatsApp "${name}" se desconectó`, `${body}\n\nPanel: ${panel}/whatsapp`);
  }
  void sendAdminMail(
    `Línea caída: "${name}" (${owner?.email ?? line.userId})`,
    `La línea ${line.id} ("${name}") de ${owner?.email ?? line.userId} se desconectó y necesita reconexión.`,
  );
}
