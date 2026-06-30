# QA — Revisión completa de la plataforma (Publi.lat)

Recorrido en vivo de app.publi.lat, sección por sección, con revisión de consola y funcionalidad.
Fecha: 30/06/2026. Combina los bugs funcionales encontrados + los hallazgos de seguridad.

> Veredicto general: la app está **sólida y operativa**. No hay errores de consola en ninguna
> sección y el loop real funciona (clic → lead → chat → CRM). Hay **3 bugs funcionales** (1 alto,
> 1 medio, 1 bajo) y los hallazgos de seguridad ya documentados aparte.

---

## ✅ Lo que funciona bien
- **Dashboard:** métricas en vivo correctas (clics, chats, líneas activas, embudo, por campaña/fuente). Sin errores.
- **Leads:** lista con etapa, fuente, código, fbclid, monto, acciones. OK.
- **Agenda / Kanban:** contactos con su atribución; mover de etapa. OK.
- **Inbox:** abre conversaciones, muestra mensajes entrantes y salientes. OK (ver bug #2).
- **WhatsApp:** conexión Cloud (Embedded Signup) + Baileys, registro de número, reconectar webhook. OK.
- **Mi Pixel** (`/pixel`): formulario para cargar Pixel ID + token CAPI. OK.
- **Créditos** (`/billing`): muestra días disponibles y movimientos. Carga OK (ver bug #1).
- **Soporte:** chat del usuario hacia el dueño. OK.
- **Panel Admin** (`/admin`): **correctamente protegido** — con un usuario no-admin redirige al Dashboard. ✅ (buen control de acceso)
- **Sin errores de consola** en ninguna sección recorrida.

---

## 🐛 Bugs funcionales encontrados

### #1 — [ALTO] "Comprar días" es un stub: no se puede pagar
**Dónde:** Créditos (`/billing`) → sección "Comprar días".
**Qué pasa:** dice textual *"Stub de compra — la pasarela de pago real llega en F5."* El frontend
no está conectado a una pasarela real, así que **el usuario no puede comprar días**. El backend
ya tiene integrados MercadoPago, USDT/NOWPayments y Stripe (webhooks), pero el botón de compra del
panel no los usa. **Bloquea ingresos.**
**Fix (prompt Claude Code):**
```
En el frontend, la página de Créditos (/billing) tiene un "Stub de compra" en vez de la pasarela
real. El backend ya tiene los endpoints de billing (MercadoPago, USDT/NOWPayments, Stripe).
Conectá el botón "Comprar días" a esos endpoints reales: al elegir cantidad de días + medio de
pago, que llame al endpoint de checkout correspondiente del backend y redirija/abra el flujo de
pago real. Sacá el texto "Stub de compra — la pasarela de pago real llega en F5". Mostrá el estado
del pago y, al confirmarse (webhook), que se acrediten los días. typecheck + build.
```

### #2 — [MEDIO] Mensaje saliente duplicado en el Inbox (solo visual)
**Dónde:** Inbox, al responder un mensaje.
**Qué pasa:** al enviar desde Publi, el mensaje aparece **dos veces** en la conversación, pero al
cliente le llega **uno solo** y en la base de datos queda **uno solo** (lo confirmé recargando: se
ve una sola vez). Es duplicación **solo en la UI en vivo**: el mensaje se agrega por la respuesta
del POST y otra vez por el evento de Socket.IO.
**Fix (prompt Claude Code):**
```
Bug visual en el Inbox: al ENVIAR un mensaje aparece duplicado (al cliente le llega uno y en la DB
es uno). Causa: el saliente se agrega dos veces — por la respuesta del POST y por el evento de
Socket.IO "inbox:message". Arreglá en frontend (InboxPage.tsx):
1) Deduplicá por id de mensaje: si ya existe uno con ese id en el estado, no lo agregues de nuevo.
2) Usá UNA sola fuente de verdad para el saliente (recomendado: agregar optimista con id temporal
   y reconciliar con el id real cuando llega el socket).
3) Verificá que el entrante siga apareciendo una sola vez. build frontend.
```

### #3 — [BAJO/UX] Contactos mostrados por UUID en Kanban
**Dónde:** Kanban (y donde no hay nombre).
**Qué pasa:** un contacto aparece como `74ad6fdc-aaa…` (su UUID/externalId) en vez del teléfono o
un nombre. En el Inbox sí se muestra el teléfono (`5491168315055`). Inconsistente y poco legible.
**Fix (prompt Claude Code):**
```
En el Kanban (y en Leads/Agenda donde aplique), los contactos sin nombre se muestran por su UUID
(externalId). Mostralos por: name si existe, si no el phone formateado, y solo como último recurso
el código corto — nunca el UUID crudo. Unificá ese "displayName" de contacto en un helper y usalo
en Kanban, Leads, Agenda e Inbox. build frontend.
```

---

## 🔒 Seguridad (resumen — detalle en AUDITORIA-SEGURIDAD.md)
Pendientes antes de abrir a clientes reales:
- **C1 [Crítico]** — Webhooks de WhatsApp sin validar firma (X-Hub-Signature-256).
- **C2 [Crítico]** — SSRF en el webhook saliente de Integraciones (bloquear IPs internas).
- **A1 [Alto]** — XSS almacenado en landings de HTML libre (sanitizar o servir en dominio sandbox).
- **A2 [Alto]** — JWT en localStorage 7 días sin revocación (cookie httpOnly + revocación).
- **A3 [Alto]** — Webhook de MercadoPago sin validar firma.
- Varios medios/bajos (CSP off, secret de integración en claro, etc.).

---

## Plan de arreglo sugerido (orden)
1. **Bug #2** (duplicado Inbox) — rápido, mejora la experiencia ya.
2. **Seguridad C1 + C2** (los 2 críticos) — antes de cualquier cliente real.
3. **Bug #1** (pasarela de pago real) — necesario para cobrar.
4. **Seguridad A1–A3** (los 3 altos).
5. **Bug #3** (UUID → teléfono/nombre) — pulido.
6. **Panel Maestro** (super-admin) — cuando quieras (prompt en PROMPT-PANEL-MAESTRO.md).

Cada ítem tiene su prompt listo para copiar/pegar en Claude Code (arriba o en los docs citados).
