# Guía de lanzamiento — Publicar la app + App Review (Publi)

Objetivo: dejar la app de Meta **publicada (Live)** y con **acceso avanzado** aprobado, para que
**clientes reales** conecten su propio WhatsApp con el botón "Conectar WhatsApp" (Embedded Signup).

Datos de la app:
- **App ID:** 989588980745069
- **config_id (Embedded Signup):** 947679894960950
- **Webhook:** https://app.publi.lat/api/wa/cloud/webhook (verificado, suscrito a `messages`)
- **Portafolio dueño de la app:** RC Publicidad

> Regla de oro: todo en tono **neutro** ("plataforma de atribución y CRM para WhatsApp").
> Nunca menciones "casino", "apuestas" ni "gambling" en la app, el video ni los textos.
> El contenido de cada cliente es responsabilidad del cliente (así lo dicen tus Términos).

---

## PARTE 1 — Checklist previo (sin esto, te rechazan)

Antes de enviar el App Review, en **developers.facebook.com → app Publi**:

**A) Configuración → Información básica:**
- [ ] **Icono** de la app cargado (1024×1024).
- [ ] **Categoría:** "Empresas y páginas" (o similar).
- [ ] **Email de contacto** válido.
- [ ] **URL de Política de Privacidad:** `https://publi.lat/privacidad`
- [ ] **URL de Condiciones del Servicio:** `https://publi.lat/terminos`
- [ ] **URL de eliminación de datos:** `https://publi.lat/eliminacion-datos`
- [ ] **Dominio de la app:** `publi.lat` y `app.publi.lat`

**B) Business Verification (RC Publicidad):**
- [ ] El portafolio **RC Publicidad** tiene que estar **Verificado** (Centro de seguridad /
  Configuración del negocio → Seguridad → Verificación del negocio). Sin esto, el acceso
  avanzado a WhatsApp no se aprueba.

**C) Tech Provider:**
- [ ] Registrado como **Proveedor de tecnología** (lo hiciste en "Hacerte proveedor de tecnología").

**D) Login y dominios (ya están, confirmá):**
- [ ] "Iniciar sesión con el SDK de JavaScript" = **Sí**
- [ ] Dominios del SDK: `https://app.publi.lat`
- [ ] OAuth redirect URIs: `https://publi.lat/` y `https://app.publi.lat/`

---

## PARTE 2 — Textos para copiar/pegar en el App Review

En **Revisión de la app → Permisos y funciones**, pedí **Acceso avanzado (Advanced Access)** a:
`whatsapp_business_management` y `whatsapp_business_messaging`.
(Si lo pide, también `business_management`.)

Para cada permiso, Meta te pide explicar **cómo lo usás** y **cómo probarlo**. Pegá esto:

### whatsapp_business_messaging — "Cómo usa tu app este permiso"

```
Publi es una plataforma SaaS de atribución de marketing y CRM para WhatsApp. Nuestros
usuarios son negocios que conectan su propia cuenta de WhatsApp Business a través del
Embedded Signup. Usamos whatsapp_business_messaging para, en nombre del negocio y con su
autorización, enviar y recibir mensajes de WhatsApp dentro de su bandeja de entrada (Inbox)
en Publi, responder a sus clientes y registrar las conversaciones en su CRM. También recibimos
los mensajes entrantes vía webhook para identificar leads provenientes de anuncios
Click-to-WhatsApp y atribuir las conversiones a las campañas de Meta del negocio mediante la
Conversions API. El número de WhatsApp y los datos pertenecen al negocio; Publi sólo los
procesa en su nombre.
```

### whatsapp_business_management — "Cómo usa tu app este permiso"

```
Usamos whatsapp_business_management para que cada negocio administre su propia cuenta de
WhatsApp Business (WABA) desde Publi tras conectarla con el Embedded Signup: registrar y
verificar su número, leer el estado y los límites de mensajería de su línea, suscribir el
webhook de su WABA para recibir mensajes, y mostrar el estado de la conexión en el panel.
No accedemos a cuentas que el usuario no haya conectado explícitamente a través del flujo de
Embedded Signup. Publi actúa como Proveedor de Tecnología (Tech Provider): cada cliente
conecta y es dueño de su propia WABA.
```

### Instrucciones de prueba para el revisor (pegar en "Instrucciones")

