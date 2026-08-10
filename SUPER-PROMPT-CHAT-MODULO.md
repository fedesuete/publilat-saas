# SUPER-PROMPT — Módulo "Chat App" (jugador↔cajero) aislado dentro de Publi.lat

> Pegá TODO este bloque en Claude Code (VS Code). Está pensado para arrancar y ejecutar el desarrollo
> **fase por fase, con verificación entre cada una**. No lo hagas todo de una: seguí el orden y las
> compuertas. Si algo te obliga a romper lo marcado en "NO TOCAR", PARÁ y avisá.

```
Sos un ingeniero senior trabajando DENTRO del repo de Publi.lat. Vas a construir un MÓDULO NUEVO y
AISLADO: un chat instalable jugador↔cajero (tipo "reemplazo de WhatsApp") como CANAL aparte, con su
propio Inbox, sus propias tablas y su propio namespace de Socket.IO. WhatsApp queda CONGELADO.

============================================================
0) CONTEXTO DE STACK — RESPETAR AL PIE DE LA LETRA
============================================================
- Publi es **Express + Prisma + React+Vite + Tailwind + socket.io**. NO es NestJS.
  Prohibido: decoradores (@Injectable/@Controller/@WebSocketGateway), guards, modules, JwtService de
  Nest. Usá routers de Express + middlewares como el código existente.
- Tengo un "handoff" de un chat casino escrito en NestJS/Preact: es REFERENCIA CONCEPTUAL del flujo,
  NO código para copiar. NO copies su Prisma ni sus decoradores.
- Prisma (mirá schema.prisma como plantilla de estilo — modelos User y Contact):
  IDs = `String @id @default(cuid())` (cuid, NO uuid). Campos `String?` / `DateTime @default(now())`.
  PROHIBIDO: @db.Uuid, @db.Citext, @db.Timestamptz, @db.VarChar, @map("..."), @@map("..."),
  gen_random_uuid. Columnas camelCase, nombres de tabla por defecto.
- Auth: usá `signToken`/`verifyToken` de lib/auth.ts (NO otra librería JWT). `requireAuth`
  (middleware/requireAuth.ts) lee cookie httpOnly `publilat_token` o Bearer, valida `tokenVersion` e
  inyecta `req.userId`. NO lo modifiques.
- Socket: existe UN `Server` de socket.io creado en index.ts, namespace DEFAULT, salas `user:${userId}`,
  helper `emitToUser` (lib/io.ts). NO toques el default ni su auth.
- Modelos existentes: NO hay `Conversation` ni `Operator` (el Inbox es Contact+Message; el operador ES
  el `User` de la cuenta). `Message` EXIGE `lineId` (WaLine, WhatsApp) → NO lo reuses. Ya existen
  `Message` y `SupportMessage` → el chat usa nombres con prefijo `Chat`.
- `User.slug` (unique) es el "accountSlug".
- Frontend panel: react-router-dom (rutas en src/App.tsx), nav en src/components/AppLayout.tsx,
  componentes en src/components/ui (Button/Input/Card), ProtectedRoute. SIN TanStack/shadcn.
- CAPI: `sendCapiEvent` está en lib/meta-capi.ts.

============================================================
1) NO TOCAR (aditivo puro)
============================================================
NO modifiques ni rompas: Contact, Message, WaLine, routes/go.ts, routes/wa.ts, routes/wa-cloud.ts,
routes/inbox.ts, lib/evolution.ts, lib/waha.ts, lib/wa-engine.ts, lib/io.ts, el namespace default y el
auth de socket de index.ts, middleware/requireAuth.ts, y el flujo de atribución/CAPI. El módulo es
ADITIVO: tablas nuevas (prefijo Chat + InviteCode), rutas /api/chat/*, namespace /chat, sección nueva
en el panel, y una PWA nueva. Si algo te obliga a tocar lo de arriba, PARÁ y avisá.

============================================================
2) LEÉ ANTES DE ESCRIBIR (obligatorio)
============================================================
schema.prisma, lib/io.ts, index.ts, middleware/requireAuth.ts, lib/auth.ts, lib/meta-capi.ts,
components/AppLayout.tsx, App.tsx, y una página existente (ej. InboxPage.tsx) para copiar el estilo.

============================================================
3) PROCESO (para que salga funcional en una tirada)
============================================================
- Ejecutá las fases EN ORDEN. Después de CADA fase: `typecheck` backend + `build` frontend + tests, y
  commit. NO pases a la siguiente si algo falla.
- Al final de cada fase, VERIFICÁ (no asumas) que el Inbox/socket/envío de WhatsApp sigue igual.
- Migraciones SOLO aditivas (tablas nuevas + campos nullable). Incluí la migración en cada fase.
- Aislamiento: TODA query del chat filtra por `req.userId`/cuenta del token. Nunca por id del body/URL.

============================================================
FASE 1 — Tablas aisladas + auth del jugador + namespace /chat
============================================================
1) Tablas NUEVAS en Prisma (prefijo Chat), todas con userId (cuenta), estilo Publi (cuid, String,
   DateTime @default(now())):
   - ChatPlayer { id, userId, nombre, casinoUsername, invitedByUserId?, inviteCodeId?, estatus @default("active"), createdAt } + unique (userId, casinoUsername)
   - ChatConversation { id, userId, playerId, assignedOperatorId?, status @default("open"), unreadOperator @default(0), unreadPlayer @default(0), lastMessageAt?, lastMessagePreview?, createdAt }
   - ChatMessage { id, userId, conversationId, senderType ("player"|"operator"|"system"), senderId?, body?, metadata Json @default("{}"), readAt?, createdAt } + index (conversationId, createdAt)
   - InviteCode { id, userId, operatorId, code @unique, label?, isActive @default(true), createdAt } + index (userId, operatorId)
   - ChatPushSub { id, userId, playerId?, endpoint, p256dh, auth, userAgent?, createdAt } + unique (userId, endpoint)
   Relaciones a User/entre sí bien resueltas. Migración.
2) Auth del jugador: JWT tipo client con `signToken({ type:"client", accountId, playerId })`, 30 días.
   Middleware NUEVO `requireChatClient` (valida y expone req.chatPlayerId/req.accountId). NO tocar requireAuth.
3) Namespace NUEVO "/chat" en el MISMO Server de socket.io (agregarlo en index.ts SIN tocar el default):
   middleware propio que acepte token de operador O de client; salas chat:{userId},
   chat:{userId}:op:{operatorId}, chat:{userId}:player:{playerId}, chat:conv:{conversationId}. Exponé
   un helper (ej. emitChat) análogo a emitToUser.
4) Branding en User (campos nullable): brandName, logoUrl, primaryColor, accentColor, welcomeText,
   welcomeMsgText, welcomeMsgImage.
VERIFICACIÓN F1: typecheck OK; migración aplica; el socket/Inbox de WhatsApp funciona idéntico.

============================================================
FASE 2 — Invites + registro passwordless (/api/chat/*)
============================================================
- Operador (requireAuth): GET /api/chat/invites; POST /api/chat/invites {label} (code 8 chars
  base64url, unique); DELETE /api/chat/invites/:id (ownership por userId).
- Público: GET /api/chat/branding/:code (branding de la cuenta para pintar la PWA).
- POST /api/chat/register { code, username, fbclid?, fbp?, fbc? }: resuelve el code (solo isActive) →
  crea ChatPlayer (casinoUsername=username, invitedByUserId=operator, inviteCodeId) → CIERRA el link
  (isActive=false) DESPUÉS de crear el player (si el username está tomado, que pueda reintentar) →
  abre ChatConversation asignada al operator del code → guarda el mensaje de bienvenida
  (welcomeMsgText/Image) → si vino fbclid, dispara Lead llamando `sendCapiEvent` de lib/meta-capi.ts
  (NO tocar go.ts) → devuelve JWT client. Unique parcial + capturar P2002 contra race.
- POST /api/chat/login { accountSlug, username } (reingreso passwordless; resuelve la cuenta por User.slug).
VERIFICACIÓN F2: registro por link OK; 2º registro por el MISMO link → 404; WhatsApp intacto.

============================================================
FASE 3 — Inbox del chat SEPARADO en el panel
============================================================
- Ruta nueva en App.tsx + item de nav en AppLayout.tsx ("App" o "Chat") + página nueva en pages/,
  reusando components/ui. SEPARADA del Inbox de WhatsApp.
- Lista de ChatConversation + hilo de ChatMessage + input. El operador abre un SEGUNDO socket al
  namespace "/chat" SOLO en esta sección; recibe chat:message en vivo.
- Envío del operador: POST /api/chat/messages { conversationId, body } → guarda ChatMessage → emite por
  "/chat" a la sala del jugador; si el jugador no tiene socket vivo → marca para Web Push (Fase 5).
  Este envío es CÓDIGO PROPIO, NO pasa por getEngine()/WhatsApp.
- Sub-sección "Mi Invitación": crear/listar/borrar links single-use + QR + estado (usado/sin usar).
- Dedup de mensajes por id.
VERIFICACIÓN F3: un mensaje aparece en vivo sin recargar; el Inbox de WhatsApp queda intacto.

============================================================
FASE 4 — PWA del jugador (frontend NUEVO)
============================================================
- App instalable en carpeta nueva (ej. frontend-pwa), **React + Vite** (mismo stack; NO Preact salvo
  que se pida) con vite-plugin-pwa (injectManifest, sw propio).
- /i/:code → GET /api/chat/branding/:code → aplica marca (CSS vars, title, apple-touch-icon), guarda
  branding en localStorage.
- Pantalla "instalá primero" (beforeinstallprompt; iOS: instructivo "Agregar a inicio").
- Registro passwordless (POST /api/chat/register) → guarda JWT client (localStorage; se manda como Bearer).
- Chat: lista + input, socket al namespace "/chat" con el JWT client; recibe chat:message en vivo.
- Manifest + service worker (precache + push handler + notificationclick que enfoca/abre la app).
- CORS: sumá el origen de la PWA (subdominio, ej. chat.publi.lat) SOLO para /api/chat/* y el namespace
  /chat. NUNCA `origin:*` con credentials.
VERIFICACIÓN F4: se instala como app y chatea contra el backend; WhatsApp intacto.

============================================================
FASE 5 — Web Push
============================================================
- VAPID (npx web-push generate-vapid-keys) en .env: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
- GET /api/chat/push/public-key; POST /api/chat/push/subscribe (requireChatClient) → guarda ChatPushSub.
- Al enviar el operador un mensaje a un jugador SIN socket vivo → Web Push (usá BullMQ/Redis para
  broadcasts, ya está en el repo). POST /api/chat/push/broadcast (operador) para promos a su cuenta.
- En la PWA: pedir permiso DESPUÉS de instalar, suscribir, mandar al backend, mostrar estado.
VERIFICACIÓN F5: llega un push a un dispositivo real con la app instalada.

============================================================
FASE 6 — Branding white-label (opcional, al final)
============================================================
- UI en el panel para cargar marca por cuenta (logo con nombre de archivo aleatorio, colores, welcome).
  Validar SIEMPRE contra el userId del token (no del body).
- (Opcional/后) subdominio por operador para PWA instalable con marca propia.

============================================================
ENTREGABLE
============================================================
Módulo chat aislado y funcional: tablas Chat*, /api/chat/*, namespace /chat, sección de chat en el
panel, PWA del jugador instalable con push. WhatsApp SIN cambios. Cada fase commiteada, con typecheck +
build verdes y verificación de que WhatsApp sigue igual. Empezá por la FASE 1 y pará después de cada
fase para que yo confirme antes de seguir.
```
