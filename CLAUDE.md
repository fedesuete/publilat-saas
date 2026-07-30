# Publi.lat — Contexto completo del proyecto

> Documento maestro para cualquiera (humano o Claude Code) que trabaje en este repo. **Léelo entero
> antes de tocar nada.** Es la fuente de verdad; los `PROMPT-*.md` / `GUIA-*.md` / `INFORME-*.md` de
> la raíz son historia y guías puntuales (útiles pero secundarias a este archivo).

---

## 1. Qué es Publi.lat

Son **dos productos** que viven en el mismo repo y comparten cuenta (`User`) e infra:

### A) SaaS de atribución WhatsApp → Meta Ads (producto original, inspirado en ScaleOS)
Cierra el loop para negocios que venden por WhatsApp con tráfico de Meta Ads:

**anuncio Meta → landing rastreada → clic dispara `Lead` → redirige a WhatsApp → conversación →
venta marcada con monto → se envía `Purchase` a Meta por CAPI.**

El valor: Meta deja de optimizar por "mensajes iniciados" y pasa a optimizar por **compradores
reales** (ROAS real), porque le devolvemos el evento de compra con el valor y el MISMO identificador
del clic. (Ver §5 el loop en detalle.)

### B) Chat App — canal jugador↔cajero (módulo AISLADO, foco actual del casino)
Una PWA propia (`chat.publi.lat`) + panel del operador, **fuera de WhatsApp**, donde el jugador se
registra, chatea con el cajero y (en construcción) carga/retira plata self-service. Nace para operar
casino **sin usar WhatsApp** (WhatsApp banea apuestas — ver §9 reglas duras). Es white-label por
cuenta (marca, colores, textos). (Ver §6.)

> El **socio** (Eduardo) provee la API del casino **ganamos** y trabaja sobre el módulo B.

---

## 2. Stack

- **Backend:** Node.js + TypeScript (estricto) + Express + Socket.IO. **NO NestJS** (nada de
  decoradores/gateways/guards).
- **DB:** PostgreSQL + Prisma. IDs `@default(cuid())` (NO uuid), `String`/`DateTime` planos, **sin**
  `@db.*` / `@map` / `@@map` / `gen_random_uuid()`. Migraciones Prisma (NO `db push`), **solo aditivas**.
- **Colas/jobs:** BullMQ + Redis (reintentos CAPI, vencimiento de días/líneas, rotación).
- **Frontends:** React + Vite + Tailwind. Dos apps:
  - `frontend/` → **panel** del operador/cliente + panel maestro admin (`app.publi.lat`). Es un
    workspace npm (lockfile en la raíz).
  - `frontend-pwa/` → **PWA del jugador** del Chat App (`chat.publi.lat`). Build aislado (su propio
    `package.json`, `npm install`).
- **WhatsApp:** motor conmutable por `WA_ENGINE` — **WAHA (WEBJS)** en prod, **Evolution API** como
  rollback. Baileys directo en el pasado. Ver `backend/src/lib/wa-engine.ts`.
- **Landings:** S3 + CloudFront, **un dominio `*.cloudfront.net` descartable por cliente** (OAC, bucket
  privado). Modelo ScaleOS: si Meta quema una landing, cae solo ese dominio, no el principal.
- **Meta:** Graph API — Conversions API (server-side) + Pixel del navegador. Eventos `Lead`,
  `Purchase`, `CompleteRegistration`.

> **Infra:** las sesiones de WhatsApp necesitan proceso persistente con estado → NO serverless. Va en
> contenedor/VPS dedicado.

---

## 3. Estructura del repo

