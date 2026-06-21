// Cliente de Evolution API (v2) — maneja instancias de WhatsApp (Baileys por debajo).
// Doc: https://doc.evolution-api.com
import axios, { type AxiosInstance } from "axios";

const BASE_URL = process.env.EVOLUTION_API_URL ?? "http://localhost:8080";
const API_KEY = process.env.EVOLUTION_API_KEY ?? "";
const WEBHOOK_URL = process.env.EVOLUTION_WEBHOOK_URL ?? "";

// Eventos que nos interesan del webhook.
const WEBHOOK_EVENTS = ["QRCODE_UPDATED", "CONNECTION_UPDATE", "MESSAGES_UPSERT"];

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

// Pide (re)conexión y devuelve el QR actual para escanear.
export async function connectInstance(instanceName: string): Promise<QrResult> {
  const c = client();
  const { data } = await c.get(`/instance/connect/${instanceName}`);
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
