# Publi.lat

SaaS de atribución de ventas **WhatsApp → Meta Ads**. Cierra el loop
clic → chat → venta y devuelve el evento `Purchase` a Meta por Conversions API
para optimizar campañas por facturación real (ROAS real, no costo por mensaje).

## Estructura

```
publilat-saas/
├─ CLAUDE.md            # Contexto del proyecto (léelo primero)
├─ KICKOFF.md           # Prompt de arranque para Claude Code (Fase 1)
├─ .env.example         # Variables de entorno
├─ backend/             # API Node + Express + Socket.IO + Prisma
│  ├─ prisma/schema.prisma
│  └─ src/
│     ├─ index.ts          # Servidor + health + Socket.IO (auth) + routers
│     ├─ routes/
│     │  ├─ go.ts          # Redirector de atribución (corazón del MVP)
│     │  ├─ landing.ts     # Landing rastreada de demo (pixel navegador + dedup)
│     │  ├─ auth.ts        # Registro / login (JWT)
│     │  ├─ leads.ts       # Listado de leads + marcar compra (Purchase)
│     │  ├─ wa.ts          # Líneas de WhatsApp: crear, QR, estado (Fase 2)
│     │  ├─ webhook.ts     # Webhook de Evolution: mensajes entrantes → lead
│     │  ├─ inbox.ts       # Conversación por lead + enviar mensajes
│     │  ├─ analytics.ts   # Overview de ROAS por campaña/fuente (Fase 3)
│     │  ├─ billing.ts     # Crédito de días + ledger + checkout/webhook (Fase 4-5)
│     │  ├─ landing.ts     # Sirve landings públicas (/l/:slug demo, /p/:slug guardada)
│     │  ├─ landings.ts    # CRUD de landings del editor (Fase 5)
│     │  └─ integrations.ts# Config de integración con CRM externo (Fase 5)
│     ├─ middleware/requireAuth.ts  # Protege /api/*
│     ├─ scripts/e2e.ts    # Prueba end-to-end del loop
│     └─ lib/
│        ├─ prisma.ts      # Cliente Prisma (singleton)
│        ├─ auth.ts        # Hash, JWT, slugify
│        ├─ pixel.ts       # Resuelve pixel/token por usuario
│        ├─ meta-capi.ts   # Envío de eventos a Meta CAPI
│        ├─ evolution.ts   # Cliente de Evolution API (WhatsApp)
│        ├─ io.ts          # Socket.IO singleton (emite QR/estado/inbox por usuario)
│        ├─ queue.ts       # BullMQ: vencimiento automático de líneas (Fase 4)
│        ├─ landing-template.ts # HTML de landing rastreada (pixel + CTA dedup)
│        ├─ s3.ts          # Publicar landings en S3+CloudFront (gateado, Fase 5)
│        ├─ integrations.ts# Webhooks salientes a CRM externo (Fase 5)
│        └─ payments.ts    # MercadoPago (gateado, Fase 5)
└─ frontend/            # Panel React + Vite + Tailwind (auth, leads, inbox, WhatsApp, links)
```

## Requisitos

- Node.js 20+
- PostgreSQL 15+
- Redis 7+ (para colas/jobs, desde Fase 4)
- Una cuenta de Meta Business con Pixel + token de Conversions API
- (Fase 2) Evolution API corriendo, o Baileys integrado

## Setup rápido

```bash
# 1. Variables de entorno
cp .env.example .env        # completá los valores

# 2. Backend
cd backend
npm install
npx prisma migrate dev --name init   # crea las tablas
npm run dev                          # arranca la API en :4000

# 3. Frontend (otra terminal)
cd frontend
npm install
npm run dev                          # panel en :5173
```