```
backend/            Express + Prisma
  prisma/schema.prisma        modelos (ver §4) + prisma/migrations/ (aditivas)
  src/index.ts                arranque, montaje de routers, CORS, socket.io
  src/routes/                 go.ts (redirector loop) · webhook.ts (WA entrante) · wa.ts / wa-cloud.ts
                              inbox.ts · leads.ts · analytics.ts · billing.ts · landings.ts · pixel.ts
                              integrations.ts · admin.ts (panel maestro) · support.ts · flows.ts
                              tutorials.ts · chat.ts (MÓDULO CHAT APP) · auth.ts · setup.ts · track.ts
  src/lib/                    meta-capi.ts (CAPI) · pixel.ts (resuelve pixel/token por usuario)
                              wa-engine.ts / waha.ts / evolution.ts / wa-send.ts · warmup.ts
                              s3.ts · cloudfront.ts · io.ts (emit socket) · queue.ts (BullMQ)
                              chat-bot.ts (bot carga/descarga) · casino-partner.ts (API ganamos, flag)
                              chat-push.ts (Web Push) · payments.ts · purchase.ts · ai-receipt.ts
frontend/           Panel (React/Vite). src/pages/*.tsx + src/pages/admin/*.tsx (panel maestro)
                    Piezas clave del chat: src/pages/ChatAppPage.tsx (operador del Chat App)
frontend-pwa/       PWA del jugador. src/pages/OnboardingPage.tsx (registro), LoginPage, ChatPage
                    src/lib/ (api, pixel, inapp) · src/sw.ts (service worker)
db/                 init.sql
deploy/             scripts (update-waha.sh, watchdog, etc.)
landing-web/        landing pública de marketing de publi.lat
```

Docs de referencia útiles: `RUNBOOK.md` (incidentes/operación), `DEPLOY*.md`, `PLAN-INTEGRAR-CHAT-CASINO.md`,
`AUDITORIA-SEGURIDAD.md`, `KICKOFF.md`.

---

## 4. Modelos Prisma (resumen)

`User` es la **cuenta** (operador/cliente). Tiene el branding del Chat App, config del bot, pixel(es),
líneas, contactos, etc. Modelos principales:

- **Atribución:** `Contact` (lead con `externalId`/`fbp`/`fbc`/`fbclid`/`code`/`amount`/`stage`),
  `Message`, `WaLine` (línea de WhatsApp + `expiresAt` = día pagado), `Pixel`, `MetaEvent` (log de
  envíos a Meta), `TrackedLink`, `Landing`, `Integration`, `Credit`/`CreditLedger`, `Payment`.
- **Chat App:** `ChatPlayer` (jugador: `casinoUsername` único por cuenta, `password?` hash bcrypt,
  `nombre?`), `ChatConversation`, `ChatMessage`, `InviteCode` (link single-use de registro),
  `ChatPushSub`, `ChatBroadcast`, `BrandingAsset`.
- **Casino (integración socio):** `CasinoTx` (`referencia @unique` = idempotency key end-to-end).
- **Otros:** `Flow`/`FlowRun` (automatizaciones), `AudioClip`, `QuickReply`, `Notification`,
  `SupportMessage`, `AdminLog`, `Tutorial`, `InboundDedup`.

---

## 5. El loop de atribución (producto A)

1. Link rastreado: `/go?u=<usuario>&pixel=<id>&msg=<texto>`.
2. El redirector `/go` (`routes/go.ts`): lee `fbclid` + cookies `fbp`/`fbc`, genera `external_id`,
   dispara **Lead** (Pixel navegador + **CAPI**), registra el `Contact` con su atribución + un `code`
   corto, y redirige a `https://wa.me/<linea>?text=<msg + code>`.
3. El `code` (o la línea) re-identifica a la persona cuando escribe (webhook de WhatsApp).
4. La conversación entra al Inbox; el lead aparece en el CRM/Kanban.
5. Al pagar, el operador lo marca **Compró** con monto.
6. Se envía **Purchase** por CAPI con el MISMO `external_id`/`fbp`/`fbc` + `value`. Meta matchea y
   optimiza por compradores.

**Identificadores por contacto (sin esto el Purchase NO matchea):** `external_id`, `fbp`, `fbc`,
`fbclid`, campaña/ad, línea WA, `code`. El `external_id` es el pegamento Lead↔Purchase.

- CAPI vive en `lib/meta-capi.ts` (`sendCapiEvent`). Pixel/token por usuario en `lib/pixel.ts`
  (`resolveUserPixel`). `eventName`: `"Lead" | "Purchase" | "CompleteRegistration"`.
