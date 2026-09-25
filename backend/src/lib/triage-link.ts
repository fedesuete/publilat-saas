// Link firmado para decidir una revisión de soporte DESDE EL MAIL, sin entrar al panel.
//
// Por qué existe (2026-09-25, pedido del dueño): el aviso de la IA llega por mail, pero para aprobar
// había que abrir el panel, buscar el cliente y entrar a Soporte. Con el link se decide desde el
// celular en dos toques.
//
// Seguridad, porque el link EJECUTA una acción privilegiada:
//   - Va FIRMADO con el secreto del servidor (HMAC): no se puede fabricar ni adivinar.
//   - VENCE (7 días por defecto).
//   - Sirve UNA sola vez en la práctica: decidirTriage rechaza cualquier revisión que ya no esté
//     "pending", así que reenviar el mail o reabrir el link no vuelve a ejecutar nada.
//   - La acción está acotada a la lista cerrada de ACCIONES; el link no puede hacer nada más.
//   - El link SOLO abre una página que muestra el caso. Ejecutar exige un POST (un botón), así que
//     un antivirus o un escáner de correo que siga enlaces NO puede aprobar nada sin querer.
import crypto from "node:crypto";

const VENCIMIENTO_DIAS = Number(process.env.TRIAGE_LINK_DIAS ?? "7");

function secreto(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("Falta JWT_SECRET");
  return s;
}

const b64url = (b: Buffer): string => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64url = (s: string): Buffer => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function firma(datos: string): string {
  return b64url(crypto.createHmac("sha256", secreto()).update(datos).digest());
}

/** Token para decidir esta revisión. `adminId` queda adentro para que el log diga quién decidió. */
export function firmarDecision(triageId: string, adminId: string, dias: number = VENCIMIENTO_DIAS): string {
  const exp = Math.floor(Date.now() / 1000) + dias * 86400;
  const datos = b64url(Buffer.from(JSON.stringify({ t: triageId, a: adminId, exp })));
  return `${datos}.${firma(datos)}`;
}

/** Devuelve los datos si el token es legítimo y no venció; null en cualquier otro caso. */
export function verificarDecision(token: string): { triageId: string; adminId: string } | null {
  try {
    const [datos, mac] = String(token).split(".");
    if (!datos || !mac) return null;
    const esperado = firma(datos);
    // Comparación en tiempo constante: no filtra la firma a fuerza de reintentos.
    if (mac.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(esperado))) return null;
    const p = JSON.parse(deB64url(datos).toString()) as { t?: string; a?: string; exp?: number };
    if (!p.t || !p.a || !p.exp) return null;
    if (p.exp < Math.floor(Date.now() / 1000)) return null;
    return { triageId: p.t, adminId: p.a };
  } catch {
    return null;
  }
}
