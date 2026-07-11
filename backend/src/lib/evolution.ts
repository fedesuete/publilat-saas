// Cliente de Evolution API (v2) — maneja instancias de WhatsApp (Baileys por debajo).
// Doc: https://doc.evolution-api.com
import axios, { type AxiosInstance } from "axios";

const BASE_URL = process.env.EVOLUTION_API_URL ?? "http://localhost:8080";
const API_KEY = process.env.EVOLUTION_API_KEY ?? "";
const WEBHOOK_URL = process.env.EVOLUTION_WEBHOOK_URL ?? "";

// Eventos que nos interesan del webhook. MESSAGES_UPDATE trae los acks de entrega:
// sin él, un envío rechazado por WhatsApp (ej. 463) queda como "enviado" y el Inbox miente.
const WEBHOOK_EVENTS = ["QRCODE_UPDATED", "CONNECTION_UPDATE", "MESSAGES_UPSERT", "MESSAGES_UPDATE"];

function client(): AxiosInstance {
  if (!API_KEY) throw new Error("Falta EVOLUTION_API_KEY en .env");
  return axios.create({
    baseURL: BASE_URL,
    headers: { apikey: API_KEY, "Content-Type": "application/json" },
    timeout: 20000,
  });
}

export interface QrResult {
  base64?: string; // imagen del QR (data URL) para mostrar en el panel
  code?: string; // string crudo del QR
  pairingCode?: string;
}

// Crea la instancia y deja configurado el webhook. Idempotente: si ya existe, no falla.
export async function createInstance(instanceName: string): Promise<QrResult> {
  const c = client();
  try {
    const { data } = await c.post("/instance/create", {
      instanceName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      ...(WEBHOOK_URL
        ? {
            webhook: {
              url: WEBHOOK_URL,
              byEvents: false, // una sola URL; el evento viene en el body
              base64: true, // manda el QR en base64
              events: WEBHOOK_EVENTS,
            },
          }
        : {}),
    });
    // El create suele devolver el primer QR.
    const qr = data?.qrcode ?? {};
    return { base64: qr.base64, code: qr.code, pairingCode: qr.pairingCode };
  } catch (e) {
    if (axios.isAxiosError(e) && (e.response?.status === 403 || e.response?.status === 409)) {
      // Ya existe: aseguramos el webhook y seguimos.
      await setWebhook(instanceName).catch(() => undefined);
      return {};
    }
    throw e;
  }
}

// (Re)configura el webhook de una instancia existente.
export async function setWebhook(instanceName: string): Promise<void> {
  if (!WEBHOOK_URL) return;
  const c = client();
  await c.post(`/webhook/set/${instanceName}`, {
    webhook: {
      enabled: true,
      url: WEBHOOK_URL,
      byEvents: false,
      base64: true,
      events: WEBHOOK_EVENTS,
    },
  });
}

// Pide (re)conexión. Sin `number` devuelve el QR; con `number` (internacional, sin "+")
// devuelve un pairingCode de 8 caracteres para vincular por número en vez de escanear.
export async function connectInstance(instanceName: string, number?: string): Promise<QrResult> {
  const c = client();
  const digits = number ? number.replace(/\D/g, "") : "";
  const { data } = await c.get(`/instance/connect/${instanceName}`, {
    params: digits ? { number: digits } : undefined,
  });
  return { base64: data?.base64, code: data?.code, pairingCode: data?.pairingCode };
}

// Número del dueño de la instancia (el WhatsApp conectado), sin "+". "" si no hay.
export async function fetchOwnerNumber(instanceName: string): Promise<string> {
  const c = client();
  try {
    const { data } = await c.get("/instance/fetchInstances", { params: { instanceName } });
    const arr = Array.isArray(data) ? data : [data];
    for (const it of arr) {
      const i = it?.instance ?? it;
      if ((i?.name ?? i?.instanceName) !== instanceName) continue;
      const jid: string = i?.ownerJid ?? i?.owner ?? "";
      const num: string = i?.number ?? "";
      const phone = (num || jid).split("@")[0].replace(/\D/g, "");
      if (phone) return phone;
    }
  } catch {
    /* noop */
  }
  return "";
}

// Estado de conexión: "open" (conectada), "connecting", "close".
export async function connectionState(instanceName: string): Promise<string> {
  const c = client();
  try {
    const { data } = await c.get(`/instance/connectionState/${instanceName}`);
    return data?.instance?.state ?? data?.state ?? "unknown";
  } catch {
    return "unknown";
  }
}

// Envía un mensaje de texto. number en formato internacional sin "+": 549294...
export async function sendText(instanceName: string, number: string, text: string) {
  const c = client();
  const { data } = await c.post(`/message/sendText/${instanceName}`, { number, text });
  return data;
}

