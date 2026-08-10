# Plan de integración — Chat Casino (PWA jugador↔cajero) como MÓDULO AISLADO en Publi.lat

Decisión tomada: **NO unificar con el Inbox de WhatsApp.** El chat es un **módulo separado** dentro
de Publi, con **su propio Inbox, sus propias tablas y su propio namespace de Socket.IO**. WhatsApp
queda **congelado, sin tocar**. Se comparte solo la cáscara: cuentas/login de operador, el panel
(un ítem de menú nuevo), el deploy, Postgres y Redis.

> **Por qué así (seguridad):** aislar mata los 3 riesgos altos — el socket del operador de WhatsApp
> no se toca (namespace propio), el envío de WhatsApp no se toca (código propio del chat), y el
> modelo `Contact`/`/go`/atribución de WhatsApp no se toca (tablas propias del chat).

> **Bonus que se mantiene:** el link de invitación puede llevar `fbclid` → el registro del jugador
> dispara **Lead por CAPI** igual que WhatsApp. Canal **sin bans/463/dominio quemado** que además
> mide. (La atribución se llama desde el módulo chat; no toca `go.ts`.)

---

## 1) Qué se COMPARTE y qué es NUEVO/AISLADO

**Se reusa (sin modificar su comportamiento):**
- La **cuenta** (`User`/tenant) y el login de **operador** (JWT operador, roles del panel maestro).
- La **cáscara del panel** (layout, auth) — se le agrega un ítem de menú "App / Chat".
- **Postgres** (misma DB, tablas nuevas) y **Redis** (para el adapter de socket si escala).
- El **deploy** (mismo backend Express; la PWA es un frontend nuevo).

**Es NUEVO y vive aparte (no toca WhatsApp):**
- Tablas propias: `ChatPlayer`, `ChatConversation`, `ChatMessage`, `InviteCode`, `ChatPushSub`.
- **Namespace `/chat` de Socket.IO** (separado del socket actual del operador).
- **Inbox del chat** = sección/página nueva en el panel (NO el Inbox de WhatsApp).
- Auth del **jugador** (JWT tipo `client`, passwordless) validado SOLO en las rutas `/api/chat/*`
  y en el namespace `/chat`. Nunca toca el `requireAuth`/socket de WhatsApp.
- La **PWA del jugador** (frontend nuevo) + **Web Push**.

**Regla de oro (igual que el handoff):** toda query del chat filtra por el **`userId`/cuenta del
token**. Nunca por id del body/URL.

---

## 2) Mapeo de modelos (tablas NUEVAS y aisladas)

| Chat Casino | En Publi — tabla/nuevo |
|---|---|
| `Tenant` (casino) | la **cuenta** `User` existente (reusar, no duplicar) |
| `Operator` (cajero) | el **`User`/agente** existente (reusar) |
| `Client` (jugador) | **`ChatPlayer`** (NUEVA, no es Contact) |
| `Conversation` | **`ChatConversation`** (NUEVA) |
| `Message` | **`ChatMessage`** (NUEVA) |
| `InviteCode` | **`InviteCode`** (NUEVA) |
| `PushSubscription` | **`ChatPushSub`** (NUEVA) |

> Clave: **NO tocamos `Contact`/`Conversation`/`Message` de WhatsApp.** El chat tiene las suyas. Si
> más adelante querés cruzar datos (ej. un reporte único), se hace por arriba, sin fusionar tablas.

---

## 3) Fases y prompts para Claude Code (uno por vez, en orden)

### FASE 1 — Tablas aisladas + auth del jugador + namespace /chat (sin tocar nada existente)
```
Agregá un MÓDULO de chat aislado a Publi, SIN modificar el flujo de WhatsApp. Regla dura: no toques
Contact, Conversation, Message, routes/go.ts, routes/wa*.ts, el motor (getEngine) ni el socket del
operador actual. LEÉ antes: schema.prisma, lib/io.ts, index.ts (socket), middleware/requireAuth.ts.
Hacé:
1) Tablas NUEVAS en Prisma (prefijo Chat), todas con userId (cuenta) para aislamiento:
   - ChatPlayer { id, userId, nombre, casinoUsername(citext), invitedByUserId?, inviteCodeId?,
     estatus(default active), createdAt } @@unique([userId, casinoUsername])
   - ChatConversation { id, userId, playerId, assignedOperatorId?, status(open), unreadOperator,
     unreadPlayer, lastMessageAt?, lastMessagePreview?, createdAt }
   - ChatMessage { id, userId, conversationId, senderType(player|operator|system), senderId?, body?,
     metadata Json, readAt?, createdAt }
   - InviteCode { id, userId, operatorId, code(unique, 8 base64url), label?, isActive(default true),
     createdAt }
   - ChatPushSub { id, userId, playerId?, endpoint, p256dh, auth, userAgent?, createdAt } @@unique([userId, endpoint])
2) Auth del jugador: JWT tipo "client" { sub: playerId, accountId, type:"client" }, 30 días.
   Middleware requireChatClient que lo valide. NO password. NO tocar requireAuth de operador.
3) Namespace de Socket.IO NUEVO "/chat" (aparte del socket actual). Middleware propio que acepte
   token de operador O de client. Rooms: chat:{userId}, chat:{userId}:op:{operatorId},
   chat:{userId}:player:{playerId}, chat:conv:{conversationId}. NO tocar el io/namespace default.
4) Branding en la cuenta (User): agregá campos brandName, logoUrl, primaryColor, accentColor,
   welcomeText, welcomeMsgText, welcomeMsgImage (nullable). No rompe nada existente.
Migración incluida. typecheck. Verificá que el socket/Inbox de WhatsApp siga EXACTO igual.
```