## API (Fase 1)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET`  | `/health` | — | Estado del servicio |
| `GET`  | `/l/<slug>?msg=&title=` | — | Landing rastreada de demo: carga el Pixel del navegador, dispara `Lead` por browser y redirige a `/go` con el mismo `eventID` (dedup) |
| `GET`  | `/go?u=<slug>&msg=&fbclid=&campaign=&ad=&src=&eid=&fbp=&fbc=` | — | Registra el Contact con su atribución, dispara **Lead** por CAPI y redirige a `wa.me` con un `code` corto. `eid`/`fbp`/`fbc` los pasa la landing para deduplicar con el Pixel del navegador |
| `POST` | `/api/auth/register` | — | `{ email, password, name?, pixelId?, capiToken? }` → `{ token, user }`. Si pasás `pixelId`+`capiToken` se crea el Pixel del usuario |
| `POST` | `/api/auth/login` | — | `{ email, password }` → `{ token, user }` |
| `GET`  | `/api/leads` | Bearer | Lista los leads del usuario con su atribución (sin teléfono) |
| `POST` | `/api/leads/:id/purchase` | Bearer | `{ amount, currency }` → marca `COMPRO` y envía **Purchase** por CAPI con el MISMO `externalId`/`fbp`/`fbc` + `value` |

> `amount` se recibe en unidad mayor (ej. `1500.50` ARS), se guarda en centavos y se
> envía a Meta como valor decimal. El **mismo `externalId`** en Lead y Purchase es lo que
> habilita el match en Meta.

## Probar el loop de atribución (Fase 1)

### Opción A — script end-to-end (recomendado)

```bash
cd backend
npm run dev          # en una terminal
npm run e2e          # en otra: corre register → /go → leads → purchase
```

El script imprime las respuestas de la CAPI (`events_received`, `fbtrace_id`). Si
`META_PIXEL_ID`/`META_CAPI_TOKEN` no están en `.env`, el flujo igual corre pero los
eventos a Meta fallan (esperado): cargá las credenciales para que matcheen.

### Opción B — manual

1. Configurá `META_PIXEL_ID`, `META_CAPI_TOKEN` y `META_TEST_EVENT_CODE` en `backend/.env`.
2. Registrate y guardá el `token` y el `slug`:
   ```bash
   curl -X POST http://localhost:4000/api/auth/register \
     -H 'Content-Type: application/json' \
     -d '{"email":"yo@publi.lat","password":"test1234!","name":"Demo","pixelId":"TU_PIXEL","capiToken":"TU_TOKEN"}'
   ```
3. Simulá el clic del anuncio (usá el `slug` del paso anterior en `u`):
   `http://localhost:4000/go?u=<slug>&msg=Hola%20quiero%20info&fbclid=abc123&campaign=cmp1&src=ig`
   → redirige a `wa.me/...(ref: CODE)`. Confirmá el evento **Lead** en el *Test Events Tool* de Meta.
4. Listá leads y marcá la compra:
   ```bash
   curl http://localhost:4000/api/leads -H "Authorization: Bearer <token>"
   curl -X POST http://localhost:4000/api/leads/<id>/purchase \
     -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
     -d '{"amount":1500,"currency":"ARS"}'
   ```
5. Confirmá el evento **Purchase** en el *Test Events Tool* y revisá el **Event Match Quality**
   (debe matchear el Lead por el mismo `external_id`).

### Landing rastreada (dedup navegador + servidor)

Para subir el Event Match Quality, el `Lead` se dispara por **navegador** (Pixel) y por
**servidor** (CAPI) con el mismo `eventID`; Meta los deduplica y combina las señales
(`_fbp`/`_fbc` del browser + `external_id`/IP del server).

1. Abrí en el navegador (mejor desde una campaña, con `fbclid` en la URL):
   `http://localhost:4000/l/<slug>?msg=Hola%20quiero%20info&title=Promo`
2. Tocá **Hablar por WhatsApp**: dispara el `Lead` del navegador y redirige a `/go`,
   que lee `_fbp`/`_fbc` y dispara el `Lead` del servidor con el MISMO `eventID`.
3. En *Test Events* deberías ver el `Lead` recibido por **Navegador** y **Servidor**
   marcados como deduplicados, con mejor Event Match Quality.

## Fase 2 — WhatsApp + Inbox

