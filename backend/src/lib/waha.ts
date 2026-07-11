// Adapter de WAHA (https://waha.devlike.pro) — motor de WhatsApp alternativo a Evolution.
// WAHA trae DOS engines por config: WEBJS (Chromium real vía whatsapp-web.js — el más
// resistente al 463 en fríos) y NOWEB (Baileys al día, liviano). Expone la misma
// superficie que lib/evolution.ts; el switch entre motores es WA_ENGINE (lib/wa-engine.ts).
//
// Convenciones que se respetan para no tocar el resto de la app:
//  - El nombre de sesión de WAHA = instanceName (`line_<id>`), igual que Evolution, así
//    routes/webhook.ts sigue encontrando la línea por WaLine.sessionId.
//  - sendText/sendVoice devuelven { key: { id } } (forma Evolution) para que los callers
//    guarden el waMessageId sin cambios. El id es el SERIALIZADO de WAHA, que es el mismo
//    que llega después en los acks (message.ack).
//  - Los webhooks de WAHA se traducen al formato Evolution en normalizeWahaEvent().
//
// Limitaciones de WAHA Core (la imagen gratis): enviar/bajar MEDIA es feature de WAHA
// Plus. Para la fase de prueba del 463 (texto frío/caliente) alcanza de sobra.
import axios, { type AxiosInstance } from "axios";
import type { QrResult, MediaBase64, ProxyConfig } from "./evolution.js";

const BASE_URL = process.env.WAHA_BASE_URL ?? "http://localhost:3001";
const API_KEY = process.env.WAHA_API_KEY ?? "";
const DEFAULT_ENGINE = (process.env.WAHA_ENGINE ?? "WEBJS").toUpperCase(); // WEBJS | NOWEB
const WEBHOOK_URL = process.env.WAHA_WEBHOOK_URL ?? process.env.EVOLUTION_WEBHOOK_URL ?? "";
// message.any (y no message) para recibir TAMBIÉN los fromMe del teléfono (espejo al CRM);
// message.ack = tildes/rechazos; session.status = conectada/caída.
const HOOK_EVENTS = ["message.any", "message.ack", "session.status"];

function client(): AxiosInstance {
  if (!API_KEY) throw new Error("Falta WAHA_API_KEY en .env");
  return axios.create({
    baseURL: BASE_URL,
    headers: { "X-Api-Key": API_KEY, "Content-Type": "application/json" },
    timeout: 30000,
  });
}

function sessionConfig(proxy?: ProxyConfig | null) {
  return {
    engine: DEFAULT_ENGINE,
    ...(WEBHOOK_URL ? { webhooks: [{ url: WEBHOOK_URL, events: HOOK_EVENTS }] } : {}),
    ...(proxy
      ? {
          proxy: {
            // WAHA espera "host:puerto" (http) o con esquema para socks.
            server: proxy.protocol === "http" ? `${proxy.host}:${proxy.port}` : `${proxy.protocol}://${proxy.host}:${proxy.port}`,
            ...(proxy.username ? { username: proxy.username } : {}),
            ...(proxy.password ? { password: proxy.password } : {}),
          },
        }
      : {}),
  };
}

// "5959xxxx" -> "5959xxxx@c.us"; si ya viene un JID lo adapta al formato de WAHA.
const toChatId = (number: string) =>
  number.includes("@") ? number.replace("@s.whatsapp.net", "@c.us") : `${number.replace(/\D/g, "")}@c.us`;

// id de mensaje como STRING serializado. WAHA lo manda distinto según engine/versión:
// WEBJS puede traer un objeto { _serialized } y NOWEB un string plano. El ack y el
// mensaje guardado tienen que usar LA MISMA forma, si no el ERROR del 463 no matchea
// el waMessageId y la burbuja roja nunca aparece.
function serializeId(x: any): string | undefined {
  return x?._serialized ?? (typeof x === "string" ? x : x?.id) ?? undefined;
}

// id serializado del mensaje enviado (los acks llegan con ESTA forma; hay que guardarla).
function sentId(data: any): string | undefined {
  return serializeId(data?.id);
}

