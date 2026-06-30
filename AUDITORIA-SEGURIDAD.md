# Auditoría de seguridad — Publi.lat

Revisión del código real (backend Express/TS/Prisma + frontend React). Severidad: Crítico / Alto /
Medio / Bajo. Cada hallazgo dice qué archivo, cómo se explota y cómo se corrige.

> TL;DR: la base está **sólida** (aislamiento multi-tenant correcto, sin secretos en git, bcrypt,
> tokens cifrados con AES-256-GCM, Prisma sin SQL raw). Hay **2 críticos y 3 altos** para cerrar
> antes de abrir a clientes reales. Ninguno es un rediseño; son parches acotados.

---

## Conceptos clave (los "nombres" que tenés que conocer)

- **IDOR (Insecure Direct Object Reference):** acceder a datos de otro usuario cambiando un id en la
  URL. → En tu código está **bien resuelto** (todas las rutas filtran por `userId`). No tocar.
- **Stored XSS:** guardar `<script>` malicioso que después se ejecuta en el navegador de quien abre
  la página. → Riesgo real en tus **landings de HTML libre**.
- **SSRF (Server-Side Request Forgery):** hacer que tu servidor pegue a una URL interna (ej. la
  metadata del cloud) que el atacante elige. → Riesgo real en el **webhook saliente de Integraciones**.
- **Webhook signature / HMAC:** firma que prueba que un webhook vino de quien dice. → **Falta** en
  los webhooks de WhatsApp y MercadoPago.
- **Token theft / revocation:** robo de sesión y poder invalidarla. → Tu JWT vive en `localStorage`
  7 días sin poder revocarlo.

---

## 🔴 CRÍTICO

### C1 — Los webhooks de WhatsApp no validan firma
`routes/wa-cloud.ts` (Cloud API) y `routes/webhook.ts` (Evolution).
Procesan el payload sin verificar `X-Hub-Signature-256` contra `META_APP_SECRET` (que ya tenés).
**Cómo se explota:** alguien que conozca un `phone_number_id` POSTea mensajes falsos → inyecta
chats/leads en el Inbox de cualquier cliente y dispara eventos Lead/Purchase falsos a Meta (ensucia
la atribución y puede marcar ventas falsas).
**Fix:** validar HMAC-SHA256(`META_APP_SECRET`, rawBody) en el webhook Cloud (montar `express.raw`
para ese path, igual que ya hacés con Stripe). En Evolution, hacer obligatorio un token/firma.

### C2 — SSRF en el webhook saliente de Integraciones
`lib/integrations.ts` + `routes/integrations.ts` (`POST /api/integrations/test`).
El cliente pone una `webhookUrl` arbitraria y el server le pega sin validar el destino.
**Cómo se explota:** un cliente pone `http://169.254.169.254/latest/meta-data/...` (metadata del
cloud) o `http://127.0.0.1:...` y toca "probar" → tu server pega a la red interna y devuelve el
status (sirve para escanear/exfiltrar).
**Fix:** resolver el DNS y rechazar IPs privadas/loopback/link-local/metadata (169.254/16, 127/8,
10/8, 172.16/12, 192.168/16, ::1). Exigir https y bloquear redirects.

---

## 🟠 ALTO

### A1 — XSS almacenado en landings con HTML libre
`routes/landings.ts` (acepta `html` hasta 200 KB sin sanitizar) → `routes/landing.ts`
(`GET /p/:slug` lo sirve crudo con `res.send`), **desde el mismo dominio que el panel**.
**Cómo se explota:** una landing con `<script>` roba el token del panel (que está en localStorage,
ver A2) de quien la abra en ese origen.
**Fix:** sanitizar con DOMPurify/sanitize-html, **o** servir las landings de usuario desde un
dominio aparte (sandbox) — el código ya contempla S3/CloudFront; usar ese camino para HTML libre.
Nota: la landing por plantilla (no-HTML-libre) **sí** escapa bien; el problema es solo el HTML libre.

### A2 — JWT en localStorage, 7 días, sin revocación
`frontend/src/lib/auth.tsx` + `api.ts`. El token vive en `localStorage` (cualquier XSS lo roba),
dura 7 días, y el logout es solo del lado del cliente: **no hay forma de invalidar un token robado**,
ni siquiera suspendiendo la cuenta (el `suspended` solo se chequea al loguear).
**Fix:** cookie `httpOnly + Secure + SameSite`, expiración más corta + refresh, y revocación
(campo `tokenVersion` en User que `requireAuth` revalide; así "suspender" corta sesiones vivas).

