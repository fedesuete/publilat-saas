# Análisis de riesgos de IA — Módulo Chat en Publi (blindaje del prompt)

Objetivo: que Claude Code cree el módulo chat **de una sola tirada y funcional**, sin romper nada.
Este doc lista CADA punto donde la IA puede malinterpretar + el **guardarraíl exacto** para evitarlo,
basado en el código REAL de Publi (lo leí). Al final hay un **bloque preámbulo** para pegar arriba de
CADA prompt de fase.

---

## 🔴 RIESGO #1 (el más grave) — Confundir el stack: el handoff es NestJS, Publi es Express

El handoff de tu socio está escrito en **NestJS + Preact + TanStack + shadcn** con Prisma estilo
Postgres. **Publi es Express + Prisma + React+Vite + Tailwind**, con otras convenciones. Si Claude
Code copia el handoff literal, genera código que **no compila / no encaja**.

**Guardarraíl:** *"Publi es Express + Prisma + React+Vite. NO es NestJS. NO uses decoradores
(@Injectable, @Controller, @WebSocketGateway, guards, modules) ni `JwtService` de Nest. Usá routers
de Express + middlewares como el código existente. El handoff es solo REFERENCIA CONCEPTUAL del flujo,
NO para copiar código."*

---

## 🔴 RIESGO #2 — Copiar las convenciones de Prisma del handoff

El handoff usa: `@db.Uuid` + `gen_random_uuid()`, `@db.Citext`, `@db.Timestamptz()`, `@db.VarChar`,
`@map("snake_case")`, `@@map("tabla")`, `onDelete: Cascade` en todo. **Publi NO usa NADA de eso.**

Publi (verificado en `schema.prisma`) usa:
- IDs: `String @id @default(cuid())`  ← **cuid, NO uuid**.
- Strings planos: `String` / `String?` (sin `@db.Citext`/`@db.VarChar`).
- Fechas: `DateTime @default(now())` (sin `@db.Timestamptz`).
- **Columnas camelCase** (sin `@map("...")`).
- **Nombres de tabla por defecto** (sin `@@map`).

**Guardarraíl:** *"Para las tablas nuevas seguí EXACTO las convenciones de schema.prisma de Publi:
`String @id @default(cuid())`, campos `String?`/`DateTime @default(now())`, SIN `@db.Uuid`,
`@db.Citext`, `@db.Timestamptz`, `@map`, `@@map` ni `gen_random_uuid`. Mirá el modelo `Contact` y
`User` como plantilla de estilo."*

---

## 🔴 RIESGO #3 — Asumir modelos que NO existen / chocar con los que SÍ

Verificado en el schema:
- **NO existe modelo `Conversation`.** El Inbox de Publi = `Contact` + `Message` agrupados por
  `contactId`. → `ChatConversation` es genuinamente nuevo, pero la IA NO debe asumir que hay una
  tabla Conversation que "extender".
- **YA existen `Message` y `SupportMessage`.** El mensaje del chat debe ser **`ChatMessage`**. Y ojo:
  **`Message` REQUIERE `lineId` (WaLine)** — está atado a WhatsApp. NO se puede reusar para el chat.
- **NO existe tabla `Operator`/`Agent`.** En Publi, **`User` ES la cuenta Y el operador** (v1 = un
  operador por cuenta). → `operatorId`/`invitedByUserId` = el `userId` de la cuenta. NO inventes un
  modelo multi-agente salvo que se pida.
- **`User.slug`** (unique) es el "accountSlug" (se usa en `/go?u=slug`). Usalo para el login del
  jugador (`/api/chat/login {accountSlug}`).

**Guardarraíl:** *"En Publi NO hay modelo Conversation ni Operator/Agent; el Inbox es Contact+Message
y el operador es el User de la cuenta (v1). No reuses `Message` (exige lineId/WhatsApp): el chat usa
`ChatMessage` propio. Nombrá TODO con prefijo `Chat` para no chocar con Message/SupportMessage."*

