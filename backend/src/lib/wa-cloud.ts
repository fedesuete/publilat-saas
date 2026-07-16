// Cliente de la WhatsApp Cloud API (oficial) — para líneas provider="cloud".
// Se usa en anuncios Click-to-WhatsApp (CTWA): recibe el referral con ctwa_clid y
// permite responder por la Graph API. El token va POR LÍNEA (cifrado en reposo).
import axios from "axios";
import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import FormData from "form-data";
import { decryptSecret } from "./crypto.js";

export const GRAPH_VERSION =
  process.env.META_GRAPH_VERSION ?? process.env.WHATSAPP_GRAPH_VERSION ?? "v20.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

// Tope de tamaño para media entrante que se baja server-side y se persiste como base64.
// Compartido por los 3 motores (Cloud/Evolution/WAHA). WhatsApp permite hasta ~100MB;
// sin cota, un tercero puede inflar la DB / tumbar el proceso con archivos grandes.
export const MAX_MEDIA_BYTES = Number(process.env.MAX_MEDIA_BYTES ?? 15 * 1024 * 1024);

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

// Convierte cualquier audio del navegador (WebM/OPUS de Chrome, OGG/OPUS de Firefox) a un
// OGG/OPUS LIMPIO y compatible con la Cloud API. La entrada se escribe a un archivo temporal
// porque WebM/Matroska necesita "saltar" (seek) para demuxear — un pipe no lo permite y sale
// vacío. La salida va por pipe (streamable). Re-encodeamos SIEMPRE (aunque venga como ogg)
// para regenerar el header de duración que MediaRecorder deja incompleto (por eso WhatsApp lo
// mostraba en 0:00 y no lo entregaba).
async function toOggOpus(input: Buffer): Promise<Buffer> {
  const tmp = join(tmpdir(), `pl-voz-${process.pid}-${Date.now()}-${Math.round(Math.random() * 1e9)}.bin`);
  await writeFile(tmp, input);
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", tmp, "-vn", "-c:a", "libopus", "-b:a", "32k", "-f", "ogg", "pipe:1"]);
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      ff.stdout.on("data", (d) => out.push(d));
      ff.stderr.on("data", (d) => err.push(d));
      ff.on("error", (e) => reject(new Error("ffmpeg no disponible: " + e.message)));
      ff.on("close", (code) =>
        code === 0 && out.length ? resolve(Buffer.concat(out)) : reject(new Error("ffmpeg falló: " + Buffer.concat(err).toString().slice(-300))));
    });
  } finally {
    await unlink(tmp).catch(() => { /* limpieza best-effort */ });
  }
}

// Sube un binario al endpoint de media de la Cloud API y devuelve el media id.
async function uploadCloudMedia(line: CloudLine, buffer: Buffer, mime: string, filename: string): Promise<string> {
  if (!line.wabaPhoneNumberId) throw new Error("La línea Cloud no tiene Phone Number ID");
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buffer, { filename, contentType: mime });
  form.append("type", mime);
  const { data } = await axios.post(`${GRAPH}/${line.wabaPhoneNumberId}/media`, form, {
    headers: { Authorization: `Bearer ${token(line)}`, ...form.getHeaders() },
    maxContentLength: MAX_MEDIA_BYTES,
    maxBodyLength: MAX_MEDIA_BYTES,
    timeout: 30000,
  });
  if (!data?.id) throw new Error("Meta no devolvió media id");
  return data.id as string;
}

// Envía una nota de voz por la Cloud API: normaliza a OGG/OPUS con ffmpeg, sube el media y
// manda type=audio.
export async function sendCloudAudio(line: CloudLine, to: string, base64: string) {
  if (!line.wabaPhoneNumberId) throw new Error("La línea Cloud no tiene Phone Number ID");
  const ogg = await toOggOpus(Buffer.from(base64, "base64"));
  const mediaId = await uploadCloudMedia(line, ogg, "audio/ogg", "voz.ogg");
  const { data } = await axios.post(
    `${GRAPH}/${line.wabaPhoneNumberId}/messages`,
    { messaging_product: "whatsapp", to, type: "audio", audio: { id: mediaId } },
    { headers: { Authorization: `Bearer ${token(line)}`, "Content-Type": "application/json" }, timeout: 15000 },
  );
  return data;
}

// ---- Plantillas (message templates) ----------------------------------------
export interface WaTemplate {
  name: string;
  status: string;
  language: string;
  category?: string;
  components?: unknown[];
  bodyParams: number; // cantidad de variables {{n}} en el body
}

// Lista las plantillas de una WABA (para reabrir conversaciones fuera de la ventana 24h).
export async function listTemplates(wabaId: string, token: string): Promise<WaTemplate[]> {
  const { data } = await axios.get(`${GRAPH}/${wabaId}/message_templates`, {
    params: { access_token: token, fields: "name,status,language,category,components", limit: 200 },
    timeout: 15000,
  });
  const arr: any[] = Array.isArray(data?.data) ? data.data : [];
  return arr.map((t) => {
    const body = Array.isArray(t.components) ? t.components.find((c: any) => c?.type === "BODY") : null;
    const text: string = body?.text ?? "";
    const bodyParams = (text.match(/\{\{\d+\}\}/g) ?? []).length;
    return { name: t.name, status: t.status, language: t.language, category: t.category, components: t.components, bodyParams };
  });
}