async function fetchQr(instanceName: string): Promise<string | undefined> {
  try {
    const { data } = await client().get(`/api/${instanceName}/auth/qr`, {
      params: { format: "image" },
      responseType: "arraybuffer",
    });
    return `data:image/png;base64,${Buffer.from(data).toString("base64")}`;
  } catch {
    return undefined; // todavía no hay QR (sesión arrancando) o ya está emparejada
  }
}

// Crea la sesión y la arranca con webhook configurado. Idempotente: si existe, re-aplica
// la config y la arranca.
export async function createInstance(instanceName: string): Promise<QrResult> {
  const c = client();
  try {
    await c.post("/api/sessions", { name: instanceName, start: true, config: sessionConfig() });
  } catch (e) {
    if (axios.isAxiosError(e) && e.response && e.response.status < 500) {
      await c.put(`/api/sessions/${instanceName}`, { config: sessionConfig() }).catch(() => undefined);
      await c.post(`/api/sessions/${instanceName}/start`).catch(() => undefined);
    } else {
      throw e;
    }
  }
  // El QR tarda unos segundos (status SCAN_QR_CODE); best-effort acá, el panel lo
  // vuelve a pedir con "Conectar / Ver QR".
  const base64 = await fetchQr(instanceName);
  return base64 ? { base64 } : {};
}

// (Re)aplica la config de webhook de la sesión (equivalente al /webhook/set de Evolution).
export async function setWebhook(instanceName: string): Promise<void> {
  if (!WEBHOOK_URL) return;
  await client().put(`/api/sessions/${instanceName}`, { config: sessionConfig() });
}

// QR (sin número) o pairing code (con número, si el engine lo soporta).
export async function connectInstance(instanceName: string, number?: string): Promise<QrResult> {
  const c = client();
  await c.post(`/api/sessions/${instanceName}/start`).catch(() => undefined); // por si estaba parada
  if (number) {
    const digits = number.replace(/\D/g, "");
    const { data } = await c.post(`/api/${instanceName}/auth/request-code`, { phoneNumber: digits });
    return { pairingCode: data?.code ?? data?.pairingCode ?? undefined };
  }
  const base64 = await fetchQr(instanceName);
  return base64 ? { base64 } : {};
}

export async function fetchOwnerNumber(instanceName: string): Promise<string> {
  const c = client();
  try {
    const { data } = await c.get(`/api/sessions/${instanceName}/me`);
    const phone = String(data?.id ?? "").split("@")[0].replace(/\D/g, "");
    if (phone) return phone;
  } catch {
    /* noop */
  }
  try {
    const { data } = await c.get(`/api/sessions/${instanceName}`);
    return String(data?.me?.id ?? "").split("@")[0].replace(/\D/g, "");
  } catch {
    return "";
  }
}

// Estados de WAHA -> los de Evolution que ya entiende el resto de la app.
export async function connectionState(instanceName: string): Promise<string> {
  try {
    const { data } = await client().get(`/api/sessions/${instanceName}`);
    const status = String(data?.status ?? "").toUpperCase();
    if (status === "WORKING") return "open";
    if (status === "STARTING" || status === "SCAN_QR_CODE") return "connecting";
    return status ? "close" : "unknown"; // STOPPED | FAILED
  } catch {
    return "unknown";
  }
}

export async function sendText(instanceName: string, number: string, text: string) {
  const { data } = await client().post("/api/sendText", {
    session: instanceName,
    chatId: toChatId(number),
    text,
  });
  return { ...data, key: { id: sentId(data) } };
}

export async function sendWhatsAppAudio(instanceName: string, number: string, audioBase64: string) {
  try {
    const { data } = await client().post("/api/sendVoice", {
      session: instanceName,
      chatId: toChatId(number),
      file: { mimetype: "audio/ogg; codecs=opus", data: audioBase64 },
    });
    return { ...data, key: { id: sentId(data) } };
  } catch (e) {
    if (axios.isAxiosError(e) && e.response) {
      // En WAHA Core mandar media es feature Plus: que el error lo diga claro.
      throw new Error(`WAHA rechazó el audio (HTTP ${e.response.status}). Enviar media requiere WAHA Plus; en Core probá solo texto.`);
    }
    throw e;
  }
}