---

## 🔴 RIESGO #4 — Romper el Socket.IO del operador de WhatsApp

Verificado: hay **un solo `Server` de socket.io** (creado en `index.ts`), namespace **default**, salas
`user:${userId}`, helper `emitToUser` (`lib/io.ts`). El auth del socket rechaza sin JWT de operador.

**Guardarraíl:** *"NO modifiques el namespace default del socket ni `lib/io.ts` ni el auth de socket de
`index.ts`. Agregá un namespace NUEVO `/chat` al MISMO `Server` de socket.io, con su propio middleware
de auth (que acepte token operador O client). El realtime de WhatsApp (QR, líneas, Inbox) debe quedar
byte-por-byte igual."*

---

## 🔴 RIESGO #5 — Romper el auth (mezclar token de operador y de jugador)

Verificado: `lib/auth.ts` exporta `signToken(payload)` / `verifyToken(token)`. `requireAuth`
(`middleware/requireAuth.ts`) lee cookie httpOnly **`publilat_token`** o Bearer, valida `tokenVersion`
(revocación) e inyecta `req.userId`.

**Guardarraíl:** *"Usá `signToken`/`verifyToken` de lib/auth.ts (NO otra librería JWT). El JWT del
jugador = `signToken({ type:'client', accountId, playerId })`. NO toques `requireAuth`; creá un
middleware SEPARADO `requireChatClient`. En la PWA (subdominio distinto) mandá el token como **Bearer
(localStorage)**, NO por cookie httpOnly (la cookie no cruza subdominios)."*

---

## 🟠 RIESGO #6 — Frontend: introducir librerías ajenas

Verificado: el panel es **React + react-router-dom** (rutas en `App.tsx`, sidebar en
`components/AppLayout.tsx`), **Tailwind**, componentes propios en `components/ui` (Button, Input, Card…),
`ProtectedRoute`. El handoff sugiere TanStack/shadcn/Preact.

**Guardarraíl:** *"La sección de chat del panel: agregá una ruta en `App.tsx` + un item de nav en
`AppLayout.tsx` + una página nueva en `pages/`, reusando `components/ui`. NO introduzcas TanStack
Router/Query ni shadcn. Para la PWA del jugador usá **React + Vite** (mismo stack, evitá un segundo
toolchain); solo Preact si se pide explícito."*

---

## 🟠 RIESGO #7 — CORS y deploy

Verificado: CORS usa `PANEL_BASE_URL` (`index.ts`); el backend sirve el SPA del panel por estático +
fallback `app.get("*")`.

**Guardarraíl:** *"Sumá el subdominio de la PWA al CORS SOLO para `/api/chat/*`. NO uses `origin:*` con
`credentials:true` (hallazgo de la auditoría). La PWA es un build SEPARADO servido en su propio
subdominio; NO rompas el SPA fallback del panel."*

---

## 🟠 RIESGO #8 — La llamada a CAPI en el registro

`lib/meta-capi.ts` expone `sendCapiEvent({ eventName, externalId, ... })`. El plan quiere disparar Lead
al registrarse por link con fbclid.

**Guardarraíl:** *"Para el Lead del registro, LLAMÁ `sendCapiEvent` de lib/meta-capi.ts (no
reimplementes CAPI). NO toques `go.ts` ni `wa-cloud.ts`. Solo importá y llamá la función."*

---

## 🟡 Trampas de comportamiento (del propio handoff, siguen aplicando)
- **Single-use:** cerrar el `InviteCode` (isActive=false) DESPUÉS de crear el ChatPlayer (si el
  username está tomado y reintenta, no matarle el link antes).
- **Duplicados por race:** unique a nivel DB + capturar `P2002`.
- **Dedup de mensajes por id** (mismo patrón del fix del duplicado de WhatsApp que ya hicimos).
- **Aislamiento:** filtrar SIEMPRE por `req.userId` del token, nunca por id del body/URL.
- **PWA/iOS:** permiso de push DESPUÉS de instalar; headers no-cache en index.html.

