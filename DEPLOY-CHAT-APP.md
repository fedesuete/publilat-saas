# DEPLOY — Chat App (canal jugador↔cajero)

Guía para poner en producción el **módulo Chat App** (PWA instalable + Inbox en el panel +
Web Push + branding white-label). Complementa el `DEPLOY.md` general — **no lo reemplaza**.

Es **aditivo puro**: no toca WhatsApp/atribución. Si algo sale mal, el rollback es simplemente
**no exponer** la PWA ni setear las env nuevas — el resto de la plataforma sigue igual.

> Producción: VPS Hostinger, `https://app.publi.lat` (187.77.33.164, `/opt/publilat`, Traefik de EasyPanel).

---

## 0. Qué se agregó (commits, en orden)

| Fase | Commit | Qué trae |
|------|--------|----------|
| F1 | `417bb3e` | Tablas `Chat*` + auth del jugador (JWT `type:"client"`) + namespace `/chat` |
| F2 | `8dc7c23` | Invites single-use + registro/login passwordless (`/api/chat/*`) |
| F3 | `5c9806d` | Inbox del chat en el panel (lista + hilo en vivo + "Mi Invitación") |
| F4 | `5b7d8a6` | **PWA del jugador** (`frontend-pwa/`) + CORS del chat + single-use atómico |
| F5 | `bd4d366` | **Web Push** (VAPID) con cola BullMQ aislada `chat-push` |
| F6 | `ec2c09d` | **Branding white-label** (logo/colores/textos + pestaña "Marca") |

**F1–F3 ya están deployados** (batch anterior, con `backup-publilat-20260713-pre-chat.sql`,
`prisma migrate deploy` y smoke test OK). **Este deploy cubre F4–F6.**

---

## 1. Migraciones de base de datos

La migración del módulo (`20260713060000_chat_module`) **ya fue aplicada** en el deploy de F1–F3.
F4–F6 **no agregan tablas nuevas** (usan las de F1: `ChatPlayer`, `ChatConversation`,
`ChatMessage`, `InviteCode`, `ChatPushSub`, y las columnas de branding en `User`).

**Antes de cualquier `migrate deploy`, backup primero.** No usar `db push` en producción.

```bash
# 1) Backup (SIEMPRE antes de tocar la DB)
pg_dump "$DATABASE_URL" > backup-publilat-$(date +%Y%m%d-%H%M)-pre-chat-f4f6.sql

# 2) Revisar a ojo qué migraciones están pendientes (no debería faltar ninguna nueva)
cd backend && npx prisma migrate status

# 3) Aplicar SOLO si status marca pendientes (NO db push)
npx prisma migrate deploy
```

> Si `migrate status` dice "up to date", no hay nada que migrar: pasá al paso 2.

---

## 2. Variables de entorno nuevas (backend, en el `.env` del VPS)

| Var | Obligatoria | Para qué |
|-----|-------------|----------|
| `CHAT_PWA_ORIGIN` | **Sí** (si servís la PWA) | Origen(es) de la PWA, separados por coma. CORS permitido **solo** en `/api/chat/*` y en el handshake del socket `/chat`. Ej: `https://chat.publi.lat` |
| `VAPID_PUBLIC_KEY` | No (sin ella, push OFF) | Clave pública VAPID de Web Push |
| `VAPID_PRIVATE_KEY` | No (sin ella, push OFF) | Clave privada VAPID |
| `VAPID_SUBJECT` | No | `mailto:` de contacto. Default `mailto:soporte@publi.lat` |

**Generar el par VAPID** (una sola vez; guardar en el `.env`, **no** commitear):

```bash
npx web-push generate-vapid-keys
# => Public Key:  BJ...   -> VAPID_PUBLIC_KEY
#    Private Key: xC...   -> VAPID_PRIVATE_KEY
```

Sin `VAPID_*`, el Web Push queda en **no-op** (la cola `chat-push` ni arranca; el chat sigue
andando por socket con la app abierta). Se puede activar después sin re-deployar código.

> **Redis:** la cola `chat-push` usa el `REDIS_URL` ya existente. Es una cola **nueva y aislada**;
> no comparte nombre ni toca las colas de WhatsApp (`line-expiry`).

---

## 3. Servir la PWA del jugador (`frontend-pwa`)

Es un workspace Vite **independiente** del panel. Se buildea aparte y se sirve en un
**subdominio propio** (para aislar el service worker y el scope del panel).

### 3.1 Build

```bash
export VITE_API_URL=https://app.publi.lat        # a qué API pega la PWA
npm --workspace publilat-chat-pwa run build
# genera frontend-pwa/dist/  (index.html + assets + sw.js + manifest + iconos)
```

### 3.2 DNS + subdominio

