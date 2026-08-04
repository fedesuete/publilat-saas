// Alerta de línea de WhatsApp caída: campana in-app (dueño) + email (dueño + admin), con
// dedupe de 6 h para que una línea que flapea no genere spam. La usan DOS caminos:
//  - el job checkLineHealth (caída detectada por el chequeo periódico),
//  - el webhook connection.update (caída reportada al instante por el motor).
// Sin este helper compartido, el email solo salía por el job y se perdían muchas caídas.
import { prisma } from "./prisma.js";
import { notify } from "./notifications.js";
import { sendMail, sendAdminMail } from "./mailer.js";
import { getEngine } from "./wa-engine.js";

// Diagnóstico automático de POR QUÉ se cayó una línea: consulta el estado de la sesión (WAHA, con su
// `me.reachoutTimelock`) + la DB (duplicados / baneo) y devuelve el motivo + la acción concreta. Así
// el aviso deja de ser genérico y vamos detectando patrones (restricción vs re-vincular vs baneo vs
// duplicado). Best-effort: si algo falla, devuelve "" y el aviso cae al texto genérico.
type SessionMe = { reachoutTimelock?: { isActive?: boolean; timeEnforcementEnds?: number } };
export async function diagnoseLine(line: { id: string; userId: string; phone: string }): Promise<string> {
  const inst = `line_${line.id}`;
  let status = "";
  let me: SessionMe | null = null;
  const base = process.env.WAHA_BASE_URL, key = process.env.WAHA_API_KEY;
  if ((process.env.WA_ENGINE ?? "").toLowerCase() === "waha" && base && key) {
    try {
      const r = await fetch(`${base}/api/sessions/${inst}`, { headers: { "X-Api-Key": key } });
      if (r.ok) { const s = (await r.json()) as { status?: string; me?: SessionMe | null }; status = s.status ?? ""; me = s.me ?? null; }
    } catch { /* seguimos con lo que haya */ }
  }
  if (!status) status = await getEngine().connectionState(inst).catch(() => "");

  // 1) Restricción de WhatsApp (bloquea los dispositivos vinculados). Es la más importante y la que
  //    más confunde: por más que reconecte, WhatsApp la echa hasta que vence.
  const lock = me?.reachoutTimelock;
  if (lock?.isActive && lock.timeEnforcementEnds) {
    const end = new Date(lock.timeEnforcementEnds * 1000).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit" });
    return `⛔ WhatsApp RESTRINGIÓ este número (bloquea los dispositivos vinculados) hasta el ${end}. Reconectar NO sirve hasta esa fecha — conviene usar OTRO número mientras tanto. No es un problema de la plataforma.`;
  }
  // 2) Duplicado: mismo número en otra línea de la cuenta → dos sesiones peleando.
  if (line.phone) {
    const dup = await prisma.waLine.count({ where: { userId: line.userId, phone: line.phone, id: { not: line.id }, provider: { not: "cloud" } } }).catch(() => 0);
    if (dup > 0) return `⚠️ El número está cargado en OTRA línea de la misma cuenta (duplicado) → las dos sesiones pelean y WhatsApp echa una. Hay que dejar UNA sola.`;
  }
  // 3) Baneada (logout/401/403 inequívoco).
  const db = await prisma.waLine.findUnique({ where: { id: line.id }, select: { banned: true } }).catch(() => null);
  if (db?.banned) return `⛔ Número BANEADO/deslogueado por WhatsApp. No se recupera: hay que vincular un número NUEVO.`;
  // 4) Por estado de la sesión.
  if (status === "open" || status === "WORKING") return `✅ La línea ya se reconectó sola (falsa alarma).`;
  if (status === "SCAN_QR_CODE") return `📷 Perdió la sesión de WhatsApp → re-escaneá el QR desde el panel (WhatsApp → Conectar).`;
  if (["FAILED", "STOPPED", "close"].includes(status)) return `🔌 Sesión caída (${status}). Re-vinculá desde el panel (WhatsApp → Conectar / Ver QR). Si se cae seguido, probá con otro número.`;
  if (status === "STARTING") return `⏳ Reintentando conectar. Si no vuelve en unos minutos, re-vinculá desde el panel o probá con otro número.`;
  return `❓ Causa no determinada (estado: ${status || "desconocido"}). Re-vinculá desde el panel; si sigue cayendo, avisanos.`;
}

export async function alertLineDown(line: { id: string; userId: string; label: string | null; phone: string }): Promise<void> {
  const name = line.label || line.phone || "tu línea";
  // Testeo automático del motivo de la caída (para el aviso y para detectar bugs recurrentes).
  const diag = await diagnoseLine(line).catch(() => "");
  console.warn(`[line-down] ${line.id} ("${name}") user=${line.userId} -> ${diag || "sin diagnóstico"}`);
  const body = diag
    ? `Tu WhatsApp "${name}" se desconectó.\n\n${diag}`
    : `Tu WhatsApp "${name}" se desconectó. Entrá a Publi.lat → WhatsApp y tocá "Conectar / Ver QR" para volver a vincularlo (tus chats no se pierden).`;
  // Dedupe: si ya avisamos esta misma caída (mismo motivo) en las últimas 6 h, no repetimos el email.
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
    `La línea ${line.id} ("${name}", ${line.phone}) de ${owner?.email ?? line.userId} se desconectó.\n\nDIAGNÓSTICO AUTOMÁTICO:\n${diag || "sin diagnóstico"}`,
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
