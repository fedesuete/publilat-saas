// Motor de WhatsApp intercambiable: Evolution (default, producción) o WAHA (prueba).
// Todo el código llama getEngine().<método> en vez de importar evolution.ts directo;
// el switch es WA_ENGINE=evolution|waha en .env. Sin la variable NO cambia nada:
// Evolution sigue siendo el motor y se puede volver atrás con solo tocar el env.
import * as evolution from "./evolution.js";
import * as waha from "./waha.js";
import type { QrResult, MediaBase64, ProxyConfig } from "./evolution.js";

export interface WhatsAppEngine {
  name: "evolution" | "waha";
  createInstance(instanceName: string): Promise<QrResult>;
  setWebhook(instanceName: string): Promise<void>;
  connectInstance(instanceName: string, number?: string): Promise<QrResult>;
  fetchOwnerNumber(instanceName: string): Promise<string>;
  connectionState(instanceName: string): Promise<string>;
  // Devuelven la forma de Evolution ({ key: { id } }) para que los callers guarden waMessageId.
  sendText(instanceName: string, number: string, text: string): Promise<any>;
  sendWhatsAppAudio(instanceName: string, number: string, audioBase64: string): Promise<any>;
  getMediaBase64(instanceName: string, messageKeyId: string): Promise<MediaBase64 | null>;
  restartInstance(instanceName: string): Promise<boolean>;
  logoutInstance(instanceName: string): Promise<void>;
  deleteInstance(instanceName: string): Promise<void>;
  setProxy(instanceName: string, proxy: ProxyConfig | null): Promise<void>;
}

const evolutionEngine: WhatsAppEngine = {
  name: "evolution",
  createInstance: evolution.createInstance,
  setWebhook: evolution.setWebhook,
  connectInstance: evolution.connectInstance,
  fetchOwnerNumber: evolution.fetchOwnerNumber,
  connectionState: evolution.connectionState,
  sendText: evolution.sendText,
  sendWhatsAppAudio: evolution.sendWhatsAppAudio,
  getMediaBase64: evolution.getMediaBase64,
  restartInstance: evolution.restartInstance,
  logoutInstance: evolution.logoutInstance,
  deleteInstance: evolution.deleteInstance,
  setProxy: evolution.setProxy,
};

const wahaEngine: WhatsAppEngine = {
  name: "waha",
  createInstance: waha.createInstance,
  setWebhook: waha.setWebhook,
  connectInstance: waha.connectInstance,
  fetchOwnerNumber: waha.fetchOwnerNumber,
  connectionState: waha.connectionState,
  sendText: waha.sendText,
  sendWhatsAppAudio: waha.sendWhatsAppAudio,
  getMediaBase64: waha.getMediaBase64,
  restartInstance: waha.restartInstance,
  logoutInstance: waha.logoutInstance,
  deleteInstance: waha.deleteInstance,
  setProxy: waha.setProxy,
};

export function getEngine(): WhatsAppEngine {
  return (process.env.WA_ENGINE ?? "evolution").trim().toLowerCase() === "waha" ? wahaEngine : evolutionEngine;
}