// Envía un mensaje de plantilla. bodyParams = valores para las variables {{1}},{{2}}...
export async function sendCloudTemplate(
  line: CloudLine,
  to: string,
  name: string,
  language: string,
  bodyParams?: string[],
) {
  if (!line.wabaPhoneNumberId) throw new Error("La línea Cloud no tiene Phone Number ID");
  const components =
    bodyParams && bodyParams.length
      ? [{ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: t })) }]
      : undefined;
  const { data } = await axios.post(
    `${GRAPH}/${line.wabaPhoneNumberId}/messages`,
    { messaging_product: "whatsapp", to, type: "template", template: { name, language: { code: language }, ...(components ? { components } : {}) } },
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

// Inspecciona el token (debug_token) y devuelve los WABA ids a los que da acceso.
// Embedded Signup: el token del negocio trae granular_scopes con los target_ids (las WABA).
// Así resolvemos la WABA usando SOLO el code, sin depender del postMessage del popup.
export async function debugToken(token: string): Promise<{ wabaIds: string[] }> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error("Faltan META_APP_ID / META_APP_SECRET");
  const { data } = await axios.get(`${GRAPH}/debug_token`, {
    params: { input_token: token, access_token: `${appId}|${appSecret}` },
    timeout: 15000,
  });
  const scopes: any[] = Array.isArray(data?.data?.granular_scopes) ? data.data.granular_scopes : [];
  const idsFor = (scope: string): string[] => {
    const s = scopes.find((x) => x?.scope === scope);
    return Array.isArray(s?.target_ids) ? s.target_ids.map(String) : [];
  };
  let ids = idsFor("whatsapp_business_management");
  if (ids.length === 0) ids = idsFor("whatsapp_business_messaging");
  return { wabaIds: ids };
}

// Calidad y estado del número en la Cloud API (GREEN|YELLOW|RED). Best-effort: null si falla.
export async function getPhoneQuality(
  phoneNumberId: string,
  token: string,
): Promise<{ qualityRating?: string; status?: string } | null> {
  try {
    const { data } = await axios.get(`${GRAPH}/${phoneNumberId}`, {
      params: { fields: "quality_rating,name_status,status", access_token: token },
      timeout: 15000,
    });
    return { qualityRating: data?.quality_rating, status: data?.status ?? data?.name_status };
  } catch (e) {
    console.warn("[wa-cloud] getPhoneQuality:", graphErrorMessage(e));
    return null;
  }
}

// Lista los números de teléfono de una WABA. Sirve para resolver el phone_number_id
// cuando el Embedded Signup no lo mandó (a veces sólo llega el waba_id).
export interface WabaPhoneNumber { id: string; display_phone_number?: string; verified_name?: string }
export async function getWabaPhoneNumbers(wabaId: string, token: string): Promise<WabaPhoneNumber[]> {
  const { data } = await axios.get(`${GRAPH}/${wabaId}/phone_numbers`, {
    params: { access_token: token, fields: "id,display_phone_number,verified_name" },
    timeout: 15000,
  });
  const arr: any[] = Array.isArray(data?.data) ? data.data : [];
  return arr.map((p) => ({ id: p.id, display_phone_number: p.display_phone_number, verified_name: p.verified_name }));
}

// Suscribe NUESTRA app al webhook de la WABA del cliente (para recibir sus mensajes).
export async function subscribeWaba(wabaId: string, token: string): Promise<void> {
  const { data } = await axios.post(
    `${GRAPH}/${wabaId}/subscribed_apps`,
    {},
    { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 },
  );
  console.log("[wa-cloud] subscribeWaba", wabaId, "->", JSON.stringify(data));
}

// Lista las apps suscritas al webhook de una WABA. Sirve para verificar que NUESTRA app
// quedó suscrita (si no, los mensajes entrantes nunca llegan al webhook).
export async function getSubscribedApps(wabaId: string, token: string): Promise<any[]> {
  const { data } = await axios.get(`${GRAPH}/${wabaId}/subscribed_apps`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  });
  const apps: any[] = Array.isArray(data?.data) ? data.data : [];
  console.log("[wa-cloud] subscribed_apps", wabaId, "->", JSON.stringify(apps));
  return apps;
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

// Registra el número en la Cloud API con PIN (necesario para que salga de "Pendiente").
// Devuelve el resultado real de Graph; trata "ya registrado" (133010) como éxito.
export async function registerCloudNumber(
  phoneNumberId: string,
  token: string,
  pin: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await axios.post(
      `${GRAPH}/${phoneNumberId}/register`,
      { messaging_product: "whatsapp", pin },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 },
    );
    return { ok: true };
  } catch (e) {
    if (axios.isAxiosError(e)) {
      const err = e.response?.data?.error;
      // 133010: el número ya estaba registrado -> lo tratamos como éxito.
      if (err?.code === 133010) return { ok: true };
      console.error("[wa-cloud] registerCloudNumber error:", e.response?.status, JSON.stringify(e.response?.data));
      return { ok: false, error: err?.message ?? e.message };
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[wa-cloud] registerCloudNumber error:", msg);
    return { ok: false, error: msg };
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
    // 2) descargamos el binario (requiere el mismo Bearer). Cota de tamaño: un media
    //    enorme entraría entero a RAM y se guardaría como base64 en Postgres (DoS/OOM).
    const { data: bin } = await axios.get<ArrayBuffer>(url, {
      headers: auth,
      responseType: "arraybuffer",
      timeout: 20000,
      maxContentLength: MAX_MEDIA_BYTES,
      maxBodyLength: MAX_MEDIA_BYTES,
    });
    return { base64: Buffer.from(bin).toString("base64"), mimetype: meta?.mime_type };
  } catch (e) {
    console.error("[wa-cloud] getCloudMediaBase64 error:", graphErrorMessage(e));
    return null;
  }
}
