// Adaptador del gateway propio de Lucky Soft (Baileys 7.0.0-rc14, aislado). Tercer motor de WhatsApp
// junto a evolution.ts y waha.ts. Ventaja: Baileys puro (SIN Chromium, ~15 MB/línea), sin límite de
// líneas, ya trae el fix del 463 (tctoken) y maneja SU PROPIO proxy (no consume el nuestro).
//
// Webhook: el gateway emite en formato Evolution ({instance, data:{key,message,pushName,mediaBase64}}),
// el MISMO que ya parsea routes/webhook.ts. La media llega en base64 dentro del webhook (no hay que
// bajarla aparte). Config por .env: LUCKY_GW_URL / LUCKY_GW_KEY / LUCKY_GW_WEBHOOK_URL.
import axios, { type AxiosInstance } from "axios";
import type { QrResult, MediaBase64, ProxyConfig } from "./evolution.js";

const BASE_URL = process.env.LUCKY_GW_URL ?? "";
const API_KEY = process.env.LUCKY_GW_KEY ?? "";
const WEBHOOK_URL = process.env.LUCKY_GW_WEBHOOK_URL ?? "";

function client(): AxiosInstance {
  if (!BASE_URL || !API_KEY) throw new Error("Falta LUCKY_GW_URL / LUCKY_GW_KEY en .env");
  return axios.create({
    baseURL: BASE_URL,
    headers: { apikey: API_KEY, "Content-Type": "application/json" },
    timeout: 20000,
  });
}

// Alta/idempotente. El webhook se persiste en el create (sobrevive reinicios). No devuelve QR: se pide
// con connectInstance (/qr-json). Idempotente: si ya existe, no rompe.
export async function createInstance(instanceName: string): Promise<QrResult> {
  const c = client();
  try {
    await c.post("/instance/create", { name: instanceName, ...(WEBHOOK_URL ? { webhook: WEBHOOK_URL } : {}) });
  } catch (e) {
    if (!(axios.isAxiosError(e) && (e.response?.status === 409 || e.response?.status === 200))) {
      // 409/ya existe = ok; otro error se propaga.
      if (axios.isAxiosError(e) && e.response?.status && e.response.status < 500) throw e;
    }
  }
  return {};
}

// El gateway persiste el webhook en el create; re-crear es idempotente y lo reconfigura.
export async function setWebhook(instanceName: string): Promise<void> {
  await createInstance(instanceName).catch(() => undefined);
}

// QR actual de la línea (data URL). El gateway además tiene /qr-view/:name (página pública que
// auto-refresca el QR cada 4s) — útil para pasarle el link directo al cliente.
export async function connectInstance(instanceName: string, _number?: string): Promise<QrResult> {
  const c = client();
  try {
    const { data } = await c.get(`/qr-json/${encodeURIComponent(instanceName)}`);
    const qr: string | undefined = data?.qr ?? data?.base64 ?? data?.code;
    return { base64: qr, code: qr };
  } catch {
    return {};
  }
}

// Número del dueño (el WhatsApp conectado), sin "+". "" si no está conectada.
export async function fetchOwnerNumber(instanceName: string): Promise<string> {
  const c = client();
  try {
    const { data } = await c.get("/instances");
    const arr = Array.isArray(data) ? data : [];
    const it = arr.find((x: { name?: string }) => x?.name === instanceName);
    const raw: string = it?.numero ?? it?.number ?? it?.jid ?? "";
    return raw.split("@")[0].replace(/\D/g, "");
  } catch {
    return "";
  }
}

// Estado normalizado a "open" | "connecting" | "close" (lo que espera el resto del código).
export async function connectionState(instanceName: string): Promise<string> {
  const c = client();
  try {
    const { data } = await c.get(`/instance/status/${encodeURIComponent(instanceName)}`);
    if (data?.connected === true) return "open";
    const st = String(data?.status ?? "").toLowerCase();
    if (/connected|open|working/.test(st)) return "open";
    if (/qr|connecting|pairing|scan/.test(st)) return "connecting";
    if (/close|logout|logged|disconnect|unpaired/.test(st)) return "close";
    return st || "unknown";
  } catch {
    return "unknown";
  }
}

// Envía texto. number en internacional sin "+": 549294... Devuelve la respuesta del gateway
// (idealmente con la key del mensaje para guardar el waMessageId).
export async function sendText(instanceName: string, number: string, text: string) {
  const c = client();
  const to = number.replace(/\D/g, "");
  const { data } = await c.post("/send/text", { name: instanceName, to, text });
  return data;
}

// 🔴 El gateway todavía NO expone envío de audio (el socio lo agrega cuando se necesite). Falla claro
// en vez de romper silencioso, para que una línea en este motor no "pierda" audios sin aviso.
export async function sendWhatsAppAudio(_instanceName: string, _number: string, _audioBase64: string): Promise<never> {
  throw new Error("luckygw: envío de audio no soportado aún por el gateway");
}

// La media entrante llega en base64 DENTRO del webhook -> no hay que bajarla aparte.
export async function getMediaBase64(_instanceName: string, _messageKeyId: string): Promise<MediaBase64 | null> {
  return null;
}

// El gateway reconecta solo con backoff; "reiniciar" = re-crear (idempotente, mantiene credenciales).
export async function restartInstance(instanceName: string): Promise<boolean> {
  await createInstance(instanceName).catch(() => undefined);
  return true;
}

// Cierra sesión (desvincula el teléfono).
export async function logoutInstance(instanceName: string): Promise<void> {
  const c = client();
  await c.delete(`/instance/logout/${encodeURIComponent(instanceName)}`).catch(() => undefined);
}

// Borra la instancia por completo.
export async function deleteInstance(instanceName: string): Promise<void> {
  const c = client();
  await c.delete(`/instance/delete/${encodeURIComponent(instanceName)}`).catch(() => undefined);
}

// 🔴 El proxy es GLOBAL del contenedor del gateway (no por línea). No-op de nuestro lado: no
// necesitamos proxy propio para estas líneas — el gateway sale por su propia IP/infra.
export async function setProxy(_instanceName: string, _proxy: ProxyConfig | null): Promise<void> {
  /* no-op: el gateway maneja su salida a internet */
}
