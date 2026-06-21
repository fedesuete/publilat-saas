# 🚀 Deploy de Publi.lat a producción

El backend sirve la API + Socket.IO **y** el panel (build de Vite) en un solo servicio.
Stack: app + Postgres + Redis + Evolution API, todo con Docker Compose.

> Requisito: WhatsApp necesita proceso persistente con estado → **VPS/contenedor dedicado**,
> no serverless.

## 1. Preparar variables

```bash
cp .env.prod.example .env
# Editá .env: como mínimo
#   JWT_SECRET   -> openssl rand -hex 32
#   POSTGRES_PASSWORD, APP_BASE_URL, PANEL_BASE_URL (tu dominio https)
#   META_PIXEL_ID, META_CAPI_TOKEN  (para que el loop matchee)
#   EVOLUTION_API_KEY, EVOLUTION_WEBHOOK_TOKEN
```

El arranque **aborta** si en producción falta `JWT_SECRET` (o es el de ejemplo),
`DATABASE_URL`, `APP_BASE_URL` o `PANEL_BASE_URL` — es a propósito.

## 2. Levantar todo

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Esto buildea la imagen (panel + backend), aplica las migraciones de Prisma
(`migrate deploy`) automáticamente al arrancar, y levanta Postgres/Redis/Evolution.

- Panel + API: `http://SERVIDOR:4000` (poné un reverse proxy con HTTPS delante).
- Health: `GET /4000/health`.

## 3. HTTPS automático (ya incluido)

El stack trae **Caddy** como reverse proxy (ver `Caddyfile` + servicio `caddy` en el
compose). Saca y renueva el certificado de Let's Encrypt solo. Sólo necesitás:

1. Apuntar tu dominio (un registro **A**) a la **IP del VPS**.
2. Definir `APP_DOMAIN=app.tudominio.com` en `.env` (y `APP_BASE_URL`/`PANEL_BASE_URL`
   con ese mismo `https://app.tudominio.com`).
3. Tener abiertos los puertos **80 y 443** en el firewall del VPS.

`docker compose -f docker-compose.prod.yml up -d --build` levanta Caddy en 80/443 y
enruta a la app (que no queda expuesta: escucha sólo en `127.0.0.1:4000`). El panel se
sirve desde el backend (mismo origen) → sin líos de CORS.

## 4. Post-deploy

1. Entrá al panel → **Crear cuenta** (el primer usuario).
2. **WhatsApp → Crear línea →** escaneá el QR.
   - Si el QR no aparece (error 405), actualizá `CONFIG_SESSION_PHONE_VERSION` en `.env`
     (ver el valor actual en la doc de Baileys) y `docker compose ... up -d evolution-api`.
3. **Créditos →** comprar/agregar días → **Activar** la línea.
4. Probá el loop: **Links** → abrir → escribir por WhatsApp → ver el lead en **Inbox**.
5. Verificá Lead/Purchase en el **Test Events Tool** de Meta.

## 5. Integraciones opcionales (gateadas por `.env`)

| Función | Cómo activar |
|---|---|
| **MercadoPago** (LATAM) | `MP_ACCESS_TOKEN` (+ `MP_CURRENCY`, `MP_PRICE_PER_DAY`). Webhook: `/api/billing/webhook`. |
| **Stripe** (tarjeta, global) | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`. En el dashboard de Stripe creá un webhook a `https://TU_DOMINIO/api/billing/webhook/stripe` (evento `checkout.session.completed`). Precio en USD por día: `PRICE_PER_DAY_USD`. |
| **USDT** (cripto, global) | `NOWPAYMENTS_API_KEY` + `NOWPAYMENTS_IPN_SECRET` (NOWPayments). En NOWPayments seteá el IPN a `https://TU_DOMINIO/api/billing/webhook/usdt`. Red de cobro: `NOWPAYMENTS_PAY_CURRENCY` (ej. `usdttrc20`). |
| **Landings en S3+CloudFront** | `cd backend && npm i @aws-sdk/client-s3`, completar `AWS_*` + `CLOUDFRONT_DOMAIN`. Sin esto, se sirven desde `/p/:slug`. |
| **CRM externo (Kommo/webhook)** | Configurar en el panel → **Integraciones** (URL + secret). Firma HMAC en `X-Publilat-Signature`. |

> Los 3 webhooks de pago son públicos y acreditan los días de forma **idempotente**.
> El de Stripe valida la firma con el body crudo; el de USDT valida el HMAC del IPN.

## 6. Operación

```bash
docker compose -f docker-compose.prod.yml logs -f app      # logs del backend
docker compose -f docker-compose.prod.yml ps               # estado
docker compose -f docker-compose.prod.yml down             # apagar (volúmenes persisten)
docker compose -f docker-compose.prod.yml up -d --build    # redeploy tras cambios
```

**Backups**: respaldá el volumen `pgdata` (Postgres) y `evolution_instances`
(sesiones de WhatsApp). 

**Migraciones**: corren solas al arrancar el contenedor. Si escalás a varias réplicas,
sacá el `migrate deploy` del `CMD` y corrélo en un job de deploy aparte.

## 7. Hardening incluido

- Helmet (headers), CORS restringido a `PANEL_BASE_URL`, rate-limit (auth 30/15m, `/go`
  120/min, API 300/min), validación de env al boot, error handler que no filtra stack
  traces, 404 JSON para `/api`, apagado limpio (SIGTERM/SIGINT → cierra HTTP/colas/DB),
  webhook de Evolution con token, secretos sólo por `.env`.
- Tests: `cd backend && npm test` (vitest).
