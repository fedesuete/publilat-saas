// Cliente de la WhatsApp Cloud API (oficial) — para líneas provider="cloud".
// Se usa en anuncios Click-to-WhatsApp (CTWA): recibe el referral con ctwa_clid y
// permite responder por la Graph API. El token va POR LÍNEA (cifrado en reposo).
import axios from "axios";
import { decryptSecret } from "./crypto.js";

export const GRAPH_VERSION =
  process.env.META_GRAPH_VERSION ?? process.env.WHATSAPP_GRAPH_VERSION ?? "v20.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

interface CloudLine {
  wabaPhoneNumberId: string | null;
  accessToken: string | null;
}

function token(line: CloudLine): string {
  if (!line.accessToken) throw new Error("La línea Cloud no tiene access token");
  return decryptSecret(line.accessToken);
}

// Envía un mensaje de texto por la Cloud API. number en formato internacional sin "+".
export async function sendCloudText(line: CloudLine, to: string, text: string) {
  if (!line.wabaPhoneNumberId) throw new Error("La línea Cloud no tiene Phone Number ID");
  const { data } = await axios.post(
    `${GRAPH}/${line.wabaPhoneNumberId}/messages`,
    { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
    { headers: { Authorization: `Bearer ${token(line)}`, "Content-Type": "application/json" }, timeout: 15000 },
  );
  return data;
}

// True si el error de Graph es por estar fuera de la ventana de 24 h (requiere plantilla).
export function isOutsideWindowError(e: unknown): boolean {
  if (!axios.isAxiosError(e)) return false;
  const code = e.response?.data?.error?.code;
  // 131047: re-engagement message; 131026/131051: fuera de ventana / tipo no soportado.
  return code === 131047 || code === 131026 || code === 131051;
}

export function graphErrorMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    return e.response?.data?.error?.message ?? e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

// ---- Embedded Signup (Tech Provider) ----------------------------------------

// Intercambia el `code` del Embedded Signup por un access token para operar la WABA del
// cliente. Usa las credenciales de NUESTRA app (Tech Provider).
export async function exchangeCodeForToken(code: string): Promise<string> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error("Faltan META_APP_ID / META_APP_SECRET");
  const { data } = await axios.get(`${GRAPH}/oauth/access_token`, {
    params: { client_id: appId, client_secret: appSecret, code },
    timeout: 15000,
  });
  const token: string | undefined = data?.access_token;
  if (!token) throw new Error("No se obtuvo access_token en el intercambio del code");
  return token;
}

// Suscribe NUESTRA app al webhook de la WABA del cliente (para recibir sus mensajes).
export async function subscribeWaba(wabaId: string, token: string): Promise<void> {
  await axios.post(
    `${GRAPH}/${wabaId}/subscribed_apps`,
    {},
    { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 },
  );
}

// Registra/activa el número en la Cloud API. Best-effort: si ya está registrado o requiere
// PIN de verificación en dos pasos, no rompemos el alta (se loguea y sigue).
export async function registerPhone(phoneNumberId: string, token: string, pin?: string): Promise<boolean> {
  try {
    await axios.post(
      `${GRAPH}/${phoneNumberId}/register`,
      { messaging_product: "whatsapp", ...(pin ? { pin } : {}) },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 },
    );
    return true;
  } catch (e) {
    console.warn("[wa-cloud] registerPhone (best-effort):", graphErrorMessage(e));
    return false;
  }
}

// Baja un media entrante (imagen/documento) por su id -> base64. Para leer comprobantes.
export async function getCloudMediaBase64(
  line: CloudLine,
  mediaId: string,
): Promise<{ base64: string; mimetype?: string } | null> {
  try {
    const auth = { Authorization: `Bearer ${token(line)}` };
    // 1) pedimos la URL temporal del media.
    const { data: meta } = await axios.get(`${GRAPH}/${mediaId}`, { headers: auth, timeout: 15000 });
    const url: string | undefined = meta?.url;
    if (!url) return null;
    // 2) descargamos el binario (requiere el mismo Bearer).
    const { data: bin } = await axios.get<ArrayBuffer>(url, {
      headers: auth,
      responseType: "arraybuffer",
      timeout: 20000,
    });
    return { base64: Buffer.from(bin).toString("base64"), mimetype: meta?.mime_type };
  } catch (e) {
    console.error("[wa-cloud] getCloudMediaBase64 error:", graphErrorMessage(e));
    return null;
  }
}
