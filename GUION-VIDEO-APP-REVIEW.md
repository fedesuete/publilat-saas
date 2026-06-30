# Guion del video demo — App Review de WhatsApp (Publi)

Objetivo del video: mostrarle a Meta que Publi es una plataforma real de CRM + atribución y que
el flujo de **conectar WhatsApp (Embedded Signup)** funciona, además del envío/recepción de
mensajes. Con esto aprueban el acceso avanzado a `whatsapp_business_management` y
`whatsapp_business_messaging`.

Duración ideal: **1:30 a 3:00 min**. Sin cortes raros. Pantalla limpia. **Nada de casino/apuestas**
visible (ni pestañas, ni landings, ni texto).

---

## ANTES DE GRABAR (preparación)

1. **Usuario de prueba en Publi:** creá la cuenta con un mail tuyo + clave genérica. Anotá email y
   clave (los vas a poner en el formulario del App Review para el revisor).
2. **Número de prueba de Meta:** en la app → WhatsApp → **Paso 1. Probar** → "Solicitar número de
   prueba". Agregá tu propio celular como destinatario permitido (para mandar/recibir un mensaje).
3. **Navegador limpio:** cerrá todas las pestañas que digan "juega", casino, Stripe de ScaleOS, etc.
   Dejá solo Publi. Que no se vea nada comprometedor en la barra de marcadores tampoco.
4. **Grabadora de pantalla:** Windows tiene `Win + G` (Xbox Game Bar) → botón de grabar. O usá
   cualquiera (OBS, Loom). Grabá en horizontal, pantalla completa.
5. **Cuenta de Facebook:** asegurate de estar logueado en Chrome con tu cuenta admin del portafolio
   (para que el popup del Embedded Signup abra bien).

---

## GUION ESCENA POR ESCENA (qué mostrar + qué decir)

> La narración es opcional: podés hablar en español, o grabar sin voz mostrando las acciones
> claramente. Si hablás, leé estas líneas tranquilo. Si no hablás, hacé cada acción **despacio**
> para que se entienda.

### Escena 1 — Login (0:00–0:15)
- **Mostrar:** la URL `https://app.publi.lat`, ingresás con el usuario de prueba (email + clave).
- **Decir:** "Esta es Publi, una plataforma de atribución de marketing y CRM para WhatsApp. Inicio
  sesión con una cuenta de negocio."

### Escena 2 — El panel (0:15–0:35)
- **Mostrar:** el Dashboard con métricas, y pasá el mouse por el menú (Inbox, CRM/Kanban, WhatsApp,
  Mi Pixel). Que se vea que es un producto real.
- **Decir:** "Desde el panel, cada negocio ve sus métricas, gestiona sus contactos en un CRM y
  responde sus chats de WhatsApp. Para eso, primero conecta su cuenta de WhatsApp Business."

### Escena 3 — Conectar WhatsApp / Embedded Signup (0:35–1:30)  ← LA MÁS IMPORTANTE
- **Mostrar:** entrás a la sección **WhatsApp** → tocás **"Conectar WhatsApp"** (la opción de API
  oficial / Cloud API). Se abre el **popup de Meta (Embedded Signup)**. Mostrá TODO el popup:
  selección de **portafolio**, **cuenta de WhatsApp Business**, paso de **número de teléfono** y la
  pantalla de **permisos**. Avanzá hasta donde puedas.
- **Decir:** "Al tocar 'Conectar WhatsApp' se abre el registro integrado de Meta. El negocio
  selecciona su portafolio y su cuenta de WhatsApp Business, agrega su número y autoriza los
  permisos. Publi nunca pide tokens manuales: todo pasa por el flujo oficial de Meta."

### Escena 4 — Línea conectada (1:30–1:45)
- **Mostrar:** volvés al panel y se ve la **línea conectada / activa**.
- **Decir:** "Una vez autorizado, la línea queda conectada en el panel, lista para enviar y recibir
  mensajes."

### Escena 5 — Mensajería real (1:45–2:20)  ← demuestra whatsapp_business_messaging
- **Mostrar:** con el **número de prueba de Meta**, mandás un mensaje a tu celular y mostrás la
  conversación en el **Inbox** de Publi (mensaje entrante + respuesta saliente).
- **Decir:** "Desde la bandeja de entrada, el negocio responde a sus clientes. Cada mensaje entrante
  y saliente se gestiona acá, en nombre del negocio."

### Escena 6 — CRM / cierre (2:20–2:40)
- **Mostrar:** abrís el **Kanban/CRM** y mostrás el contacto registrado como lead, moviéndolo de
  etapa (Nuevo → Contactado).
- **Decir:** "Cada conversación queda registrada como contacto en el CRM, para hacer seguimiento de
  la venta. Eso es Publi: conectar WhatsApp, conversar y atribuir resultados. Gracias."

---

## QUÉ NO HACER (te rechazan)
- ❌ Que se vea la palabra casino/apuestas/juega en cualquier lado (pestañas, landings, texto).
- ❌ Saltarte el popup del Embedded Signup: es lo que Meta MÁS quiere ver.
- ❌ Mostrar tokens, claves o el App Secret en pantalla.
- ❌ Video acelerado o con cortes que oculten pasos.

## CHECKLIST ANTES DE SUBIRLO
- [ ] Se ve el login en app.publi.lat.
- [ ] Se ve el popup de Embedded Signup completo (portafolio → WABA → número → permisos).
- [ ] Se ve la línea conectada en el panel.
- [ ] Se ve un mensaje entrante y una respuesta en el Inbox.
- [ ] No aparece NADA de casino en ningún momento.
- [ ] Dura entre 1:30 y 3:00 min.

---

## Datos para pegar en el formulario del App Review (junto al video)
- **Textos de justificación de cada permiso:** están en `GUIA-LANZAMIENTO-APP-REVIEW.md` (Parte 2).
- **Credenciales de prueba para el revisor:**
  - Usuario: (el email del usuario de prueba que creaste)
  - Contraseña: (la clave genérica)
- **Instrucciones de prueba:** también en `GUIA-LANZAMIENTO-APP-REVIEW.md` (Parte 2).
