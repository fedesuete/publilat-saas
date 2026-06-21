# PROMPT — Cerrar gaps de Publi.lat para producción (paridad con ScaleOS)

Pegá los bloques en Claude Code EN ORDEN (P0 primero). Cada bloque es autónomo.
Basado en el comparativo `ScaleOS_vs_Publilat.docx`. El backend ya tiene casi todo;
estas tareas cierran lo que falta para multi-tenant y paridad de UI.

Contexto que Claude Code ya conoce (está en CLAUDE.md): loop de atribución, schema Prisma
(User, Pixel, WaLine, Credit, Contact con stages, Message, Landing, Integration, Payment,
MetaEvent), Evolution API, CAPI, rotación de líneas, billing con 3 pasarelas.

---

## 🔴 BLOQUE P0 — «Mi Pixel» (multi-tenant). Sin esto no se puede vender a clientes.

```
Publi.lat hoy NO tiene forma de que cada usuario cargue su propio Pixel de Meta y su
token de CAPI: resolveUserPixel() lee de la tabla Pixel pero no existe endpoint ni
pantalla para crear esos registros, así que todos caen al pixel global del .env. Quiero
cerrar esto para que el multi-tenant funcione.

Backend:
- Creá src/routes/pixel.ts con CRUD protegido por requireAuth, todo scoping por req.userId:
  · GET    /api/pixels            -> lista los pixels del usuario. NO devuelvas el capiToken
                                     completo: enmascaralo (ej "EAAB…últimos4").
  · POST   /api/pixels            -> { pixelId, capiToken, eventType: "Lead"|"Purchase", siteUrl? }
  · PUT    /api/pixels/:id        -> editar (si mandan capiToken nuevo, reemplazar).
  · DELETE /api/pixels/:id
  Validá con zod. Montalo en index.ts: app.use("/api/pixels", apiLimiter, requireAuth, pixelRouter).
- Guardá el capiToken cifrado en reposo si es fácil (crypto con una APP_ENCRYPTION_KEY del
  .env); si no, al menos nunca lo loguees ni lo devuelvas entero.

Frontend:
- Nueva página src/pages/PixelPage.tsx (ruta /pixel) y entrada "Mi Pixel" en AppLayout NAV.
- Lista de pixels con: Pixel ID, evento (Lead/Purchase), siteUrl, estado. Botones Agregar,
  Editar, Eliminar. Formulario con ayuda: dónde encontrar el Pixel ID y cómo generar el
  token de CAPI en el Administrador de Eventos de Meta.
- Tras guardar, el loop ya usa resolveUserPixel automáticamente.

Verificación: crear 2 usuarios, cada uno con su pixel; confirmar que un Lead de cada uno
usa su propio pixelId (revisar la fila en MetaEvent). Hacé typecheck y probá la UI.
Mostrame el plan antes de codear.
```

---

## 🟠 BLOQUE P1.1 — Analytics completo (Dashboard como ScaleOS)

```
El Dashboard hoy usa /api/analytics/overview (totales + por campaña/fuente). Quiero
sumarle las métricas por tiempo que tiene ScaleOS, sin romper lo existente.

Backend — nuevo endpoint GET /api/analytics/timeseries (y/o ampliar overview):
- Clics, chats reales y ventas para HOY, ESTA SEMANA y ESTE MES, con % de conversión.
  · "Clics" = contactos creados (Contact) en el período.
  · "Chats reales" = contactos que llegaron a CONTACTADO o más (stage != NUEVO).
  · "Ventas" = contactos en COMPRO (con suma de revenue).
- Ratio Click->Chat = chats reales / clics.
- Serie "Leads últimos 30 días": array de { date, count } por día.
- Líneas activas en rotación ahora (connected && status active && no vencidas).

Frontend (DashboardPage):
- Fila de tarjetas: Clics hoy/semana/mes, Líneas activas.
- Fila: Chats reales hoy/semana/mes, Click->Chat %.
- Fila: Ventas hoy/semana/mes (con %), Conversión del mes.
- Gráfico de líneas "Leads últimos 30 días" (usá una lib liviana o SVG simple).
Mantené el estilo actual (oscuro, acento verde Publi.lat). Typecheck + prueba.
```