### A3 — Webhook de MercadoPago sin validar firma
`routes/billing.ts`. No valida la firma `x-signature` de MP.
**Mitigación que ya tenés:** re-consultás el pago real a la API de MP y solo acreditás si está
`approved` (y es idempotente) — eso evita la acreditación falsa directa, pero sigue siendo abusable
para forzar llamadas/DoS. (Stripe y NOWPayments **sí** validan firma, bien ahí.)
**Fix:** validar el HMAC `x-signature` + `x-request-id` de MercadoPago antes de procesar.

---

## 🟡 MEDIO

- **M1 — `Integration.secret` se devuelve en claro** al frontend y se guarda sin cifrar
  (`routes/integrations.ts`). Cifralo en reposo y devolvé solo máscara (como ya hacés en pixel/wa).
- **M2 — CSP desactivada** (`index.ts`, `contentSecurityPolicy: false`). Sin CSP, A1/A2 se explotan
  sin fricción. Poné CSP estricta para el panel y una política aparte para landings.
- **M3 — CORS cae a `*` con credenciales** si `PANEL_BASE_URL` está vacío. Nunca `*` con
  `credentials: true`; usar lista explícita.
- **M4 — `JWT_SECRET` con fallback placeholder** fuera de producción (el `.env` trae literal
  `cambia-esto-por-un-secreto-largo`). Si un deploy corre sin `NODE_ENV=production`, se pueden forjar
  JWTs (incluido uno admin). Exigir secreto fuerte SIEMPRE.
- **M5 — `APP_ENCRYPTION_KEY` con fallback inseguro** en dev (misma lógica que M4).
- **M6 — Logs con identificadores de clientes** (wabaId/phoneNumberId) en el flujo OAuth. Sacar de
  logs de producción.

## 🟢 BAJO
- B1 — Comparación de firmas no constant-time (usar `crypto.timingSafeEqual`).
- B2 — Webhooks y `/api/data-deletion` sin rate-limit (DoS).
- B3 — Enumeración de usuarios por respuestas 404 distintas en `/l/:slug` y `/go?u=`.
- B4 — Socket no re-chequea `suspended` (mismo tema de revocación que A2).

---

## ✅ Lo que YA está bien (no rehacer)
- **Aislamiento multi-tenant correcto:** todas las rutas con `:id` filtran por `userId`. No hay IDOR.
- **Panel admin** con `requireAuth + requireAdmin` real; no expone tokens CAPI/WA (van enmascarados).
- **Passwords** con bcrypt (cost 10). **Tokens CAPI/WA** cifrados con AES-256-GCM + IV aleatorio.
- **Prisma sin SQL raw** → sin inyección SQL. **Stripe y NOWPayments** validan firma.
- **Secretos NO están en git** (`.gitignore` cubre `.env`; solo se commitea `.env.example`).
- `express.json` con límite de 1 MB, validación zod en casi todos los endpoints, manejador de
  errores que no filtra stack traces.

---

## Plan de acción sugerido (orden)
1. **C1 + C2** (críticos) — firmar webhooks WhatsApp + bloquear SSRF. Prompt para Claude Code.
2. **A1 + A2 + A3** (altos) — sanitizar/aislar landings, JWT en cookie httpOnly + revocación,
   firmar webhook MP.
3. **Medios** (M1–M6) en una segunda tanda.
4. **Tests de seguridad** (ver abajo) para verificar cada fix.

## Tests a correr después de los fixes
- Intentar POSTear al webhook Cloud sin firma válida → debe dar 401/403.
- Configurar `webhookUrl = http://169.254.169.254/...` en Integraciones → "probar" debe rechazar.
- Publicar una landing con `<script>alert(1)</script>` → no debe ejecutarse en el origen del panel.
- Robar el token de localStorage y usarlo tras "suspender" la cuenta → debe quedar inválido.
- Mandar un webhook de MP falso → no debe acreditar días.
- Cambiar el `:id` de un lead/línea por el de otro usuario → debe dar 404 (confirmar que sigue bien).
