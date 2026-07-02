# Prompts para robustecer Publi.lat

Pasáselos a Claude Code **de a uno, en orden**. Cada bloque es autocontenido. Después de cada uno:
typecheck backend + build frontend, y probá antes de pasar al siguiente. Stack: Express + TS +
Prisma + PostgreSQL + Socket.IO + BullMQ/Redis + React + Vite + Tailwind.

---

## FASE 1 — Crítico (cobrar + no perder ventas)

### 1.1 Pasarela de pago real (sacar el stub)
```
En la página de Créditos (/billing) del frontend hay un "Stub de compra — la pasarela real llega
en F5". El backend ya tiene los gateways (MercadoPago, USDT/NOWPayments, Stripe) con sus webhooks.
Conectá el botón "Comprar días" al flujo real:
- Al elegir cantidad de días + medio de pago, llamá al endpoint de checkout del backend del gateway
  elegido y redirigí/abrí el flujo de pago real (link de MercadoPago, dirección USDT, checkout de Stripe).
- Mostrá el estado del pago (pendiente/confirmado) y, cuando el webhook confirma, acreditá los días
  y refrescá "Días disponibles" y "Movimientos".
- Sacá el texto del stub. Manejá errores (gateway sin configurar -> mensaje claro).
Probá el flujo end-to-end con al menos un gateway en modo test.
```

### 1.2 Idempotencia + reintentos en CAPI y webhooks
```
Robustecé el envío de eventos a Meta (CAPI) y el procesamiento de webhooks entrantes:
1) IDEMPOTENCIA webhooks: en routes/wa-cloud.ts y webhook.ts, antes de crear un Message verificá
   que no exista otro con el mismo waMessageId (agregá índice único). No proceses dos veces el
   mismo evento. Ignorá campos de webhook que no sean "messages" (statuses/echoes).
2) REINTENTOS CAPI: los envíos de Lead/Purchase por Conversions API deben ir por una cola (ya usás
   BullMQ) con reintentos exponenciales (ej. 5 intentos) y una "dead-letter": si tras N intentos
   falla, guardá el evento como "failed" con el error para reprocesar manualmente. Nunca perder una
   conversión por un fallo transitorio de red/Meta.
3) Un endpoint admin para reintentar eventos "failed".
typecheck backend.
```

### 1.3 Seguridad — los 2 críticos (ver AUDITORIA-SEGURIDAD.md)
```
Aplicá los 2 hallazgos críticos de la auditoría:
C1) Validá la firma X-Hub-Signature-256 (HMAC-SHA256 con META_APP_SECRET sobre el raw body) en el
    webhook de WhatsApp Cloud antes de procesar. Montá express.raw para ese path (como Stripe).
    Rechazá (401) si la firma no coincide.
C2) Bloqueá SSRF en el webhook saliente de Integraciones: antes de hacer la request, resolvé el
    host y rechazá IPs privadas/loopback/link-local/metadata (169.254/16, 127/8, 10/8, 172.16/12,
    192.168/16, ::1). Exigí https y no sigas redirects.
typecheck backend.
```

---

## FASE 2 — Confiabilidad operativa

### 2.1 Alertas de salud de línea
```
Agregá monitoreo de salud de las líneas de WhatsApp:
- Un job periódico (BullMQ repeatable) que chequee cada línea: conexión, y para Cloud API el estado
  y la calificación de calidad (GET /{phoneNumberId} y /{wabaId}). Guardá el estado en la waLine.
- Si una línea se desconecta, baja de calidad (RED/YELLOW) o se acerca al límite de mensajería,
  emití una alerta: notificación in-app (Socket.IO) + email al dueño de la línea.
- Mostrá un badge de estado/calidad en la tarjeta de la línea en WhatsappPage.
typecheck backend + build frontend.
```

### 2.2 Notificaciones (nuevo lead / venta / línea caída)
```
Sistema de notificaciones para el usuario:
- Modelo Notification (userId, type, title, body, read, createdAt).
- Generá notificaciones en: nuevo lead, nueva compra/Purchase, línea desconectada.
- Campana en el header del panel con contador de no leídas + listado (marcar leído).
- (Opcional) envío por email con un proveedor SMTP configurable por env.
- Emití en tiempo real por Socket.IO.
typecheck backend + build frontend.
```

