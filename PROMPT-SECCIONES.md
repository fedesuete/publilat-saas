# PROMPT 2 — Completar el panel con todas las secciones de ScaleOS

Pegá este bloque en Claude Code. Construye las secciones que faltan para que el
panel tenga la misma estructura que ScaleOS (analizado en `ScaleOS_Analisis.docx`).

---

```
Seguimos con Publi.lat. La Fase 1 (loop de atribución) ya funciona: tengo Leads,
Inbox, WhatsApp y Links. Ahora quiero que el panel tenga las MISMAS secciones que
ScaleOS, reutilizando el schema de Prisma que ya existe (User, Pixel, WaLine, Credit,
CreditLedger, Contact con stages, Message, Landing, MetaEvent). No rehagas el backend
que ya anda; construí sobre lo que está.

Quiero estas 10 secciones en el menú lateral, en este orden. Detallo qué hace cada una:

1. ANALYTICS (dashboard principal, ruta /analytics o home del panel)
   - Tarjetas de métricas en 3 bloques:
     · Tráfico: clics hoy / semana / mes, líneas activas.
     · Conversación: chats reales hoy / semana / mes, ratio Click→Chat (%).
     · Ventas: ventas hoy / semana / mes (con % de conversión), conversión del mes.
   - Gráfico de líneas "Leads últimos 30 días".
   - Contador de "tokens/días disponibles" arriba a la derecha.
   - Endpoint nuevo: GET /api/analytics que calcule todo esto desde la DB.

2. INBOX WA (ya existe; dejarlo en el menú)
   - Lista de conversaciones con no leídos, contacto, línea (via +número), fecha y
     preview. Responder desde el panel.

3. CRM (pipeline kanban, ruta /crm)
   - Convertir la lista de Leads en un tablero con columnas por etapa:
     NUEVO, CONTACTADO, INTERESADO, COMPRO, PERDIDO (el enum Stage ya existe).
   - Cada tarjeta: nombre, fuente (fb/ig/an), fecha, código. En COMPRO mostrar el monto.
   - Permitir mover tarjetas entre columnas (drag & drop o botones) -> PATCH stage.

4. LÍNEAS (ruta /lineas)
   - Gestión de líneas de WhatsApp (modelo WaLine). Mostrar número, estado
     (activo/inactivo/pausado), vencimiento. Acciones: Activar, Pausar, Extender,
     Redirigir, Agregar. Conexión por QR (ya está el flujo de WhatsApp).
   - Texto guía: "1 día disponible = 1 línea activa por 1 día".

5. DÍAS DISPONIBLES / TOKENS (ruta /tokens)
   - Mostrar saldo de días (modelo Credit). Botones: Historial (CreditLedger) y
     Agregar días. Explicar la mecánica (1 día = 1 línea activa 24h, distribuibles).
   - Por ahora "Agregar días" puede ser un alta manual (la pasarela de pago va después).

6. AGENDA (ruta /agenda)
   - Libreta de todos los contactos (modelo Contact). Buscador por nombre/teléfono.
     Filtros: Todos / Conversiones / Leads. Agrupar por fecha.
   - Al expandir un contacto, mostrar su ficha de atribución completa:
     teléfono, línea WA, pixel, fuente, campaña, página/landing, ID único (externalId).

7. MI LANDING (ruta /landing)
   - Editor/host de landings (modelo Landing). Listar landings del usuario, marcar
     una como principal, editar el HTML con vista previa en tiempo real, subir .html,
     publicar. Generar el "link rastreado para campañas" (apuntando a /go o /l/:slug).
   - Hosting real en S3/CloudFront lo dejamos para después; por ahora guardar el HTML
     en la DB y servirlo desde /l/:slug.

8. MI PIXEL (ruta /pixel)
   - Configurar Pixels de Meta (modelo Pixel). Una entrada por evento (Lead / Purchase),
     con: pixelId, capiToken, siteUrl. Agregar, editar, eliminar.
   - Texto de ayuda de dónde sacar cada dato (Pixel ID, token CAPI, URL del sitio).

9. CONFIGURACIÓN (ruta /configuracion)
   - Selector de modo de conexión: ScaleOS Nativo / Kommo (webhook) / CRM Externo (webhook).
   - Checklist de onboarding de 3 pasos (Pixel configurado, Landing publicada, WhatsApp
     conectado) que se marque solo según el estado real de la cuenta.

10. TUTORIALES (ruta /tutoriales)
    - Centro de ayuda con guías por sección (puede ser contenido estático por ahora).

Requisitos:
- Mantené el diseño actual (sidebar oscuro, acento violeta, estilo Publi.lat).
- TypeScript estricto, validá input con zod en los endpoints nuevos.
- Cada sección protegida por auth (multi-tenant: cada usuario ve solo lo suyo).
- No toques el loop de atribución que ya funciona.
- Creá datos de ejemplo (seed) para poder ver las pantallas con contenido.

Mostrame primero un plan con: rutas frontend nuevas, endpoints backend nuevos y en
qué orden lo vas a hacer. Empezá por ANALYTICS y CRM, que son las más visibles.
```

---

## Orden sugerido si preferís ir por partes

Si no querés que haga todo de una, pedíselo en este orden (cada uno es un mensaje):

1. Analytics + CRM kanban
2. Agenda + Mi Pixel
3. Líneas + Días disponibles
4. Mi Landing + Configuración + Tutoriales