export async function getMediaBase64(_instanceName: string, _messageKeyId: string): Promise<MediaBase64 | null> {
  // WAHA entrega la media por URL dentro del propio webhook (payload.media.url, feature
  // Plus); no existe el "re-bajar por id" de Evolution. En la fase de prueba, los chats
  // de texto andan completos; la media entrante queda pendiente para la migración real.
  return null;
}

export async function restartInstance(instanceName: string): Promise<boolean> {
  const c = client();
  try {
    await c.post(`/api/sessions/${instanceName}/restart`);
    return true;
  } catch {
    try {
      await c.post(`/api/sessions/${instanceName}/stop`);
      await c.post(`/api/sessions/${instanceName}/start`);
      return true;
    } catch (e) {
      console.warn("[waha] restartInstance falló:", e instanceof Error ? e.message : String(e));
      return false;
    }
  }
}

export async function logoutInstance(instanceName: string): Promise<void> {
  await client().post(`/api/sessions/${instanceName}/logout`).catch(() => undefined);
}

export async function deleteInstance(instanceName: string): Promise<void> {
  await client().delete(`/api/sessions/${instanceName}`).catch(() => undefined);
}

// El proxy va en la config de la sesión; rige al reiniciarla (el caller ya reinicia).
export async function setProxy(instanceName: string, proxy: ProxyConfig | null): Promise<void> {
  await client().put(`/api/sessions/${instanceName}`, { config: sessionConfig(proxy) });
}

// ---- Webhook: normalización WAHA -> formato Evolution ---------------------------------
// routes/webhook.ts está escrito contra los payloads de Evolution; acá convertimos el
// envelope de WAHA ({ event, session, payload, me }) a esa misma forma para reusar TODA
// la lógica (match de contacto, acks, salud de línea) sin duplicarla.
const ACK_NAME: Record<string, string> = {
  ERROR: "ERROR",
  PENDING: "PENDING",
  SERVER: "SERVER_ACK",
  DEVICE: "DELIVERY_ACK",
  READ: "READ",
  PLAYED: "PLAYED",
};
const ACK_NUM: Record<number, string> = { [-1]: "ERROR", 0: "PENDING", 1: "SERVER_ACK", 2: "DELIVERY_ACK", 3: "READ", 4: "PLAYED" };

export function normalizeWahaEvent(body: any): Record<string, any> | null {
  const event = typeof body?.event === "string" ? body.event : "";
  const session = body?.session;
  if (!session || !["message", "message.any", "message.ack", "session.status"].includes(event)) {
    return null; // no es un webhook de WAHA: se procesa como Evolution
  }
  const p = body.payload ?? {};

  if (event === "session.status") {
    const status = String(p.status ?? "").toUpperCase();
    const state = status === "WORKING" ? "open" : status === "STARTING" || status === "SCAN_QR_CODE" ? "connecting" : "close";
    return { event: "connection.update", instance: session, data: { state }, sender: body?.me?.id };
  }

  if (event === "message.ack") {
    const status =
      (typeof p.ackName === "string" ? ACK_NAME[p.ackName.toUpperCase()] : undefined) ?? ACK_NUM[Number(p.ack)];
    return { event: "messages.update", instance: session, data: status ? { keyId: serializeId(p.id), status } : {} };
  }

  // message / message.any. En los fromMe (enviados desde el teléfono) el peer es `to`.
  return {
    event: "messages.upsert",
    instance: session,
    data: {
      key: { id: serializeId(p.id), remoteJid: p.fromMe ? p.to : p.from, fromMe: !!p.fromMe },
      pushName: p?._data?.notifyName ?? p?._data?.pushName ?? undefined,
      message: { conversation: typeof p.body === "string" ? p.body : "" },
    },
  };
}