- **Regla:** `META_TEST_EVENT_CODE` DEBE estar **vacío en prod** (si no, todo va a Test Events y no al
  pixel en vivo — ya pasó, 3 semanas de datos perdidos). Los eventos se validan con el Test Events Tool
  ANTES de dar por hecho el match.
- Webhook Cloud vs Baileys: ambos deben matchear el mensaje entrante por `ref:CODE` primero, y por
  teléfono después (si no, se parte la atribución). Hay tool de recuperación:
  `backend/src/scripts/backfill-split-purchases.ts` (DRY-RUN por defecto, `APPLY=1`).

---

## 6. Módulo Chat App (producto B) — foco actual

Canal jugador↔cajero AISLADO. **No comparte tablas con el Inbox de WhatsApp ni pasa por el motor de
WA.** Rutas `/api/chat/*` (`routes/chat.ts`), namespace socket `/chat`, PWA `chat.publi.lat`.

- **Auth jugador:** `signChatClientToken({ type:"client", accountId, playerId })` +
  middleware `requireChatClient` (`middleware/requireChatClient.ts`). Token Bearer en `localStorage` de
  la PWA. El **operador** es el `User` de la cuenta (usa `requireAuth`, NO tocar).
- **Entradas del jugador:**
  - `/i/:code` → registro por link single-use (`InviteCode`). PWA: `OnboardingPage`.
  - `/api/chat/register` — registro. **Dos modos:** clásico (`username` elegido, passwordless) y
    **un-tap** (`autogenerate:true` → el server genera `casinoUsername` (apodo+dígitos) + clave de 6
    dígitos, los guarda y los devuelve).
  - `/api/chat/start` — entrada ABIERTA por `accountSlug` (sin invite): registra o retoma.
  - `/api/chat/login` — usuario + clave (resuelve la cuenta por el usuario si no viene el slug).
- **Gate por días:** las acciones salientes y la entrada del jugador requieren una `WaLine` con
  `expiresAt` futuro (día pagado). Sin día pagado, el chat está apagado (`code:"line_required"`). El
  Chat App se vende junto con el servicio de líneas.
- **Branding white-label:** campos en `User` (`brandName`, `logoUrl`, `primaryColor`, `accentColor`,
  `welcomeText`, `welcomeMsg*`, `chatWaLink`). Editor en `ChatAppPage`. La PWA aplica CSS vars
  `--brand-primary` / `--brand-accent`.
- **Bot carga/descarga:** `lib/chat-bot.ts` (`runChatBot`), gateado por `User.botEnabled` +
  `botPaymentInfo`/`botWelcome`. Best-effort: sin bot es no-op.
- **Web Push:** `lib/chat-push.ts` (VAPID). El operador manda avisos (individual o broadcast) que
  además se dejan como mensaje en el chat (imagen confiable in-app).

### Integración casino (socio — API ganamos)
- `lib/casino-partner.ts`: cliente de la partner-api de **ganamos** (`/credit`, `/debit`, `/balance`),
  Bearer `CASINO_API_KEY`, `Idempotency-Key`, ARS **entero**. **Gateado por flag** (`CASINO_API_URL` +
  `CASINO_API_KEY`); apagado hasta tener la key. `RETRYABLE_CODES` = insufficient_cashier_balance /
  rate_limited / platform_unavailable + HTTP 429/503 + errores de red.
- Modelo `CasinoTx` con `referencia @unique` (idempotencia end-to-end).
- Arquitectura de cobros: **recaudadora** (webhook firmado, entra la plata) → partner-api ganamos
  (acredita) → el bot confirma. Idempotencia por `referencia`.

### Estado del trabajo casino self-service (registro un-tap + cajero), por FASES
- **Fase A — Registro de un tap** ✅ hecho: `/register` autogenerate + `OnboardingPage` (Creá tu cuenta
  gratis → "Preparando tu acceso…" → ¡CUENTA CREADA! con usuario/clave → JUGAR YA), con branding.
- **Fase B — Escape de webview** ✅ hecho: detecta in-app (FB/IG/TikTok) y muestra "Abrí en tu
  navegador" (`frontend-pwa/src/lib/inapp.ts`), para que `_fbp/_fbc` persistan y matchee el pixel.