### FASE 2 — Invites + registro passwordless (rutas /api/chat/*)
```
Rutas del módulo chat, todo bajo /api/chat/* para no colisionar:
- Operador (requireAuth): GET /api/chat/invites, POST /api/chat/invites {label} (code base64url),
  DELETE /api/chat/invites/:id (ownership por userId).
- Público: GET /api/chat/branding/:code (branding de la cuenta para la PWA).
- POST /api/chat/register {code, username[, fbclid, fbp, fbc]} -> resuelve code (isActive), crea
  ChatPlayer, CIERRA el link DESPUÉS de crear el player (single-use; si el username está tomado, que
  reintente), abre ChatConversation asignada al operador del code, manda bienvenida, devuelve JWT
  client. Si vino fbclid, dispará Lead por CAPI reusando lib/meta-capi.ts (NO tocar go.ts; solo
  llamar la función). Unique parcial + capturar P2002 contra duplicados por race.
- POST /api/chat/login {accountSlug, username} -> reingreso del jugador.
typecheck. Probá: registro por link OK; 2º por el mismo link -> 404.
```

### FASE 3 — Inbox del chat SEPARADO en el panel
```
Sección NUEVA en el panel (ítem de menú "App" o "Chat"), separada del Inbox de WhatsApp:
- Lista de conversaciones del chat (ChatConversation) + vista de mensajes + input.
- El operador se conecta al namespace "/chat" (segundo socket, aparte del que ya usa) SOLO cuando
  entra a esta sección. Recibe chat:message en vivo.
- Envío del operador: POST /api/chat/messages -> guarda ChatMessage y emite por /chat a la sala del
  jugador; si el jugador no tiene socket vivo -> Web Push (Fase 5). Este envío es CÓDIGO PROPIO del
  chat, no pasa por getEngine()/WhatsApp.
- Sub-sección "Mi Invitación": crear/listar/borrar links single-use + QR + estado (usado/sin usar).
- Dedup de mensajes por id (mismo patrón del fix del duplicado de WhatsApp).
build frontend. El Inbox de WhatsApp queda intacto.
```

### FASE 4 — PWA del jugador (frontend nuevo)
```
App instalable del jugador como frontend nuevo (carpeta frontend-pwa), liviano (Preact o React +
Vite) con vite-plugin-pwa (injectManifest, sw propio):
- /i/:code -> resuelve branding (GET /api/chat/branding/:code), aplica marca (CSS vars, title,
  apple-touch-icon), guarda branding en localStorage.
- Pantalla "instalá primero" (beforeinstallprompt; iOS: instructivo "Agregar a inicio").
- Registro passwordless (POST /api/chat/register) -> guarda JWT client.
- Chat: lista + input, conectado por Socket.IO al namespace "/chat" con el JWT client; recibe
  chat:message en vivo.
- Manifest + service worker (precache + push handler + notificationclick).
Servila en un subdominio (ej. chat.publi.lat). CORS: sumá ese origen SOLO para /api/chat/* (no uses
* con credentials). build OK, se instala y chatea.
```

### FASE 5 — Web Push
```
VAPID: par de claves (npx web-push generate-vapid-keys) en .env. 
- GET /api/chat/push/public-key, POST /api/chat/push/subscribe (requireChatClient).
- Al llegar un mensaje del operador a un jugador SIN socket vivo -> Web Push (usá BullMQ para
  broadcasts). POST /api/chat/push/broadcast (operador) para promos a su cuenta.
- En la PWA: pedir permiso DESPUÉS de instalar, suscribir, mandar al backend.
typecheck + build.
```

### FASE 6 — Branding white-label + subdominios (opcional, al final)
```
- UI para cargar marca por cuenta (logo con nombre aleatorio, colores, welcome). Validar contra el
  userId del token (no del body).
- Subdominio por operador para PWA con marca propia instalable (decisión de producto; al final).
```

---

## 4) Qué NO puede romper (por qué el aislamiento es seguro)
- **Socket de WhatsApp:** intacto — el chat usa namespace `/chat` aparte.
- **Envío de WhatsApp (`getEngine().sendText`):** intacto — el chat tiene su propio envío.
- **Contact / `/go` / atribución WhatsApp:** intacto — el chat usa tablas propias.
- **Migraciones:** solo AGREGAN tablas/campos nullable → no afectan datos existentes.
- Lo único compartido y sensible: el **panel** (un ítem de menú nuevo) y **CORS** (sumar el subdominio
  de la PWA solo para `/api/chat/*`). Ambos son additive.

## 5) Recursos (recordatorio)
- Generar/servir la PWA: **~gratis** (una build estática para todos; instalar = cachear en el navegador).
- El "front por operador" NO es una app por operador: es la MISMA PWA con branding en runtime.
- El costo real = **WebSockets de jugadores online + push + filas de mensajes**. Cientos de online →
  el VPS actual alcanza. Miles → adapter de Redis para socket.io (Redis ya está) + más máquina.
- Ojo: comparte VPS con WhatsApp/WAHA (Chromium pesado). Si escala, separá el proceso de chat.
