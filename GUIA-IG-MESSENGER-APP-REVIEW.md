# Guía: habilitar Instagram + Messenger en Publi.lat (App Review de Meta)

> Objetivo: que las Automatizaciones (secuencias) funcionen también en **Instagram DM** y
> **Facebook Messenger**, como ManyChat. Esto NO es código: son permisos que Meta otorga
> tras un App Review. La app ya existe (la misma del Embedded Signup de WhatsApp).

## Qué se pide y por qué

| Permiso | Para qué |
|---|---|
| `pages_show_list` | Listar las páginas de Facebook del cliente para elegir cuál conectar |
| `pages_manage_metadata` | Suscribir la app al webhook de la página (recibir mensajes) |
| `pages_messaging` | **Enviar/recibir mensajes de Messenger** |
| `instagram_basic` | Ver la cuenta de Instagram vinculada a la página |
| `instagram_manage_messages` | **Enviar/recibir DMs de Instagram** |

Requisitos previos (ya cumplidos por el flujo de WhatsApp):
- ✅ Business Verification aprobada.
- ✅ App en modo Live, con Privacy Policy y Data Deletion URL (publi.lat/privacidad y /eliminacion-datos).

## Paso a paso

### 1) Agregar los productos a la app
En https://developers.facebook.com → tu app (la del Embedded Signup):
1. **Add Product → Messenger** → Set up.
2. **Add Product → Instagram** (Instagram API / mensajería) → Set up.

### 2) Configurar el webhook (mismo endpoint que ya usamos)
En Messenger → Settings → Webhooks:
- **Callback URL:** `https://app.publi.lat/api/wa/cloud/webhook` (o creamos `/api/meta/webhook` dedicado cuando lo activemos — avisar a Claude Code para montarlo).
- **Verify token:** el mismo `WHATSAPP_WEBHOOK_VERIFY_TOKEN` del .env.
- **Campos (Messenger):** `messages`, `messaging_postbacks`, `messaging_optins`.
- **Campos (Instagram):** `messages`, `messaging_postbacks`.

### 3) Probar en modo desarrollo (antes del review)
- Con una página de Facebook TUYA (rol admin/tester en la app) ya podés enviar/recibir
  sin review. Conectá la página, mandate un DM y verificá que llegue el webhook.
- Esto además sirve para grabar el screencast del review.

### 4) Preparar el App Review
Para CADA permiso pedido, Meta exige:
1. **Descripción de uso** (plantilla, adaptar):
   > "Publi.lat es una plataforma de atribución y CRM. El usuario conecta su página de
   > Facebook/cuenta de Instagram para centralizar los mensajes de sus clientes en un
   > inbox unificado y responder con secuencias automáticas de bienvenida. Usamos
   > `pages_messaging` / `instagram_manage_messages` exclusivamente para enviar y recibir
   > mensajes en nombre del usuario dentro de la ventana de 24 h de la plataforma."
2. **Screencast** (video de pantalla, sin editar, con la app real):
   - Login en app.publi.lat → sección de conexión de página/IG → popup de Facebook Login
     mostrando los permisos → volver al panel → recibir un DM en el Inbox → responderlo.
3. **Cuenta de prueba**: usuario y contraseña de un login demo de app.publi.lat para el
   revisor (crear uno con datos de prueba).

### 5) Enviar y esperar
- App Review → Permissions and Features → pedir los 5 permisos → Submit.
- Tarda entre 2 días y 2 semanas. Si rechazan, leen el motivo, se corrige el screencast
  o el texto y se reenvía (es normal 1-2 idas y vueltas).

### 6) Cuando aprueben (avisar a Claude Code)
Falta el código de integración (se hace en ese momento):
- OAuth de páginas (elegir página + guardar page token cifrado, como las líneas cloud).
- Webhook handler de Messenger/IG → mismo pipeline de Inbox + Automatizaciones
  (el motor de flujos ya es agnóstico del canal).
- Selector de canal en las Automatizaciones.

## Regla de oro del contenido (recordatorio)
En el screencast y descripciones: SIEMPRE tono neutro — "plataforma de atribución y CRM
para WhatsApp/Instagram/Messenger". Nunca mencionar verticales sensibles; el contenido de
cada cliente es responsabilidad del cliente (Términos).
