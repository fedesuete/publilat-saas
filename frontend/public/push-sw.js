/* Handler de Web Push del PANEL (operador). Se importa en el service worker autogenerado por workbox
   (ver vite.config.ts -> workbox.importScripts). Muestra la notificación con el sonido del sistema del
   celular (aunque el panel esté CERRADO) y, al tocarla, abre/enfoca el panel en la sección del chat. */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text ? event.data.text() : "" }; }
  const title = data.title || "Publi.lat";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "publilat-op",   // agrupa: muestra el último aviso (no apila decenas)
    renotify: true,       // pero vuelve a sonar/vibrar en cada mensaje nuevo
    vibrate: [90, 40, 90],
    data: { url: data.url || "/chat" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/chat";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) { try { w.navigate(url); } catch (e) { /* cross-origin / no soportado */ } return w.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
