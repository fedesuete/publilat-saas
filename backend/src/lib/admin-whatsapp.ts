// Aviso al DUEÑO por WhatsApp: el canal que sí se mira. El 21-22/09 el sistema avisó CINCO veces por
// mail y campanita que el saldo de IPRoyal se agotaba; nadie lo vio, el saldo llegó a cero y el
// 23/09 las líneas con proxy estuvieron 2 h caídas. Un WhatsApp al celular no pasa desapercibido.
//
// Best-effort y con freno: a lo sumo UN mensaje cada 6 h por tipo de aviso (el chequeo de saldo corre
// cada hora y "sigue bajo" no merece un WhatsApp por hora). Sin línea emisora disponible, no manda
// nada y el resto de los canales (mail + campanita) siguen igual.
//
// Config (.env):
//   ADMIN_ALERT_WA_TO          número que recibe (default: el celular del dueño)
//   ADMIN_ALERT_WA_FROM_EMAIL  cuenta cuya línea manda (default: publi9172). OJO: si la línea emisora
//                              es el MISMO número que recibe, WhatsApp lo guarda en "Tú" sin notificar.
import { prisma } from "./prisma.js";
import { getEngine } from "./wa-engine.js";

const TO = (process.env.ADMIN_ALERT_WA_TO ?? "595975112248").replace(/\D/g, "");
const FROM_EMAIL = (process.env.ADMIN_ALERT_WA_FROM_EMAIL ?? "publi9172@gmail.com").trim().toLowerCase();
export const ADMIN_WA_THROTTLE_MS = Number(process.env.ADMIN_ALERT_WA_THROTTLE_H ?? "6") * 3600_000;

const lastByKind = new Map<string, number>();
export function resetAdminWhatsAppThrottle(): void {
  lastByKind.clear();
}

// Línea emisora: la de la cuenta configurada si está en servicio; si no, cualquier línea conectada y
// paga de un ADMIN que NO sea el número destino (un mensaje a uno mismo no notifica).
async function lineaEmisora(): Promise<{ inst: string; phone: string } | null> {
  const enServicio = { provider: { not: "cloud" }, connected: true, banned: false, status: "active", expiresAt: { gt: new Date() } } as const;
  const pref = await prisma.waLine.findFirst({
    where: { ...enServicio, user: { email: FROM_EMAIL } },
    select: { id: true, sessionId: true, phone: true },
  });
  const line =
    pref ??
    (await prisma.waLine.findFirst({
      where: { ...enServicio, phone: { not: TO }, user: { role: "ADMIN" } },
      select: { id: true, sessionId: true, phone: true },
    }));
  if (!line) return null;
  return { inst: line.sessionId ?? `line_${line.id}`, phone: line.phone };
}

/**
 * Manda el aviso al celular del dueño. `kind` agrupa el freno (ej. "iproyal_low", "line_storm").
 * Devuelve true si salió. Nunca lanza.
 */
export async function sendAdminWhatsApp(kind: string, text: string): Promise<boolean> {
  if (!TO) return false;
  const now = Date.now();
  const last = lastByKind.get(kind) ?? 0;
  if (now - last < ADMIN_WA_THROTTLE_MS) return false;
  try {
    const from = await lineaEmisora();
    if (!from) {
      console.warn(`[admin-wa] sin línea emisora en servicio: aviso "${kind}" solo por mail/campanita`);
      return false;
    }
    lastByKind.set(kind, now);
    await getEngine().sendText(from.inst, TO, `⚠️ Publi.lat — ${text}`);
    console.log(`[admin-wa] aviso "${kind}" enviado desde ${from.phone.slice(-4)}`);
    return true;
  } catch (e) {
    console.warn(`[admin-wa] no pude mandar "${kind}":`, e instanceof Error ? e.message : String(e));
    return false;
  }
}
