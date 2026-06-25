# Prompt para Claude Code — CAMBIO: usar Embedded Signup (Tech Provider) en vez de token manual

Pegá el bloque en Claude Code. Es una corrección al prompt anterior de CTWA / Cloud API:
en vez de que el cliente pegue Phone Number ID + token a mano, Publi va a ser un
**Tech Provider** y cada cliente conecta SU propio WhatsApp con **Embedded Signup** (un
popup de login de Facebook). Reaprovechá lo que ya hiciste de Cloud API (webhook, CAPI).

---

```
CAMBIO IMPORTANTE sobre la integración de WhatsApp Cloud API que estás haciendo:

En vez de que cada cliente pegue manualmente su Phone Number ID, WABA ID y Access Token,
Publi va a funcionar como TECH PROVIDER y los clientes van a conectar su propio WhatsApp
mediante EMBEDDED SIGNUP (el flujo oficial de Meta: un popup de Facebook Login donde el
cliente elige/crea su Business Manager + WABA + número y le da permiso a nuestra app).

Reutilizá todo lo que ya hiciste de Cloud API (el webhook /api/wa/cloud/webhook, el envío a
CAPI con ctwa_clid y action_source=business_messaging, el modelo de línea Cloud). Solo CAMBIA
la forma de ONBOARDING/conexión: de carga manual de credenciales -> a Embedded Signup.

IMPLEMENTÁ:

1. Frontend — botón "Conectar WhatsApp (oficial)" que lanza Embedded Signup:
   - Cargá el JS SDK de Facebook (facebook-jssdk) con el APP_ID nuestro.
   - Botón que llama FB.login() con config_id (el de nuestra config de Embedded Signup) y
     response_type=code, override_default_response_type=true, extras con setup/featureType.
   - Escuchá el `message` event del popup para capturar { phone_number_id, waba_id } que
     Meta devuelve, y el `code` (authorization code) del callback de FB.login.
   - Reemplazá el formulario de "pegar token" por este botón (dejá el form manual solo como
     fallback avanzado, oculto).

2. Backend — intercambio del code por token y alta de la línea:
   - Nuevo endpoint POST /api/wa/cloud/connect que reciba { code, phoneNumberId, wabaId }.
   - Intercambiá el `code` por un access token con:
     GET https://graph.facebook.com/v20.0/oauth/access_token
       ?client_id=APP_ID&client_secret=APP_SECRET&code=CODE
     (este es el token del Tech Provider para operar sobre la WABA del cliente).
   - Suscribí nuestra app al webhook de esa WABA:
     POST /{wabaId}/subscribed_apps  (con el token).
   - Registrá/activá el número si hace falta:
     POST /{phoneNumberId}/register  (con un pin si aplica).
   - Guardá la WaLine con provider="cloud", wabaPhoneNumberId, wabaId, accessToken (CIFRADO),
     status active, connected true. Asociala al userId logueado (multi-tenant).

3. Variables .env nuevas (de NUESTRA app Tech Provider, globales, no por cliente):
   - META_APP_ID
   - META_APP_SECRET
   - META_ES_CONFIG_ID   (config_id del Embedded Signup)
   - META_GRAPH_VERSION (default v20.0)
   - WHATSAPP_WEBHOOK_VERIFY_TOKEN (el del webhook de Cloud API)

4. Webhook:
   - El webhook /api/wa/cloud/webhook ya existe: asegurate de resolver a qué usuario/línea
     pertenece cada evento entrante por el `phone_number_id` (value.metadata.phone_number_id),
     buscando la WaLine cloud con ese wabaPhoneNumberId. Mantené la captura de
     referral.ctwa_clid para la atribución CTWA.

5. Seguridad: el accessToken del cliente cifrado en reposo (APP_ENCRYPTION_KEY), nunca
   devuelto entero ni logueado. App secret solo en backend.

Notas:
- Esto requiere que nuestra app esté configurada como Tech Provider con Embedded Signup en
  Meta (eso lo hago yo del lado de Meta; vos solo dejá el código listo para esos datos).
- En desarrollo, podés probar el flujo con la app en modo test y números de prueba.

Mostrame primero un plan corto (qué cambia respecto a lo ya hecho, archivos nuevos/modificados)
antes de codear. No rompas el flujo Baileys+landing ni lo que ya anda de Cloud API/CAPI.
```