1. Crear `chat.publi.lat` (registro A → `187.77.33.164`, o CNAME según el resto del setup).
2. En EasyPanel/Traefik, publicar `frontend-pwa/dist/` como sitio estático en `chat.publi.lat`
   con **HTTPS** (Web Push y `beforeinstallprompt` **exigen** TLS; `localhost` es la única excepción).
3. Cabeceras: servir `sw.js` y `index.html` con `Cache-Control: no-cache` (el `index.html` ya lo
   pide; confirmá que el proxy no cachee el service worker o las actualizaciones no llegan).

### 3.3 CORS: conectar la PWA con la API

En el `.env` del backend, setear el origen de la PWA y **redeploy** del backend:

```env
CHAT_PWA_ORIGIN=https://chat.publi.lat
```

Habilita ese origen **solo** para `/api/chat/*` y el socket `/chat`. **Nunca** se usa `origin:*`
con `credentials` (la PWA va por `Authorization: Bearer`, no por cookie).

### 3.4 Panel: link de invitación

El panel arma los links `/i/:code` con `VITE_CHAT_PWA_URL`. Al buildear el **panel**:

```bash
export VITE_CHAT_PWA_URL=https://chat.publi.lat
npm --workspace frontend run build
```

Si no se setea, cae al default `https://chat.publi.lat` (ya es el valor esperado; dejarlo
explícito evita sorpresas si cambia el dominio).

### 3.5 Iconos (opcional pero recomendado)

`frontend-pwa/public/icon-192.png` y `icon-512.png` son **placeholders verdes**. Para el look
final, reemplazarlos por el logo real (mismos nombres y tamaños) y re-buildear.

---

## 4. Smoke test (post-deploy)

Con la API redeployada y la PWA publicada en `chat.publi.lat`:

**Panel (operador):**
1. Panel → sección **Chat** → **Mi Invitación** → **Crear link**. Aparece link + QR.
2. Pestaña **Marca**: subir logo, elegir color, escribir bienvenida → **Guardar** → ✓.

**PWA (jugador), en el celu o en otra pestaña:**
3. Abrir `https://chat.publi.lat/i/<code>` → se ve la **marca** del operador (logo/color/texto).
4. (Móvil) ofrece **instalar**; registrarse con un usuario → entra al chat.
5. Mandar un mensaje → aparece en el **Inbox** del panel al toque (socket en vivo).
6. Responder desde el panel → llega a la PWA en vivo.
7. Con `VAPID_*` seteado: aceptar el banner **🔔 Activar**; cerrar la PWA; responder desde el
   panel → llega la **notificación push**. Al tocarla, abre el chat.
8. Abrir el **mismo** link otra vez → **"link ya usado"** (single-use, 404 en `/register`).

**Aislamiento (que NO se rompió WhatsApp):**
9. El Inbox de **WhatsApp** sigue igual. El Chat App usa otro socket namespace (`/chat`), otras
   tablas y otra cola — no comparte nada.

---

## 5. Notas / pendientes conocidos

- **Subdominio por operador (branding por dominio) — NO implementado.** Hoy todos comparten la
  misma PWA (`chat.publi.lat`) y el branding se pinta **en runtime** según el `:code` del link (o
  el `accountSlug` guardado). Un dominio dedicado por operador (`chat.sucasino.com`) requeriría
  wildcard DNS + TLS por subdominio + resolver la cuenta por `Host`. Queda para más adelante; el
  modelo actual ya da white-label visual sin esa complejidad.
- **Logo/imágenes de branding:** con S3/CDN (`AWS_*` + `CLOUDFRONT_DOMAIN`, ya usados por landings)
  se suben con **nombre aleatorio** y se sirven desde el CDN. **Sin S3**, el endpoint devuelve el
  *data URL* y se guarda inline en la DB — funciona, pero conviene tener S3 en prod.
- **Tope de imagen 700 KB:** el body global de la API es 1 MB; 700 KB en base64 (~1.37x) entra con
  margen. Para imágenes más grandes haría falta un endpoint con parser propio (hoy no se justifica).
- **iOS:** el push web en iPhone **solo** funciona con la PWA **instalada** (Agregar a inicio) y
  iOS 16.4+. La PWA ya guía la instalación; el banner de notificaciones aparece recién adentro.
- **Iconos placeholder** (§3.5): reemplazar por el logo real antes de mostrarlo a clientes.

---

## 6. Rollback

Aditivo: para desactivar el módulo sin tocar nada más, **despublicar** `chat.publi.lat` y quitar
`CHAT_PWA_ORIGIN`/`VAPID_*` del `.env` (la cola `chat-push` no arranca sin VAPID). El panel puede
seguir mostrando la sección Chat sin jugadores. Si se quisiera revertir código, los commits F4–F6
(`5b7d8a6`, `bd4d366`, `ec2c09d`) son independientes y no tienen migraciones nuevas asociadas.