---

## ⛔ Lista "NO TOCAR" (pegar en cada prompt)
```
NO modifiques ni rompas: Contact, Message, WaLine, routes/go.ts, routes/wa.ts, routes/wa-cloud.ts,
routes/inbox.ts, lib/evolution.ts, lib/waha.ts, lib/wa-engine.ts, lib/io.ts, el namespace default y
el auth de socket de index.ts, middleware/requireAuth.ts, y el flujo de atribución/CAPI existente.
El módulo chat es ADITIVO: tablas nuevas (prefijo Chat/InviteCode), rutas /api/chat/*, namespace /chat,
y una sección nueva en el panel. Si algo te obliga a tocar lo de arriba, PARÁ y avisá en vez de romperlo.
```

---

## ✅ Reglas de proceso (para que salga en una tirada)
1. **Leé primero** (obligatorio, antes de escribir): `schema.prisma`, `lib/io.ts`, `index.ts`,
   `middleware/requireAuth.ts`, `lib/auth.ts`, `lib/meta-capi.ts`, `components/AppLayout.tsx`, `App.tsx`.
2. **Una fase por vez** (no todo junto). Después de cada fase: `typecheck` backend + `build` frontend +
   tests. No pasar a la siguiente si algo falla.
3. **Verificación explícita al final de cada fase:** "confirmá que el Inbox/socket/envío de WhatsApp
   sigue funcionando igual" (probarlo, no asumirlo).
4. **Migraciones solo aditivas** (tablas nuevas + campos nullable) → seguras en prod.

---

## 📌 Bloque PREÁMBULO (pegar ARRIBA de CADA prompt de fase del chat)
```
CONTEXTO DE STACK (respetar al pie de la letra):
- Publi es Express + Prisma + React+Vite + Tailwind + socket.io. NO es NestJS: nada de decoradores,
  gateways, guards ni JwtService de Nest. El handoff que tenés es referencia CONCEPTUAL, no código a copiar.
- Prisma: IDs con `@default(cuid())` (NO uuid), campos String/DateTime planos, SIN @db.Uuid/@db.Citext/
  @db.Timestamptz/@map/@@map/gen_random_uuid. Copiá el estilo de los modelos User y Contact.
- Auth: usá signToken/verifyToken de lib/auth.ts. JWT del jugador = { type:'client', accountId, playerId }.
  NO toques requireAuth; creá requireChatClient aparte. En la PWA el token va como Bearer, no cookie.
- Socket: un solo Server de socket.io ya existe (index.ts, namespace default, salas user:{id}, emitToUser).
  Agregá un namespace NUEVO "/chat"; NO toques el default ni su auth.
- Modelos: NO existe Conversation ni Operator en Publi (Inbox = Contact+Message; el operador es el User).
  Message exige lineId (WhatsApp) → NO lo reuses. Todo el chat con prefijo Chat + InviteCode.
- Frontend: react-router-dom (App.tsx) + AppLayout.tsx (nav) + components/ui. Sin TanStack/shadcn.
- CORS: sumar el subdominio de la PWA solo para /api/chat/*; nunca `*` con credentials.

NO TOCAR: Contact, Message, WaLine, go.ts, wa*.ts, inbox.ts, evolution.ts, waha.ts, wa-engine.ts,
lib/io.ts, namespace default + auth de socket en index.ts, requireAuth.ts, CAPI/atribución.
El módulo es ADITIVO. Si algo te obliga a tocar eso, PARÁ y avisá.

LEÉ ANTES DE ESCRIBIR: schema.prisma, lib/io.ts, index.ts, middleware/requireAuth.ts, lib/auth.ts,
lib/meta-capi.ts, components/AppLayout.tsx, App.tsx.
Al terminar: typecheck backend + build frontend + confirmá que WhatsApp (Inbox/socket/envío) sigue igual.
```