## 🟠 BLOQUE P1.2 — Agenda de contactos

```
Quiero una sección "Agenda" como la de ScaleOS.
- Frontend: src/pages/AgendaPage.tsx (ruta /agenda) + entrada en NAV.
- Backend: GET /api/leads ya lista contactos; agregá soporte de búsqueda (?q=) por
  nombre/teléfono y filtro (?filter=todos|conversiones|leads). Devolvé también campaignId,
  source, pixelId, landingUrl, externalId, lineId y el teléfono SOLO en el detalle (no en PII de lista).
- UI: buscador + tabs Todos / Conversiones / Leads. Filas agrupadas por fecha. Al expandir
  un contacto, ficha con: teléfono, línea WA, pixel, fuente, campaña, página/landing, ID único.
Typecheck + prueba.
```

## 🟠 BLOQUE P1.3 — Onboarding / Configuración

```
En Integraciones ya existe el selector de modo (nativo/webhook/kommo) en el backend.
Quiero una sección "Configuración" estilo ScaleOS:
- Checklist de 3 pasos que se autocomplete según estado real de la cuenta:
  (1) Pixel configurado -> existe al menos un Pixel del usuario.
  (2) Landing publicada -> existe Landing con published=true.
  (3) WhatsApp conectado -> existe WaLine con connected=true.
  Endpoint GET /api/setup/status que devuelva los 3 booleans.
- Mostrar el selector de modo de conexión visible (reusa /api/integrations).
Frontend: src/pages/SetupPage.tsx (ruta /configuracion) + NAV. Typecheck + prueba.
```

---

## 🟡 BLOQUE P2 — Paridad fina (cuando P0/P1 estén)

```
Mejoras de paridad con ScaleOS, en orden:
1. Líneas (WhatsappPage): agregar acciones Pausar (status=paused, sale de rotación) y
   Redirigir, además de activar/extender/logout. Mostrar vencimiento y estado con colores.
   Backend: POST /api/wa/lines/:id/pause y /resume; el pickLine de go.ts ya excluye no-activas.
2. Landings: permitir editar HTML libre y subir .html propio, además del editor por campos;
   sumar 2-3 plantillas base.
3. Tutoriales: página estática /tutoriales con guías por sección.
4. (Opcional) Kommo real: mapear el webhook de integración al formato de Kommo cuando mode=kommo.
Hacé una cosa por vez, con typecheck y prueba en cada una.
```

---

## 🟢 HARDENING — antes de escalar inversión en ads

```
Endurecimiento para producción:
1. Cola de reintentos para CAPI: los MetaEvent con status "failed" deben reintentarse
   con backoff (reusá BullMQ que ya está para vencer líneas). Marcar "sent" al lograrlo.
2. Revisar .env de producción: META_*, EVOLUTION_*, S3/CloudFront, claves de pasarelas,
   JWT_SECRET fuerte, PANEL_BASE_URL con el dominio real y CORS cerrado (no "*").
3. Backups automáticos de Postgres.
4. Validar en el Test Events Tool de Meta que Lead y Purchase lleguen con Event Match
   Quality alto, usando un pixel/token real de un cliente.
Implementá el punto 1 y dejame una checklist de 2-4 para hacer en el deploy.
```

---

### Resumen de prioridades
- **P0** (bloqueante): Mi Pixel.
- **P1** (importante): Analytics completo, Agenda, Onboarding.
- **P2** (paridad): Líneas pausar/redirigir, Landings HTML libre, Tutoriales, Kommo.
- **Hardening**: reintentos CAPI, .env, backups, validación Meta.
