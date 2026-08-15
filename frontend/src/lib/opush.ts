// Web Push del OPERADOR (panel): suscribe ESTE dispositivo para recibir avisos con sonido cuando un
// jugador escribe/carga, aunque el panel esté cerrado. Reusa el service worker del panel (workbox) +
// las claves VAPID del backend. El handler del push vive en public/push-sw.js.
import { api } from "./api";

// Devuelve un ArrayBuffer (no Uint8Array) para que tipe limpio en applicationServerKey (evita el
// choque Uint8Array<ArrayBufferLike> vs ArrayBuffer de TS 5.7).
function urlB64ToArrayBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

export function opushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
export function opushPermission(): NotificationPermission | "unsupported" {
  return opushSupported() ? Notification.permission : "unsupported";
}

// Pide permiso (si falta), suscribe al push y registra el endpoint en el backend. Devuelve el estado.
export async function subscribeOperatorPush(): Promise<NotificationPermission | "unsupported"> {
  if (!opushSupported()) return "unsupported";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm;
  const { data } = await api.get<{ key: string | null }>("/api/chat/push/public-key");
  if (!data.key) return "denied"; // Web Push no configurado en el server
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToArrayBuffer(data.key) }));
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return "denied";
  await api.post("/api/chat/operator/push/subscribe", {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    userAgent: navigator.userAgent.slice(0, 300),
  });
  return "granted";
}