- **Fase C — CompleteRegistration** ✅ hecho: al registrarse dispara CompleteRegistration por CAPI +
  Pixel (dedup por `eventId`), `external_id = usuario` (para matchear el Purchase de la carga).
- **Fase D — Landing S3/CloudFront** ⏳ pendiente: landing HTML branded en el CloudFront off-brand de
  cada cliente → registro un-tap abierto (endpoint `/api/land/*` con CORS abierto) → entra a la app.
- **Fase E — Cajero self-service** ⏳ pendiente: `ChatDeposit` / `ChatWithdrawal` / `ChatWallet`.
  Carga: comprobante a S3 → `pending` → el operador aprueba en sección "Cajero" → acredita al wallet →
  **recién ahí** Purchase CAPI. Retiro: monto+CBU → `requested` → operador aprueba → `paid`. Webhook
  `/api/chat/pay/webhook` preparado pero APAGADO sin claves (único camino de acreditación automática
  segura). ARS, carga mín $2.000 / retiro mín $5.000.

---

## 7. Producto A — resto de fases (contexto)

F0 setup · F1 loop (§5) · F2 WhatsApp+Inbox · F3 CRM+Analytics (Dashboard ROAS, Kanban, etapas) ·
F4 multi-línea+billing (rotación LRU, crédito de días, vencimiento con BullMQ, calentamiento/warmup) ·
F5 landings+integraciones+pagos (editor de landings, webhooks CRM firmados HMAC, MercadoPago/Pagopar,
USDT). **Panel maestro admin** (`/admin`, rol `ADMIN`, `routes/admin.ts`): clientes, líneas, ingresos,
demos, soporte en vivo, tutoriales, exportar.

---

## 8. Convenciones de código

- TypeScript estricto. Validación de input con **zod** en toda ruta.
- Prisma: cuid, sin `@@map`/`@db.*`; migraciones **aditivas** (columnas nullable / con default). Copiá
  el estilo de los modelos `Chat*` existentes.
- **Nunca** loguear teléfonos/montos en texto plano en prod.
- Secrets **solo** por `.env` (ver `.env.example`). No commitear `.env`.
- Reusá lo que ya existe (`sendCapiEvent`, `resolveUserPixel`, `emitChat`, `hashPassword`,
  `signChatClientToken`, `s3.ts`, `cloudfront.ts`) — no reimplementar.
- Al terminar cualquier cambio: **typecheck backend** (`npx tsc --noEmit`) + **build de los dos
  frontends** + **tests** (`npx vitest run`). Todo verde antes de commitear.

---

## 9. Reglas de negocio y de seguridad (DURAS)

1. **Casino SOLO por Baileys/WAHA/Chat App propio, NUNCA por WhatsApp Cloud API oficial.** WhatsApp
   PROHÍBE apuestas: al intentar Cloud API con casino, Meta **desactivó permanentemente una WABA**. No
   reintentar; casino en cuentas Meta separadas/descartables. El Chat App (canal propio) existe para
   esto: operar sin WhatsApp = sin baneo.
2. **NO acreditar plata (dar fichas al jugador) solo por una imagen/comprobante subido. Eso es fraude.**
   La **acreditación de fichas** la habilita SOLO: (a) el operador aprobando manualmente, o (b) un webhook
   de gateway REAL confirmado (recaudadora/Pagopar). ESTO NO CAMBIA.
   **Excepción sólo para el Purchase CAPI (2026-07-29, decisión del dueño):** el **Purchase a Meta**
   (señal de *marketing*, NO da fichas) SÍ se dispara al **leer el comprobante con IA** cuando confirma
   que es un pago real, para cerrar el loop del pixel (como ScaleOS). **Mandar el Purchase ≠ acreditar
   fichas** — son cosas distintas. Idempotente por carga (`ChatDeposit.purchaseFiredAt`) y por contacto
   (eventId). Riesgo asumido: un comprobante trucho/no-completado puede mandar un Purchase de más
   (mitigado por el gate de la IA `isReceipt`+confianza).