---

## FASE 3 — Valor de producto (venta y retención)

### 3.1 Bot de IA / auto-respuesta 24/7
```
Agregá un auto-responder con IA por línea (opt-in en Configuración):
- Cuando entra el PRIMER mensaje de un contacto (o fuera de horario), respondé automáticamente con
  un mensaje configurable o generado por IA (reusá la integración de IA que ya existe para detección
  de pago: Anthropic/OpenAI). Objetivo: saludar, calificar el interés y pedir datos.
- Configurable por usuario: on/off, horario, mensaje base / prompt del bot.
- Registrá la respuesta como mensaje saliente en el Inbox. Respetá la ventana de 24h de WhatsApp
  (si está fuera, usar plantilla — ver 3.2).
typecheck backend + build frontend.
```

### 3.2 Plantillas de mensajes de WhatsApp (Cloud API)
```
Soporte de plantillas de WhatsApp (message templates) para la Cloud API:
- Backend: endpoints para listar plantillas aprobadas de la WABA (GET /{wabaId}/message_templates)
  y para ENVIAR un mensaje de plantilla (POST /{phoneNumberId}/messages type=template).
- Frontend (Inbox): si la conversación está fuera de la ventana de 24h, deshabilitá el texto libre
  y mostrá un selector de plantillas aprobadas para reabrir la conversación.
- Manejá variables de la plantilla.
typecheck backend + build frontend.
```

### 3.3 Gasto de Meta Ads automático (ROAS real)
```
Integrá el gasto de Meta Ads para calcular ROAS real sin carga manual:
- Permití al usuario conectar su cuenta publicitaria (ad account) vía el mismo login de Meta.
- Un job diario trae el gasto por campaña/conjunto/anuncio (Marketing API, insights).
- En el Dashboard, calculá ROAS real = facturación atribuida / gasto, por campaña/conjunto/anuncio.
- Manejá permisos/tokens de forma segura (cifrados).
typecheck backend + build frontend.
```

---

## FASE 4 — Escala

### 4.1 Multiusuario / roles por cuenta
```
Permití varios usuarios (agentes) dentro de una misma cuenta de cliente:
- Modelo: una Organización/Cuenta con varios Users; roles OWNER | AGENT.
- El OWNER invita agentes por email; los agentes acceden al Inbox y CRM pero no a facturación ni
  configuración sensible.
- Aislá los datos por cuenta (no romper el multi-tenant actual).
- Asignación de conversaciones a un agente.
typecheck backend + build frontend.
```

### 4.2 Facturación recurrente + facturas
```
Además de "días sueltos", agregá suscripción recurrente:
- Planes mensuales (ej. X líneas / Y días incluidos) con cobro recurrente por el gateway.
- Estado de suscripción (activa/vencida) y renovación automática.
- Generá comprobantes/facturas descargables (PDF) por cada cobro.
- Panel de facturación con historial.
typecheck backend + build frontend.
```

### 4.3 Wizard de onboarding guiado
```
Mejorá el onboarding del cliente nuevo:
- Un wizard paso a paso al primer login: (1) conectar WhatsApp, (2) cargar Pixel + token CAPI,
  (3) crear el primer link/landing, (4) cargar días. Con barra de progreso y estados vacíos que
  expliquen qué hacer y por qué.
- Dentro del paso de WhatsApp, guía clara sobre método de pago en la WABA + registro del número
  (la fricción real del onboarding).
- Tooltips/tour la primera vez en Inbox y Dashboard.
typecheck backend + build frontend.
```

---

## Orden recomendado
1.1 → 1.2 → 1.3 (Fase 1 completa) → 2.1 → 2.2 → 3.1 → 3.2 → 3.3 → 4.x según prioridad comercial.

> Regla: un prompt por vez, probar, commitear, siguiente. No los mezcles.
