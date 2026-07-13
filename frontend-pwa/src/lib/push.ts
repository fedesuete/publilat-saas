// Suscripción a Web Push desde la PWA. Pide permiso, se suscribe con la clave VAPID pública
// del backend y registra el endpoint en /api/chat/push/subscribe. Best-effort: cualquier fallo
// deja el chat andando igual (el socket sigue siendo el canal principal con la app abierta).
import { api } from "./api";

export type PushState = "unsupported" | "disabled" | "denied" | "granted" | "error";

// La clave VAPID pública se pasa como ArrayBuffer (BufferSource) — máxima compatibilidad de navegadores.
function urlBase64ToBytes(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return buffer;
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function pushPermission(): NotificationPermission | "unsupported" {
  return pushSupported() ? Notification.permission : "unsupported";
}

export async function subscribeToPush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  try {
    const { data } = await api.get<{ key: string | null }>("/api/chat/push/public-key");
    if (!data.key) return "disabled"; // VAPID no configurado en el backend
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";

    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(data.key) }));
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return "error";

    await api.post("/api/chat/push/subscribe", {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: navigator.userAgent.slice(0, 300),
    });
    return "granted";
  } catch (e) {
    console.warn("[push] no se pudo suscribir:", e instanceof Error ? e.message : String(e));
    return "error";
  }
}