3. **Tono neutro** en app/landing/textos de Publi. Nunca casino/apuestas/+18 en NUESTRO producto; el
   contenido del cliente es del cliente.
4. **Verificar la ruta correcta ANTES** de guiar flujos externos/irreversibles (Meta Ads, IAM, pagos).
   No ensayo y error.
5. Eventos a Meta validados con Test Events Tool. `META_TEST_EVENT_CODE` vacío en prod.
6. **NO TOCAR** (todo el trabajo del Chat App es ADITIVO): `Contact`, `Message`, `WaLine`, `go.ts`,
   `wa*.ts`, `inbox.ts`, `evolution.ts`, `waha.ts`, `wa-engine.ts`, `lib/io.ts` (salvo helpers nuevos),
   el namespace default + auth de socket en `index.ts`, `requireAuth`, y el flujo de atribución de
   WhatsApp. Si algo obliga a tocar eso, **PARÁ y avisá**.

---

## 10. Deploy y operación

- **Prod:** `app.publi.lat` (panel + API, contenedor `app`) y `chat.publi.lat` (PWA chat, contenedor
  `chat-pwa`). VPS Hostinger con EasyPanel + Traefik. Todo en `/opt/publilat`.
- **Deploy (manual, pedir antes de hacerlo):**
  ```
  ssh -i ~/.ssh/publilat_deploy root@187.77.33.164
  cd /opt/publilat && git pull --ff-only
  docker compose -f docker-compose.vps.yml up -d --build app        # y/o chat-pwa
  ```
  Las **migraciones Prisma corren solas al bootear** el contenedor. Backup antes de migraciones
  grandes: `docker compose -f docker-compose.vps.yml exec -T postgres pg_dump -U postgres publilat > backup.sql`.
- **DB:** PostgreSQL, usuario `postgres`, db `publilat`.
- **Git:** commit por fase/cambio; **no deployar sin que el dueño lo pida**. Rama `main`.
- Resiliencia: monitor externo (GitHub Actions), autoheal (reinicia contenedores `unhealthy`), swap,
  fail2ban. Ver `RUNBOOK.md`.

---

## 11. Gotchas operativos (aprendidos a los golpes)

- **S3 (`publilat-landings`, us-east-2, privado + CloudFront OAC):** las credenciales del server
  **suben y listan pero NO leen** (`s3:GetObject` = AccessDenied). Las landings las sirve CloudFront,
  no la app. Por eso los **videos de tutoriales se guardan en el DISCO** del VPS (volumen
  `tutorial_videos`, `/data/tutorials`) y los sirve el backend con Range, no S3.
- **Panel PWA = autoUpdate:** un F5 normal trae la versión nueva. Si alguien "ve la versión vieja" es
  SIEMPRE su service worker → 1 vez "Clear site data" o incógnito. El server sirve `index.html` con
  `max-age=0` (no hay CDN cacheándolo).
- **iOS PWA:** no se instala por botón (Apple); solo Compartir → "Agregar a inicio" en Safari, pestaña
  normal (no privada). El botón "Instalar app" en iOS abre instrucciones.
- **Versión de WhatsApp Web (Baileys/WAHA) EXPIRA (~2 meses):** renovar `CONFIG_SESSION_PHONE_VERSION`
  / la imagen de WAHA cuando dejan de entrar/salir mensajes.
- **Warmup (calentamiento):** rampa anti-ban de líneas nuevas (`lib/warmup.ts`); cupos crecientes por
  día. Apagar (`warmupEnabled=false`) = envíos sin límite. Toggle en Admin → Líneas.

---

## 12. Cómo trabajar acá (para el socio y su Claude)

1. Leé este archivo entero + el `PLAN-INTEGRAR-CHAT-CASINO.md` si tocás el casino.
2. Todo lo del Chat App/casino es **aditivo**; respetá §9.6 (no tocar WhatsApp/atribución).
3. Fase por fase, commit chico y descriptivo. `typecheck + build (x2) + tests` verdes antes de commitear.
4. **No deployes** salvo que el dueño lo pida explícitamente.
5. Si una decisión de negocio/plata/diseño es ambigua, **preguntá antes** (especialmente en el cajero).
