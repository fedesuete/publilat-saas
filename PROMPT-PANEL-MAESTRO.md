# Prompt para Claude Code — Panel Maestro (Super-Admin / Dueño)

Pegá el bloque de abajo en Claude Code. Construye un **panel de administración global** por encima
de todas las cuentas, accesible SOLO por el dueño (fede). Respetá el stack actual
(Express + TS + Prisma + PostgreSQL + Socket.IO + React + Vite + Tailwind) y el estilo dark/verde
WhatsApp del panel existente. No rompas nada de lo que ya funciona.

---

```
Construí un PANEL MAESTRO (super-admin) para el dueño de Publi.lat. Es una vista global por
encima de todas las cuentas/clientes (multi-tenant), separada del panel normal de cada usuario.

========================================
1) ROL Y ACCESO (seguridad primero)
========================================
- Agregá al modelo User un campo `role` enum: USER | ADMIN (default USER). Migración Prisma.
- Marcá mi usuario (federicobogado1997@gmail.com) como ADMIN con un seed/script.
- Creá un middleware `requireAdmin` (además de requireAuth) que verifique role === "ADMIN".
  Todas las rutas /api/admin/* deben pasar por requireAuth + requireAdmin. Si no es admin -> 403.
- En el frontend, mostrá el item de menú "Admin" y las rutas /admin SOLO si el usuario es ADMIN.
  Si un no-admin entra a /admin por URL, redirigí al dashboard.
- Nunca expongas tokens/credenciales sensibles (CAPI token, app secret) en las respuestas del admin.

========================================
2) RUTAS BACKEND  /api/admin/*  (todas admin-only)
========================================
- GET  /api/admin/overview      -> KPIs globales (ver sección 4A).
- GET  /api/admin/clients       -> lista de todas las cuentas con métricas (paginada + búsqueda).
- GET  /api/admin/clients/:id   -> detalle de una cuenta (líneas, días, pagos, leads, ventas).
- POST /api/admin/clients/:id/credits   -> sumar/restar días a una cuenta { days:number, note }.
- POST /api/admin/clients/:id/demo      -> activar demo de N días (default 5) { days?:number }.
- POST /api/admin/clients/:id/suspend   -> suspender/reactivar la cuenta { suspended:boolean }.
- GET  /api/admin/lines         -> TODAS las líneas de WhatsApp de todos los clientes.
- GET  /api/admin/revenue       -> ingresos por periodo/gateway/cliente (ver 4D).
- GET  /api/admin/payments      -> pagos recientes (todos los clientes) con estado.
- GET  /api/admin/support       -> bandeja de soporte (conversaciones cliente <-> dueño).
- POST /api/admin/support/:userId/reply -> responder a un cliente { body }.
- GET  /api/admin/export/:type  -> CSV de clients | revenue | leads (descarga).
Registrá el router en index.ts DESPUÉS de las rutas existentes, antes del 404 de /api.

========================================
3) MODELO DE DATOS (Prisma) — agregados nuevos
========================================
- User.role (USER|ADMIN), User.suspended (boolean default false).
- Demo: agregá a User -> isDemo (boolean), demoExpiresAt (DateTime?), source (cómo llegó).
  Reutilizá la lógica de "días disponibles" que ya existe para créditos; la demo es días gratis
  con vencimiento. Si ya hay un modelo de créditos/días, sumale un flag de origen "demo".
- SupportMessage: id, userId (cliente), fromAdmin (boolean), body, mediaUrl?, readAt?, createdAt.
  (Hilo de soporte 1-a-1 entre cada cliente y el dueño.)
- AdminLog: id, adminId, action, targetUserId?, meta(json), createdAt -> auditoría de todo lo que
  hace el admin (dar días, activar demo, suspender, responder soporte). Para "guardar datos".

========================================
4) PÁGINAS FRONTEND  /admin  (estilo dark/verde, responsive)
========================================
Menú lateral del admin (visible solo para ADMIN): Resumen, Clientes, Líneas, Ingresos, Demos,
Soporte, Exportar.

4A) RESUMEN (overview) — "ser el jefe de un vistazo":
   Tarjetas KPI globales:
   - Clientes totales / activos / en demo / suspendidos.
   - Líneas activas globales (en rotación ahora) y total de líneas.
   - MRR aprox / ingresos del mes / ingresos totales (sumando todos los gateways).
   - Días vendidos vs días consumidos.
   - Leads totales generados en la plataforma, compras totales, facturación atribuida (suma de
     todos los clientes), eventos CAPI enviados / fallidos (salud).
   Gráficos: ingresos por mes (últimos 6), nuevos clientes por semana, demos -> conversión a pago.

4B) CLIENTES (tabla maestra):
   Columnas: negocio, email, plan/estado (activo/demo/vencido/suspendido), días disponibles,
   líneas (conectadas/total), leads, compras, facturación generada, último acceso, fecha de alta.
   - Buscador + filtros (estado, en demo, sin días).
   - Click en una fila -> panel de detalle del cliente con:
       * sus líneas (número, proveedor Baileys/Cloud, estado, vencimiento),
       * sus pagos, sus leads/ventas, su facturación,
       * acciones: [+ días] [- días] [Activar demo 5 días] [Suspender/Reactivar].
   Cada acción registra un AdminLog y se refleja al instante (Socket.IO o refetch).

4C) LÍNEAS (global): tabla de TODAS las líneas WhatsApp de todos los clientes: dueño, etiqueta,
   número, proveedor, estado de conexión (verde/rojo), vencimiento, último uso. Filtro por estado.

4D) INGRESOS: 
   - Ingresos por periodo (hoy / 7d / 30d / total) y por gateway (MercadoPago, USDT/TRC20,
     Stripe, USDT-NOWPayments) — sumando lo que ya registra billing.
   - Tabla de pagos recientes: cliente, monto, moneda, gateway, estado (pagado/pendiente/fallido),
     fecha. Top clientes por facturación.

4E) DEMOS — "a quién le damos una demo de 5 días":
   - Botón "Dar demo": buscás un usuario existente (o creás uno con email) y le activás 5 días
     gratis con vencimiento (demoExpiresAt = ahora + 5 días). Default 5, editable.
   - Lista de demos activas: cliente, días restantes (cuenta regresiva), si ya conectó línea,
     si generó leads, y si convirtió a pago (badge "Convirtió" / "En demo" / "Demo vencida").
   - Aviso visual de demos que vencen en <24h.

4F) SOPORTE — chat general dueño <-> clientes:
   - Bandeja tipo Inbox: lista de clientes que escribieron, con último mensaje y no leídos.
   - Al abrir un cliente, ves el hilo y respondés en tiempo real (Socket.IO, reusá la infra del
     Inbox existente: salas por user:{id}). El cliente ve y responde desde un widget de "Soporte"
     en su propio panel (agregá ese widget simple en el panel del usuario normal).
   - Marcá leído/no leído. Todo queda guardado en SupportMessage.

4G) EXPORTAR: botones para bajar CSV de Clientes, Ingresos y Leads (para "guardar datos").

========================================
5) DETALLES TÉCNICOS / CALIDAD
========================================
- Reutilizá lo existente: el cálculo de "días/líneas activas", el modelo de pagos de billing, el
  Socket.IO del Inbox, y los componentes de tabla/tarjeta del panel. No dupliques estilos.
- Performance: las consultas globales deben usar agregaciones de Prisma (groupBy/count/sum), no
  traer todo a memoria. Paginá la tabla de clientes.
- Todo admin-only y auditado (AdminLog). El admin NO ve el contenido de mensajes privados de los
  clientes salvo el hilo de SOPORTE (no espíes los Inbox de WhatsApp de cada cliente desde el admin).
- Agregá el item "Admin" al menú lateral, visible solo si role === ADMIN.
- Hacé la migración Prisma, el seed para marcarme ADMIN, typecheck y que compile el frontend.
- Si algo ya existe parcialmente (ej. créditos/días), integralo en vez de recrearlo.

Entregá: migración + seed admin, rutas /api/admin/*, middleware requireAdmin, páginas /admin
(Resumen, Clientes, Líneas, Ingresos, Demos, Soporte, Exportar), widget de Soporte en el panel
del usuario, y AdminLog funcionando. Probá que un usuario normal no pueda entrar a /admin ni a
/api/admin/* (403). Dejá todo compilando.
```

---

## Notas para fede (no van en el prompt)

- **Lo más potente para "ser el jefe":** la pestaña **Clientes** (dar/quitar días, activar demo,
  suspender) + **Resumen** (plata e indicadores de un vistazo) + **Demos** (a quién le diste 5 días
  y quién convirtió).
- **Soporte:** queda un chat dueño↔cliente dentro de la plataforma, separado del WhatsApp de cada
  cliente. Para soporte por WhatsApp real, después podés sumar un número tuyo aparte.
- **Seguridad:** el panel es admin-only y todo lo que tocás queda registrado (AdminLog). Importante
  para no romper la confianza de los clientes (no espía sus chats de WhatsApp).
- Cuando Claude Code termine, avisame y lo recorremos juntos para ver que esté todo y sin filtraciones.
```