// Envía una nota de voz (audio). `audioBase64` sin el prefijo data:. number sin "+".
export async function sendWhatsAppAudio(instanceName: string, number: string, audioBase64: string) {
  const c = client();
  const { data } = await c.post(`/message/sendWhatsAppAudio/${instanceName}`, {
    number,
    audio: audioBase64,
  });
  return data;
}

// Baja el contenido (base64) de un mensaje multimedia (ej imagen del comprobante).
// Evolution v2: POST /chat/getBase64FromMediaMessage/{instance} con la key del mensaje.
// Devuelve null si no se pudo (no rompe el flujo del webhook).
export interface MediaBase64 {
  base64: string;
  mimetype?: string;
}
export async function getMediaBase64(
  instanceName: string,
  messageKeyId: string,
): Promise<MediaBase64 | null> {
  try {
    const c = client();
    // Cota de tamaño: la media viene como base64 en el JSON; sin límite un archivo enorme
    // entra entero a RAM y se persiste en la DB (DoS/OOM). El *1.4 cubre el overhead base64.
    const MAX_MEDIA_BYTES = Number(process.env.MAX_MEDIA_BYTES ?? 15 * 1024 * 1024);
    const { data } = await c.post(`/chat/getBase64FromMediaMessage/${instanceName}`, {
      message: { key: { id: messageKeyId } },
      convertToMp4: false,
    }, { maxContentLength: Math.ceil(MAX_MEDIA_BYTES * 1.4), maxBodyLength: Math.ceil(MAX_MEDIA_BYTES * 1.4) });
    const base64: string | undefined = data?.base64 ?? data?.media ?? data?.data;
    if (!base64) return null;
    return { base64, mimetype: data?.mimetype ?? data?.mediaType };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[evolution] getMediaBase64 error:", message);
    return null;
  }
}

// Proxy de salida por instancia. Evolution lo aplica al websocket de Baileys (la conexión
// a WhatsApp sale por el proxy), pero recién en la PRÓXIMA conexión: hay que reiniciar la
// instancia después de setearlo. Evolution valida el proxy en vivo (compara la IP con y
// sin proxy contra icanhazip.com) y responde 400 "Invalid proxy" si no funciona.
export interface ProxyConfig {
  host: string;
  port: string; // el schema de Evolution exige string, no number
  protocol: string; // http | https | socks4 | socks5
  username?: string;
  password?: string;
}

// Parsea "socks5://user:pass@host:1080" (o http/https/socks4) a la forma de Evolution.
// Devuelve null si la URL no es válida o el protocolo no está soportado.
export function parseProxyUrl(url: string): ProxyConfig | null {
  try {
    const u = new URL(url.trim());
    const protocol = u.protocol.replace(/:$/, "").toLowerCase();
    if (!["http", "https", "socks4", "socks5"].includes(protocol)) return null;
    // Ojo WHATWG: en http/https el puerto default (80/443) queda como "" -> lo reponemos.
    const port = u.port || (protocol === "http" ? "80" : protocol === "https" ? "443" : "");
    if (!u.hostname || !port) return null;
    return {
      host: u.hostname,
      port,
      protocol,
      ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
      ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    };
  } catch {
    return null;
  }
}

export async function setProxy(instanceName: string, proxy: ProxyConfig | null): Promise<void> {
  const c = client();
  // Para apagar, el schema igual exige host/port/protocol no vacíos: van dummies.
  const body = proxy
    ? { enabled: true, ...proxy }
    : { enabled: false, host: "127.0.0.1", port: "1", protocol: "http" };
  await c.post(`/proxy/set/${instanceName}`, body);
}

// Reinicia la instancia (recupera sesiones trabadas en "close"/flapping SIN re-escanear QR).
export async function restartInstance(instanceName: string): Promise<boolean> {
  const c = client();
  try {
    await c.put(`/instance/restart/${instanceName}`);
    return true;
  } catch {
    try {
      await c.post(`/instance/restart/${instanceName}`);
      return true;
    } catch (e) {
      console.warn("[evolution] restartInstance falló:", e instanceof Error ? e.message : String(e));
      return false;
    }
  }
}

// Cierra sesión (desvincula el teléfono) sin borrar la instancia.
export async function logoutInstance(instanceName: string): Promise<void> {
  const c = client();
  await c.delete(`/instance/logout/${instanceName}`).catch(() => undefined);
}

// Borra la instancia por completo.
export async function deleteInstance(instanceName: string): Promise<void> {
  const c = client();
  await c.delete(`/instance/delete/${instanceName}`).catch(() => undefined);
}
