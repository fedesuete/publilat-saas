// Alerta de línea de WhatsApp caída: campana in-app (dueño) + email (dueño + admin), con
// dedupe de 6 h para que una línea que flapea no genere spam. La usan DOS caminos:
//  - el job checkLineHealth (caída detectada por el chequeo periódico),
//  - el webhook connection.update (caída reportada al instante por el motor).
// Sin este helper compartido, el email solo salía por el job y se perdían muchas caídas.
import { prisma } from "./prisma.js";
import { notify } from "./notifications.js";
import { sendMail, sendAdminMail } from "./mailer.js";
import { getEngine } from "./wa-engine.js";

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

// Gracia anti-flapping: una línea puede caer y VOLVER SOLA en segundos (reconexión del motor). En vez
// de avisar al instante en el evento de desconexión, esperamos un rato y RE-VERIFICAMOS: si ya volvió,
// no avisamos; si sigue caída (o la borraron), recién ahí disparamos alertLineDown. Corta los falsos
// "se desconectó" cuando en realidad está conectada (reclamo típico de cuentas con varias líneas).
const LINE_DOWN_GRACE_MS = 4 * 60 * 1000; // 4 minutos

export function scheduleLineDownAlert(line: { id: string; userId: string; label: string | null; phone: string }): void {
  const t = setTimeout(() => {
    void (async () => {
      const fresh = await prisma.waLine
        .findUnique({ where: { id: line.id }, select: { connected: true, sessionId: true } })
        .catch(() => null);
      if (!fresh) return; // la borraron: no es una "caída" que avisar
      if (fresh.connected) return; // volvió sola (flapping) -> no avisamos
      // Chequeo final contra el motor por si la DB todavía no reflejó la reconexión.
      const state = await getEngine().connectionState(fresh.sessionId ?? `line_${line.id}`).catch(() => "");
      if (state === "open") return; // reconectada
      await alertLineDown(line);
    })();
  }, LINE_DOWN_GRACE_MS);
  t.unref?.();
}

// Aviso de SALDO por agotarse: el servicio del cliente se va a apagar en ~N horas y no tiene
// días para renovar. Campana + email al dueño (con link a recargar) + admin. El dedupe lo
// hace el caller (por cliente + umbral), así que este helper solo envía.
export async function alertLowBalance(
  line: { id: string; userId: string; label: string | null; phone: string },
  hoursLeft: number,
): Promise<void> {
  const name = line.label || line.phone || "tu WhatsApp";
  const h = Math.max(1, Math.round(hoursLeft));
  const body = `Se te está por terminar el saldo: tu WhatsApp "${name}" se va a apagar en ~${h} h y tu operación se va a frenar (tu web deja de mandar a WhatsApp). Recargá días para que siga activo sin cortes.`;
  await notify(line.userId, "system", "⏳ Tu saldo está por agotarse", body);
  const owner = await prisma.user.findUnique({ where: { id: line.userId }, select: { email: true } });
  const panel = (process.env.PANEL_BASE_URL ?? "").split(",")[0] || "https://app.publi.lat";
  if (owner?.email) {
    void sendMail(owner.email, `⏳ Tu WhatsApp "${name}" se apaga en ~${h} h — recargá saldo`, `${body}\n\nRecargá acá: ${panel}/billing`);
  }
  void sendAdminMail(
    `Saldo por agotarse: "${name}" (${owner?.email ?? line.userId})`,
    `El cliente ${owner?.email ?? line.userId} se apaga en ~${h} h (línea ${line.id}, "${name}") y no tiene días para renovar.`,
  );
}