```
1. Ingresar al panel en https://app.publi.lat con las credenciales de prueba provistas.
2. Ir a la sección "WhatsApp" en el menú lateral.
3. Tocar el botón "Conectar WhatsApp". Se abre el popup de Embedded Signup de Meta.
4. Seleccionar un portafolio empresarial y una cuenta de WhatsApp Business, agregar y
   verificar un número de teléfono.
5. Al finalizar, la línea aparece como "conectada" en el panel y se puede enviar/recibir
   mensajes desde la bandeja de entrada (Inbox).

Credenciales de prueba:
- Usuario: [crear un usuario de prueba en Publi y poner el email aquí]
- Contraseña: [poner la contraseña aquí]
```

> Antes de enviar, creá un **usuario de prueba** real en Publi y completá las credenciales.
> El revisor las usa para reproducir el flujo.

---

## PARTE 3 — Guion del video demo (lo grabás vos)

Meta exige un **screencast** (grabación de pantalla) mostrando el flujo completo. Tip: grabá
con el celular o con la grabadora de pantalla de Windows (Win+G). Duración: 1–3 minutos.
Mostrá TODO sin cortes y SIN contenido de casino visible.

**Escenas, en orden:**

1. **(0:00) Login.** Mostrá la URL `https://app.publi.lat`, ingresá con el usuario de prueba.
2. **(0:15) Panel.** Mostrá brevemente el menú (Inbox, CRM/Kanban, WhatsApp, Mi Pixel) para
   que se vea que es una plataforma de CRM/atribución real.
3. **(0:30) Conectar WhatsApp.** Entrá a la sección "WhatsApp" y tocá "Conectar WhatsApp".
4. **(0:40) Embedded Signup.** Mostrá el popup de Meta: selección de portafolio → cuenta de
   WhatsApp Business → agregar número → verificación por SMS → aceptar permisos.
5. **(1:30) Resultado.** Volvé al panel y mostrá la línea ya **"conectada / activa"**.
6. **(1:45) Uso real.** Abrí el **Inbox**, mostrá un mensaje entrante y respondé desde Publi
   (esto demuestra el uso de `whatsapp_business_messaging`).
7. **(2:10) Cierre.** Mostrá en el CRM/Kanban que el contacto quedó registrado como lead.

**Qué NO mostrar:** nada que diga casino/apuestas, ni números/datos personales reales sensibles.

---

## PARTE 4 — Publicar la app y enviar la revisión

**Paso 1 — Completar el formulario de cada permiso** (Parte 2) y **subir el video** (Parte 3).

**Paso 2 — Agregar a la revisión.** En "Permisos y funciones", al lado de cada permiso tocá
**"Añadir a la revisión"**. Te van a quedar los dos permisos en la lista de la solicitud.

**Paso 3 — Enviar la solicitud.** Revisá que estén los textos, el video y las credenciales de
prueba, y tocá **Enviar**. Meta suele responder en **2 a 7 días**.

**Paso 4 — Publicar la app (Live).** En el menú izquierdo, **"Publicar"** (hoy dice "Sin
publicar") → pasá el toggle a **Live/Activa**. Necesita la política de privacidad cargada
(ya está). Podés publicar antes o después de que aprueben; el acceso avanzado recién funciona
para clientes reales cuando la revisión está **aprobada Y** la app está **Live**.

---

## PARTE 5 — Después de la aprobación

- Cada cliente entra a Publi, toca "Conectar WhatsApp" y conecta SU número. Ya no quedan
  limitados a tu cuenta de admin.
- Recordá los **límites de mensajería** de WhatsApp por portafolio (250/24h sin verificar el
  número del cliente → 1.000+ cuando Meta lo escala según calidad/volumen).
- Si Meta rechaza: leé el motivo, ajustá el texto o el video (casi siempre es que el video no
  muestra el flujo completo o falta una URL legal) y reenviá. No penaliza reintentar.

---

## Resumen de qué hace cada quién

| Tarea | Quién |
|---|---|
| Completar settings + URLs legales | Vos (te guío) |
| Verificar RC Publicidad | Vos (en Meta) |
| Textos de justificación | ✅ Listos en esta guía |
| Grabar el video demo | Vos (con el guion de la Parte 3) |
| Crear usuario de prueba en Publi | Vos |
| Enviar revisión + publicar | Vos (te guío en cada clic) |
