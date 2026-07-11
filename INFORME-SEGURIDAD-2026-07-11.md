# Informe de seguridad — Publi.lat (2026-07-11)

Auditoría defensiva de la plataforma propia, con 6 auditores en paralelo (authn/authz/IDOR,
inyección/SSRF/webhooks, secretos/crypto/PII, input/DoS, infra/config/headers, deps/billing).
Análisis de código; no se corrieron exploits contra producción. Cada hallazgo se verificó
leyendo el código real. **Los fixes marcados ✅ ya están aplicados y commiteados (sin deploy).**

> **Estado general BUENO.** El aislamiento multi-tenant es sólido (sin IDOR), la cripto es
> sana, no hay secretos filtrados en el repo, 0 vulnerabilidades de dependencias (`npm audit`),
> y los webhooks de pago verifican firma + estado server-to-server. Los hallazgos son de
> hardening y de un par de vectores concretos, ninguno con compromiso ya ocurrido.

---

## Aplicado ✅ (commiteado, falta deploy que apruebes vos)

### ALTO — Doble/N-ple acreditación de días por el mismo pago
`billing.ts approvePayment` y `consumeDayAndActivate` hacían read-check-write sin candado:
disparando `/api/billing/usdt/verify` con el mismo txid en requests concurrentes, las N pasaban
el check y acreditaban → pagás una vez, recibís N días. **Fix:** transición de estado atómica
condicional (`updateMany where status≠approved` / `where days≥1`); solo la escritura que
transiciona acredita. Sin migración, sin cambio de comportamiento legítimo.
*(Defensa en profundidad recomendada NO aplicada: `@@unique([provider, externalId])` en Payment
— requiere verificar que no haya duplicados históricos en la DB antes de crear el índice.)*

### MEDIO — `/api/wa/cloud/connect` salteaba el paywall y el límite de plan
El alta de línea Cloud por Embedded Signup no cobraba días ni validaba `maxLines` (el otro
camino de alta sí). Línea Cloud gratis e ilimitada. **Fix:** mismos gates que `POST /lines`
(días ≥ 1, `maxLines`, `consumeDayAndActivate`).

### MEDIO — Webhook de WhatsApp (`/api/wa/webhook`) sin auth obligatoria
Confirmado por 4 auditores. El token era opcional y se comparaba con `!==` (no timing-safe).
El endpoint muta estado sensible (crea leads, dispara Lead/Purchase CAPI, detección de pago).
**Fix:** token **obligatorio en producción** (falla cerrado con 503 si falta; `validateEnv` lo
exige), comparación con `crypto.timingSafeEqual`. *(En tu VPS el token YA estaba seteado — lo
verifiqué —, así que el deploy de esto no rompe nada.)*

### MEDIO/ALTO — DoS: descarga de media sin cota de tamaño
Los 3 motores (Cloud/Evolution/WAHA) bajaban media server-side sin `maxContentLength` y la
guardaban como base64 en Postgres. Un tercero que mensajea la línea podía mandar archivos de
~100 MB → pico de RAM (OOM del proceso, que tumba todas las sesiones) + inflado de la DB.
**Fix:** tope de 15 MB (`MAX_MEDIA_BYTES`) en las 3 descargas.

### ALTO — Cost-DoS de la IA de comprobantes
En modo assisted/auto, cada imagen entrante disparaba una llamada facturada a la IA de visión,
sin límite. Un tercero inundando con imágenes dispara gasto a voluntad. **Fix:** throttle por
contacto (`RECEIPT_AI_MAX_PER_HOUR`, default 20/h); superado el tope, el mensaje se guarda pero
no se analiza.

### MEDIO — Webhooks públicos sin rate-limit
Los webhooks de pago e inbound (Kommo) no tenían techo. **Fix:** `webhookLimiter` (600/min/IP)
en MP/USDT/Pagopar/inbound/data-deletion. El de WhatsApp queda sin limiter a propósito (su
tráfico legítimo llega todo desde la IP interna de WAHA/Evolution y ya exige token).

### MEDIO — Índices faltantes en tablas calientes (perf + amortigua floods)
`Message` y `Contact` no tenían índices; `WaLine.sessionId` (lookup en cada evento de webhook)
tampoco. **Fix:** migración `20260711140000_perf_indexes` (índices en sessionId/userId de WaLine,
(userId,phone)/(userId,stage) de Contact, (contactId,createdAt)/(lineId,direction,createdAt) de
Message). Idempotente (`CREATE INDEX IF NOT EXISTS`).

### MEDIO — Teléfono en texto plano en el log de `/api/data-deletion`
Violaba la regla de CLAUDE.md, endpoint público sin rate-limit y con input crudo (log
injection por `\n`). **Fix:** enmascarar teléfono/email, sanitizar saltos de línea, + limiter.

### BAJO — Revocación de sesión no cortaba el socket
El handshake de Socket.IO no revalidaba `tokenVersion`/`suspended`: un usuario suspendido seguía
recibiendo eventos en vivo de su cuenta hasta que expirara el JWT (7 días). **Fix:** revalidación
contra la DB en el handshake (igual que `requireAuth`).

