// Verificación del callback firmado del socio (ganamos, modelo B — auto-carga). Contrato de Eduardo:
//   header X-Partner-Signature = hex( HMAC-SHA256(secret, `${timestamp}.${rawBody}`) )
//   header X-Partner-Timestamp = ISO 8601
// La firma cubre `${timestamp}.${body}` (NO solo el body) para cortar replay. Comparación timing-safe.
// El secreto lo genera Eduardo y va SOLO en el .env del server (CHAT_PAY_WEBHOOK_SECRET).
import crypto from "node:crypto";

// true si la firma del header coincide con el HMAC del cuerpo crudo. Cualquier faltante/desprolijidad
// → false (nunca tira). rawBody TIENE que ser el cuerpo EXACTO recibido (req.rawBody), no el reparseado.
export function verifyPartnerSignature(
  secret: string,
  timestamp: string | undefined,
  signature: string | undefined,
  rawBody: Buffer | string | undefined,
): boolean {
  if (!secret || !timestamp || !signature || rawBody == null) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signature.trim(), "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Anti-replay: el timestamp firmado tiene que ser reciente. Los reintentos de Eduardo (0s/2s/8s) usan
// el MISMO timestamp que el original, y los callbacks tardíos (ej. "expired" a las 48h) se firman con
// timestamp fresco al enviarse → una ventana de minutos alcanza y sobra. `nowMs` inyectable para tests.
export function isCallbackTimestampFresh(
  timestamp: string | undefined,
  maxSkewMs = 15 * 60 * 1000,
  nowMs?: number,
): boolean {
  if (!timestamp) return false;
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return false;
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  return Math.abs(now - t) <= maxSkewMs;
}