Integra **Evolution API** (corre en Docker, ver `docker-compose.yml`) para conectar
líneas de WhatsApp, recibir mensajes y asociarlos al lead por el `code`.

### API (Fase 2, todas con Bearer salvo el webhook)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET`    | `/api/wa/lines` | Líneas del usuario con su estado |
| `POST`   | `/api/wa/lines` | `{ label?, phone? }` → crea la línea + instancia en Evolution. Devuelve `qr` (si ya está disponible) |
| `POST`   | `/api/wa/lines/:id/connect` | Devuelve el `qr` (data URL) para escanear; también lo emite por socket |
| `GET`    | `/api/wa/lines/:id/status` | Estado de conexión en vivo |
| `POST`   | `/api/wa/lines/:id/logout` | Desvincula el teléfono |
| `DELETE` | `/api/wa/lines/:id` | Borra la instancia y la línea |
| `GET`    | `/api/inbox/:contactId/messages` | Historial de la conversación |
| `POST`   | `/api/inbox/:contactId/messages` | `{ body }` → envía un mensaje por WhatsApp |
| `POST`   | `/api/wa/webhook` | (Lo llama Evolution) eventos de QR, conexión y mensajes |

**Socket.IO** (el cliente manda el JWT en `auth.token`): eventos `wa:qr {lineId, qr}`,
`wa:status {lineId, state, connected}`, `inbox:message {contactId, message, stage?}`.

### Cómo conectar una línea

1. Levantá los servicios: `docker compose up -d` (Postgres, Redis, Evolution).
2. Backend (`cd backend && npm run dev`) y panel (`cd frontend && npm run dev`).
3. En el panel → **WhatsApp** → **Crear línea** → escaneá el QR desde
   *WhatsApp › Dispositivos vinculados*. Cuando el estado pase a **conectado**, la línea
   queda activa.
4. Probá el loop completo: abrí tu link rastreado (pestaña **Links**), entrá a WhatsApp
   con el mensaje (que trae `ref: CODE`), y mandá el mensaje. En **Inbox** debería aparecer
   la conversación asociada al lead (pasa a `CONTACTADO`). Marcá la compra desde **Leads**.

### ⚠️ Nota importante: error 405 / "no aparece el QR"

Evolution trae fijada una versión de WhatsApp Web que **se vuelve vieja** y WhatsApp
rechaza el handshake con `statusReason: 405` (la línea queda en "connecting" y nunca
genera QR). Se resuelve fijando una versión actual en `docker-compose.yml`:

```yaml
environment:
  - CONFIG_SESSION_PHONE_VERSION=2.3000.1035194821   # actualizar si vuelve a fallar
```

La versión actual se consulta en
`https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/baileys-version.json`.
Después de cambiarla: `docker compose up -d evolution-api`.

## Fase 3 — CRM + Analytics

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET`   | `/api/analytics/overview` | Totales (leads, por etapa, facturación, conversión) + desglose por campaña y por fuente |
| `PATCH` | `/api/leads/:id` | `{ stage?, name? }` — mueve el lead entre etapas (kanban). No permite `COMPRO` (eso va por `/purchase`) |

- **Dashboard (ROAS)**: tarjetas de leads/contactados/compras/facturación/conversión + tablas
  por campaña y fuente. Es la pantalla por defecto del panel.
- **Kanban**: columnas por etapa con drag & drop. Soltar un lead en **COMPRO** abre el modal
  de monto y dispara el **Purchase** a Meta.
- **Hardening Inbox (LID)**: se guarda el `waJid` crudo del contacto (soporta direcciones
  `@lid` de privacidad de WhatsApp) y se usa para responder, no sólo el teléfono.

## Fase 4 — Multi-línea + billing

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET`  | `/api/billing/credit` | Días disponibles + movimientos (ledger) |
| `POST` | `/api/billing/credit/add` | `{ days }` — suma días (stub de compra; pago real en F5) |
| `POST` | `/api/wa/lines/:id/activate` | `{ days }` — consume días del crédito y extiende `expiresAt` de la línea |