### BAJO — Firma IPN de NOWPayments comparada con `===`
No timing-safe (inconsistente con MP/Pagopar). **Fix:** `crypto.timingSafeEqual`.

### BAJO — `tokenMask` enmascaraba el ciphertext en vez del token real (cosmético)
**Fix:** descifrar y luego enmascarar (los "últimos 4" ahora son del token real).

### BAJO — Templates de compose con defaults débiles + puertos abiertos
`docker-compose.prod.yml` (desactualizado) exponía Evolution 8080 a 0.0.0.0 con la key del repo;
`docker-compose.waha.yml` (prueba) exponía el dashboard con defaults. **Fix:** bind a
`127.0.0.1`, y `${VAR:?}` (falla si falta) en las keys. **Tu `vps.yml` real ya estaba bien** (sin
puertos públicos) — esto es solo para los templates.

---

## NO aplicado — requiere tu decisión

### 🔴 ALTO (prioridad 1) — Stored XSS en landings `/p/:slug`
Confirmado por 2 auditores. Las landings con HTML libre se sirven en el **mismo origen** que el
panel y la API, con CSP desactivada. Un usuario publica JS que, si lo abre otro usuario logueado
o vos como admin (p. ej. revisando la landing de un cliente), ejecuta `fetch('/api/...')` con la
sesión de la víctima. La cookie es httpOnly (por eso no es crítico), pero viaja sola en las
requests same-origin.

**Por qué no lo apliqué solo:** el fix bueno es servir las landings desde **otro origen sin
cookies** — es exactamente el CDN off-brand (S3/CloudFront/R2) que ya tenías pendiente en la
memoria del proyecto. Una CSP estricta aplicada a ciegas podría romper landings reales de
clientes (imágenes/fuentes/scripts de terceros que ya usen). **Recomendación:** priorizar el
CDN off-brand pendiente; mientras tanto, si querés, puedo aplicar una CSP por-ruta a `/p/:slug`
permitiendo el pixel de Meta pero bloqueando exfiltración — pero conviene revisar antes qué
tienen las landings publicadas para no romperlas.

### MEDIO — SSRF por DNS rebinding / TOCTOU
`ssrf.ts` resuelve y valida el DNS, pero la request real (axios en webhooks salientes; Evolution/
WAHA en el proxy por línea) lo re-resuelve. Un dominio con TTL 0 puede pasar la validación con
IP pública y conectar a IP interna. Las formas raras de IP (hex/octal/IPv4-mapped) SÍ están bien
cubiertas — el hueco es solo el TOCTOU. **Fix propuesto:** resolver una vez y pinear la IP en la
conexión (axios con `lookup` fijo). No lo apliqué porque toca el cliente HTTP de varios caminos y
querría probarlo bien; riesgo bajo dado que requiere un webhook/proxy configurado por un usuario
autenticado apuntando a un dominio malicioso.

### MEDIO/BAJO — Modo auto de comprobantes puede forzar Purchase con monto inflado
Una imagen adversaria ("PAGO 9.999.999") puede gatillar un Purchase con ese valor al pixel del
dueño. El texto del chat NO va al modelo (bien); el vector es la imagen. **Decisión de producto:**
confirmación de 1 clic por encima de un umbral de monto, o subir `AUTO_MIN_CONFIDENCE`. No lo
toqué porque cambia cómo funciona la detección para quien usa `auto`.

### BAJO — Otros (documentados, no aplicados)
- `analytics`/`leads` hacen `findMany` sin `take` (un tenant con millones de contactos degrada
  el proceso al abrir su dashboard). Fix: paginar / usar agregaciones en DB. No lo apliqué para
  no cambiar el contrato de la API que consume el front.
- `checkLineHealth` bloquea 15 s serial por línea caída (si caen muchas a la vez, el job se
  solapa). Fix: paralelizar con cota de concurrencia.
- CSP global desactivada (relacionado con el XSS de landings).
- `APP_ENCRYPTION_KEY` sin validar largo mínimo (dejarlo como el ejemplo `openssl rand -hex 32`).
- Detalle de error de Graph/WAHA devuelto al cliente autenticado.

---

## Revisado y CORRECTO (sin acción)
Aislamiento por `userId` en todas las rutas; JWT sin `alg:none`; panel admin bien guardeado;
firma de webhooks MP/Pagopar/Stripe/Cloud con `timingSafeEqual` + verificación server-to-server;
`inboundToken` de Kommo fuerte y scopeado; sin SQLi/command-injection/path-traversal; cookies
httpOnly+secure+sameSite; `downloadWahaMedia` no es SSRF (re-basa contra WAHA_BASE_URL);
`/go` no es open redirect; sin ReDoS; 0 vulnerabilidades de dependencias.

---

## Deploy
Los fixes están en `main`, sin deployar. Cuando quieras:
```bash
cd /opt/publilat && git pull && docker compose -f docker-compose.vps.yml up -d --build app
```
La migración de índices corre sola al bootear (idempotente). **Verificá antes que
`EVOLUTION_WEBHOOK_TOKEN` esté en el `.env` del VPS** (ya estaba) — ahora es obligatorio en prod
y sin él la app no arranca.
