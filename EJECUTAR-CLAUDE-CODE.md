# Prompt de ejecución para Claude Code — Publi.lat a producción

Pegá TODO el bloque de abajo en Claude Code. Está ordenado por prioridad y verificado
contra el panel real (app.publi.lat) y el código. Hacelo de a un bloque (P0 → P1 → P2 →
Hardening); cuando termines uno, seguís con el siguiente.

---

```
Sos el dev principal de Publi.lat (SaaS de atribución WhatsApp -> Meta Ads). Leé CLAUDE.md.
El producto ya está en producción (app.publi.lat) con: Dashboard, Leads, Kanban, Inbox,
WhatsApp, Créditos, Links, Landings, Integraciones. El loop de atribución (clic -> Lead ->
chat -> compra -> Purchase por CAPI) funciona, con rotación de líneas, dedup navegador+
servidor, Inbox en tiempo real y billing con 3 pasarelas (en código).

Quiero cerrar los gaps para producción multi-cliente. Trabajá por prioridad, EN ORDEN.
Antes de cada bloque mostrame un plan corto; al terminar cada bloque hacé typecheck
(tsc) y, si hay tests, corrélos. No rompas el loop de atribución existente. Todo el
acceso a datos va scopeado por req.userId (multi-tenant).

============================================================
P0 — «Mi Pixel» (BLOQUEANTE). Sin esto el multi-tenant no atribuye por cliente.
============================================================
Problema: resolveUserPixel() lee de la tabla Pixel, pero no existe endpoint ni pantalla
para crear/editar esos registros, así que hoy todos caen al pixel global del .env.

Backend:
- Nuevo src/routes/pixel.ts (requireAuth), scope por req.userId:
  · GET    /api/pixels       -> lista; enmascará el capiToken (mostrá solo últimos 4).
  · POST   /api/pixels       -> { pixelId, capiToken, eventType:"Lead"|"Purchase", siteUrl? }
  · PUT    /api/pixels/:id    -> editar (si llega capiToken nuevo, reemplazar).
  · DELETE /api/pixels/:id
  Validá con zod. Montalo: app.use("/api/pixels", apiLimiter, requireAuth, pixelRouter).
- Cifrá el capiToken en reposo con una APP_ENCRYPTION_KEY del .env (crypto AES-GCM);
  nunca lo loguees ni lo devuelvas entero.

Frontend:
- src/pages/PixelPage.tsx (ruta /pixel) + entrada "Mi Pixel" en AppLayout NAV (arriba de Links).
- Lista de pixels (Pixel ID, evento, siteUrl, token enmascarado) + Agregar/Editar/Eliminar.
- Ayuda inline: dónde sacar el Pixel ID y cómo generar el token de CAPI en el
  Administrador de Eventos de Meta.

Verificación: creá 2 usuarios con pixel distinto; confirmá en la tabla MetaEvent que el
Lead de cada uno sale con SU pixelId. Typecheck + probar la UI.

============================================================
P1 — Visibilidad y operación
============================================================
P1.1 Analytics completo (Dashboard como ScaleOS)
- Backend: GET /api/analytics/timeseries (y ampliar overview):
  · Clics, chats reales y ventas para HOY / SEMANA / MES, con % de conversión.
    Clics = contactos creados en /go en el período. Chats reales = contactos con stage
    != NUEVO. Ventas = stage COMPRO (+ suma revenue).
  · Ratio Click->Chat = chats reales / clics.
  · Serie "Leads últimos 30 días": [{date, count}] por día.
  · Líneas activas en rotación ahora.
- Frontend (DashboardPage): tarjetas Clics/Líneas activas, Chats reales/Click->Chat %,
  Ventas (con %)/Conversión del mes, y gráfico de líneas "Leads últimos 30 días".
  Mantené el estilo oscuro con acento verde.

P1.2 Agenda de contactos
- src/pages/AgendaPage.tsx (ruta /agenda) + NAV.
- GET /api/leads: agregá búsqueda (?q= por nombre/teléfono) y filtro
  (?filter=todos|conversiones|leads). Teléfono solo en el detalle (no en lista).
- UI: buscador + tabs Todos/Conversiones/Leads, agrupado por fecha; al expandir un
  contacto, ficha con teléfono, línea WA, pixel, fuente, campaña, página/landing, ID único.

P1.3 Configuración / Onboarding
- src/pages/SetupPage.tsx (ruta /configuracion) + NAV.
- GET /api/setup/status -> { pixel:bool, landing:bool, whatsapp:bool } según estado real
  (existe Pixel del user / Landing published=true / WaLine connected=true).
- Checklist de 3 pasos autocompletado + selector de modo (reusa /api/integrations).

============================================================
P2 — Paridad fina (una cosa por vez, typecheck en cada una)
============================================================
1. Líneas (WhatsappPage): acciones Pausar (status=paused, sale de rotación) y Resume,
   además de activar/extender/logout. Mostrar vencimiento y estado con colores.
   Backend: POST /api/wa/lines/:id/pause y /resume.
2. Landings: permitir editar HTML libre y subir .html propio, además del editor por
   campos; sumar 2-3 plantillas base.
3. Tutoriales: página estática /tutoriales con guías por sección.
4. (Opcional) Kommo real: mapear el webhook al formato de Kommo cuando mode=kommo.

============================================================
HARDENING — antes de escalar inversión en ads
============================================================
1. Cola de reintentos para CAPI: los MetaEvent con status "failed" deben reintentarse
   con backoff (reusá BullMQ que ya vence líneas); marcar "sent" al lograrlo.
2. Pasarelas de pago: en producción están en modo stub (sin claves). Cuando se quiera
   cobrar, cargar las claves de MercadoPago/Stripe/USDT en el .env y probar un pago real.
3. .env de producción: META_*, EVOLUTION_*, S3/CloudFront, JWT_SECRET fuerte,
   PANEL_BASE_URL con el dominio real y CORS cerrado (no "*").
4. Backups automáticos de Postgres.
5. Validar en el Test Events Tool de Meta que Lead y Purchase lleguen con Event Match
   Quality alto, usando un pixel/token real de un cliente.

Arrancá por P0 y mostrame el plan antes de codear.
```