- **Rotación de líneas**: el redirector `/go` reparte los clics entre las líneas elegibles
  (conectada + `active` + con días) usando LRU (`lastUsedAt`): la menos usada primero.
- **Días/tokens**: 1 día = 1 línea activa 24h. Activar una línea consume días y le fija
  `expiresAt`. El crédito y cada movimiento quedan en `Credit` / `CreditLedger`.
- **Vencimiento automático (BullMQ + Redis)**: un job repetible cada 60s desactiva las
  líneas vencidas (`status` → `inactive`, salen de rotación) y avisa por Socket.IO
  (`wa:status` con `state: "expired"`).

## Fase 5 — Landings + integraciones + pagos

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET/POST` | `/api/landings` | Lista / crea landings (genera HTML rastreado: pixel + CTA dedup) |
| `PUT/DELETE` | `/api/landings/:id` | Edita (regenera HTML) / borra |
| `POST` | `/api/landings/:id/publish` | Publica en S3+CloudFront o, si no hay creds, local |
| `GET` | `/p/:slug` | (público) sirve la landing guardada |
| `GET/PUT` | `/api/integrations` | Config de integración con CRM externo |
| `POST` | `/api/integrations/test` | Dispara un webhook de prueba |
| `POST` | `/api/billing/checkout` | Inicia pago real (MercadoPago) o devuelve stub |
| `POST` | `/api/billing/webhook` | (público) notificación de MercadoPago → acredita días |

- **Landings**: editor en el panel; cada landing trae el Pixel del navegador + el botón
  que dispara `Lead` (deduplicado con el server). Se sirven desde `/p/:slug`.
- **Publicación S3+CloudFront** *(opcional)*: gateada por `.env`. Si falta `AWS_S3_BUCKET`
  (o el SDK), la landing se sirve desde el backend. Para habilitar:
  `cd backend && npm i @aws-sdk/client-s3` y completar `AWS_*` + `CLOUDFRONT_DOMAIN`.
- **Integraciones**: modos `nativo | webhook | kommo`. En `webhook`/`kommo` se hace
  `POST` al CRM por cada **lead** y **compra**, firmado con HMAC-SHA256
  (header `X-Publilat-Signature`) si configurás un secret.
- **Pagos** *(cada método opcional, gateado por `.env`)*: el panel ofrece comprar días con
  **MercadoPago** (LATAM), **Stripe** (tarjeta, global) y **USDT** (cripto vía NOWPayments,
  global). `POST /api/billing/checkout {days, provider}` devuelve la URL de checkout; cada
  pasarela tiene su webhook que acredita los días al confirmarse:
  `/api/billing/webhook` (MercadoPago), `/api/billing/webhook/stripe` (firma verificada con
  body crudo), `/api/billing/webhook/usdt` (IPN con HMAC). Sin claves, el checkout cae al
  stub. Precio: `MP_PRICE_PER_DAY` (MercadoPago) y `PRICE_PER_DAY_USD` (Stripe/USDT).

## Producción

El backend sirve la API + el panel en un solo servicio. Deploy con Docker:

```bash
cp .env.prod.example .env   # completar JWT_SECRET, dominio, META_*, etc.
docker compose -f docker-compose.prod.yml up -d --build
```

Guía completa en **[DEPLOY.md](DEPLOY.md)**. Hardening incluido: helmet, CORS estricto,
rate-limiting, validación de env al boot, error handler, apagado limpio, webhook con token.
Tests: `cd backend && npm test`.

## Roadmap

Ver `KICKOFF.md` y el documento `ScaleOS_Plan_Tecnico.docx`.
**Completas: F1 (loop) · F2 (WhatsApp + Inbox) · F3 (CRM + Analytics) · F4 (multi-línea + billing) · F5 (landings + integraciones + pagos).**
**Producción: hardening + Docker + tests listos.** Pendiente de credenciales externas
(gateado): S3+CloudFront, MercadoPago, cuenta Kommo.
