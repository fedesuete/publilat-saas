# SUPER-PROMPT — Cerrar el módulo Chat: Fases 4, 5 y 6 (PWA + Web Push + Branding)

> Pegá TODO este bloque en Claude Code. Ya están hechas y deployadas F1–F3 (tablas Chat*, auth del
> jugador, namespace /chat, /api/chat/*, Inbox del chat en el panel). Ahora completás las 3 fases que
> faltan **de corrido, sin parar entre fases** (el dueño está durmiendo), commiteando cada una.
> **NO deployes**: al final dejás un DEPLOY.md con el checklist para la mañana.

```
Sos un ingeniero senior en el repo de Publi.lat. F1–F3 del módulo chat YA están hechas, commiteadas y
deployadas en prod (verificado por smoke test). Completá F4, F5 y F6 EN ORDEN, sin parar a pedir
confirmación entre fases, commiteando cada fase. NO hagas deploy. Al terminar, dejás un DEPLOY.md.

============================================================
0) CONTEXTO DE STACK (respetar al pie de la letra)
============================================================
- Publi es Express + Prisma + React+Vite + Tailwind + socket.io. NO es NestJS: nada de decoradores,
  gateways, guards ni JwtService de Nest.
- Prisma: IDs con @default(cuid()) (NO uuid), String/DateTime planos, SIN @db.*/@map/@@map/gen_random_uuid.
- Auth jugador: JWT { type:"client", accountId, playerId } vía signToken (lib/auth.ts). Middleware
  requireChatClient YA existe. En la PWA el token va como Bearer (localStorage), NO cookie.
- Socket: namespace "/chat" YA existe (aparte del default), con helper emitChat y io.playerHasLiveSocket.
- Rutas /api/chat/* YA existen: invites (operador), branding/:code (público), register, login, messages,
  conversations, me/conversation, me/messages. Las tablas ChatPlayer/ChatConversation/ChatMessage/
  InviteCode/ChatPushSub YA existen (ChatPushSub ya está creada desde F1 → F5 NO necesita migración nueva).
- Branding en User YA existe: brandName, logoUrl, primaryColor, accentColor, welcomeText, welcomeMsgText,
  welcomeMsgImage.

============================================================
NO TOCAR (aditivo puro)
============================================================
Contact, Message, WaLine, routes/go.ts, routes/wa*.ts, routes/inbox.ts, lib/evolution.ts, lib/waha.ts,
lib/wa-engine.ts, lib/io.ts salvo agregar helpers nuevos, el namespace DEFAULT de socket y su auth en
index.ts, middleware/requireAuth.ts, y el flujo de atribución/CAPI. Si algo te obliga a tocar eso, PARÁ
y dejá el error anotado en DEPLOY.md (no rompas WhatsApp para avanzar).

============================================================
PROCESO
============================================================
- F4 → F5 → F6 en orden. Después de CADA fase: typecheck backend + build de los frontends + tests, y
  commit. Si una fase falla y no la podés dejar verde sin tocar la lista NO TOCAR, dejala en una rama/
  commit aparte, anotá el bloqueo en DEPLOY.md y seguí con lo que sí se pueda.
- Aislamiento: TODA query del chat filtra por el userId/cuenta del token. Nunca por id del body/URL.
- NO deployes. NO corras migrate deploy contra prod. Las migraciones nuevas (si hubiera) quedan como
  archivo, listas para aplicar en el deploy manual.

============================================================
(OPCIONAL, barato) Endurecer single-use del invite
============================================================
En POST /api/chat/register, al cerrar el link cambialo a un cierre atómico:
`updateMany({ where: { id, isActive: true }, data: { isActive: false } })` y seguí SOLO si count===1;
si count===0 (otro se lo llevó en paralelo), borrá el ChatPlayer recién creado y devolvé 404. Mantené
el 409 por username tomado ANTES de crear el player. Si te complica, dejalo como está y anotalo.

============================================================
FASE 4 — PWA del jugador (frontend NUEVO)
============================================================
- Carpeta nueva `frontend-pwa` (NO tocar `frontend`): React + Vite + Tailwind + vite-plugin-pwa
  (injectManifest, service worker propio). Cliente socket.io-client apuntando al namespace "/chat".
- Ruta /i/:code → GET /api/chat/branding/:code → aplica marca (CSS vars primaryColor/accentColor, title,
  favicon/apple-touch-icon con logoUrl) y guarda branding en localStorage. Si codeActive=false, mostrá
  "este link ya fue usado" (pero igual permití reingreso por login).
- Pantalla "instalá primero": captura beforeinstallprompt y botón Instalar; en iOS mostrá instructivo
  "Compartir → Agregar a inicio". No bloquees el chat si no se puede instalar (fallback web).
- Registro passwordless: form username → POST /api/chat/register (manda fbclid/fbp/fbc si están en la URL
  o cookies _fbp/_fbc) → guarda el JWT client en localStorage.
- Reingreso: pantalla de login → POST /api/chat/login { accountSlug, username } (accountSlug viene del
  branding). Guarda el JWT.
- Chat: hilo (GET /api/chat/me/conversation + messages) + input (POST /api/chat/me/messages), socket al
  namespace "/chat" con el JWT client como auth → recibe chat:message en vivo. Dedup por id
  (optimistic add + echo), mismo patrón del panel.
- Manifest (name/short_name/icons/display:standalone/theme_color desde branding si se puede, o genérico)
  + service worker: precache del shell + push handler (F5) + notificationclick que enfoca/abre la PWA.
  index.html con headers no-cache.
- CORS backend: agregá el origen de la PWA (env nuevo CHAT_PWA_ORIGIN, ej. https://chat.publi.lat) a la
  allowlist SOLO para /api/chat/* y para el handshake del namespace /chat. NUNCA origin:* con
  credentials:true. NO toques el CORS del panel (PANEL_BASE_URL) ni su SPA fallback.
VERIFICACIÓN F4: `frontend-pwa` buildea; el panel (`frontend`) sigue buildeando igual; typecheck backend
OK; el CORS del panel y de WhatsApp sin cambios.

============================================================
FASE 5 — Web Push
============================================================
- VAPID: generá el par (web-push generate-vapid-keys) y documentá en .env.example las vars
  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:soporte@publi.lat). NO pongas claves reales
  en el repo; en DEPLOY.md indicá que hay que setearlas en prod.
- Rutas: GET /api/chat/push/public-key (pública); POST /api/chat/push/subscribe (requireChatClient) →
  guarda/actualiza ChatPushSub (unique userId+endpoint, upsert). POST /api/chat/push/broadcast
  (requireAuth, operador) → encola push a todos los ChatPushSub de SU cuenta (promos).
- Disparo automático: cuando el operador manda un mensaje a un jugador SIN socket vivo
  (io.playerHasLiveSocket === false) → encolá un Web Push a los ChatPushSub de ese jugador. Usá
  BullMQ/Redis (ya está en el repo) con una QUEUE NUEVA (ej. "chat-push"); NO reuses ni toques las
  colas existentes de WhatsApp. Limpiá subs con endpoint 410/404 (gone).
- PWA: pedir permiso de notificaciones DESPUÉS de instalar (no al entrar); si concede, registerSubscription
  con la public-key → POST /api/chat/push/subscribe; mostrar estado (activadas/desactivadas). El service
  worker muestra la notificación y notificationclick abre/enfoca la conversación.
VERIFICACIÓN F5: typecheck + build OK; la cola nueva no interfiere con las de WhatsApp; el envío del
operador sigue funcionando aunque el push falle (push es best-effort, no debe romper el POST /messages).

============================================================
FASE 6 — Branding white-label (panel)
============================================================
- Sección/tab nueva en el panel (dentro de "Chat" o en Ajustes) para que el operador cargue su marca:
  brandName, logoUrl (subida con nombre de archivo aleatorio), primaryColor, accentColor, welcomeText,
  welcomeMsgText, welcomeMsgImage. Reusá components/ui. Ruta backend PATCH /api/chat/branding
  (requireAuth) que actualiza SOLO los campos de branding del User del token (nunca por id del body).
- Preview en vivo de cómo se ve la PWA (opcional, si es barato).
- Subdominio por operador para PWA con marca propia: NO lo implementes; dejá una nota en DEPLOY.md como
  decisión de producto futura (v1 usa un solo subdominio chat.publi.lat + branding por code).
VERIFICACIÓN F6: typecheck + build OK; el branding se guarda contra el userId del token; el resto del
panel intacto.

============================================================
AL TERMINAR — DEPLOY.md (para la mañana)
============================================================
Creá DEPLOY.md en la raíz con:
- Lista de commits por fase.
- Migraciones nuevas a aplicar (si hubiera) — recordá: migrate deploy, no db push; backup antes.
- Env vars nuevas a setear en prod: CHAT_PWA_ORIGIN, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
- Cómo servir la PWA: build de frontend-pwa + subdominio chat.publi.lat (DNS + server/estático) + entrada
  de CORS. Aclarar que esto es lo único de infra nuevo y por eso el deploy es manual.
- Checklist de smoke test post-deploy (en este orden):
  1) WhatsApp real: mandar/recibir un mensaje con una línea conectada, QR/estado en vivo → DEBE seguir igual.
  2) PWA: abrir /i/:code (link real) → instalar → registrarse → chatear → ver el mensaje en vivo en el
     panel del operador y viceversa.
  3) Push: con la PWA instalada y cerrada, que el operador mande un mensaje → llega la notificación.
- Cualquier bloqueo que hayas encontrado (si tuviste que dejar algo a medias).

Empezá por F4 y andá derecho hasta F6. Commit por fase. NO deploy.
```
