/// <reference lib="webworker" />
// Service worker de la PWA del Chat. injectManifest: vite-plugin-pwa inyecta la lista de
// precache en self.__WB_MANIFEST. Maneja el shell + Web Push (Fase 5).
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

// Precache del shell (inyectado por vite-plugin-pwa en build).
precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches(); // borra precaches de versiones anteriores

self.addEventListener("install", () => {
  void self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

// Web Push: el backend manda { title, body, url }.
self.addEventListener("push", (event: PushEvent) => {
  let data: { title?: string; body?: string; url?: string } = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  const title = data.title || "Nuevo mensaje";
  const options: NotificationOptions = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/chat" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Al tocar la notificación: enfocar la app si está abierta, o abrirla.
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url || "/chat";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) return (c as WindowClient).focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
