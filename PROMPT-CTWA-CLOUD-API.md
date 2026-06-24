# Prompt para Claude Code — Soporte Click-to-WhatsApp (CTWA) + WhatsApp Cloud API

Pegá el bloque en Claude Code. Agrega a Publi la posibilidad de hacer campañas DIRECTAS a
WhatsApp (anuncios Click-to-WhatsApp) y atribuir los jugadores interesados al pixel vía la
Conversions API, usando la API oficial de WhatsApp (Cloud API) para capturar el ctwa_clid.

---

```
Quiero sumarle a Publi soporte para ANUNCIOS CLICK-TO-WHATSAPP (CTWA): que un cliente haga
campañas en Meta directo a WhatsApp (sin landing) y que el pixel/CAPI trackee los jugadores
interesados. El loop actual ya hace atribución vía landing+fbclid con líneas Baileys/Evolution;
NO lo rompas. Esto es una NUEVA vía de atribución, en paralelo.

CONTEXTO TÉCNICO (respetar):
- Cuando alguien hace clic en un anuncio CTWA y manda el primer mensaje, Meta inyecta un
  `ctwa_clid` en el objeto `referral` del webhook entrante de WhatsApp.
- Ese `referral`/`ctwa_clid` se recibe de forma CONFIABLE solo con la WhatsApp Cloud API
  OFICIAL, no con Baileys/QR. Por eso este modo usa Cloud API.
- La atribución se envía a Meta con la Conversions API usando:
  · `ctwa_clid`
  · `action_source = "business_messaging"`
  · `messaging_channel = "whatsapp"`
  (en vez del action_source "website" que usa el flujo de landing).

ALCANCE — implementá:

1. Tipo de línea "Cloud API" (además de las Baileys actuales):
   - En el modelo WaLine agregá: `provider` ("baileys" | "cloud"), y para cloud:
     `wabaPhoneNumberId`, `wabaId`, `accessToken` (cifrado), `verifyToken`.
   - Migración Prisma. No rompas las líneas Baileys existentes (provider default "baileys").

2. Webhook de WhatsApp Cloud API:
   - Endpoint GET /api/wa/cloud/webhook para la verificación (hub.challenge + verify token).
   - Endpoint POST /api/wa/cloud/webhook para recibir mensajes.
   - Al recibir un mensaje entrante, leé `entry[].changes[].value.messages[].referral`:
     extraé `ctwa_clid`, `source_id` (campaña/ad), `source_type`, `headline`, `body`,
     `media_url`. Si hay `referral`, es un lead de CTWA.
   - Creá/actualizá el Contact con: phone (del mensaje), ctwaClid, campaignId=source_id,
     source="ctwa", stage="NUEVO". Guardá un campo nuevo `ctwaClid` en Contact.
   - Guardá el mensaje en el Inbox (igual que el webhook de Evolution).

3. Envío a Conversions API para CTWA:
   - Extendé lib/meta-capi.ts (o un helper nuevo) para soportar un modo "business_messaging":
     cuando el evento viene de una línea Cloud + el contacto tiene ctwaClid, enviá el evento
     con action_source="business_messaging", messaging_channel="whatsapp" y
     user_data.ctwa_clid = <ctwaClid> (NO se hashea). Mantené external_id igual.
   - Disparar evento "Lead" al recibir el primer mensaje CTWA, y "Purchase" cuando se marca
     la compra (reusar el flujo de leads/:id/purchase, eligiendo el action_source según si el
     contacto es ctwa o web).

4. Envío de mensajes salientes por Cloud API:
   - En el Inbox, si la línea es provider "cloud", enviá los mensajes con la Graph API de
     WhatsApp (POST /{phoneNumberId}/messages) en vez de Evolution. Respetá la ventana de
     24/72 h (si está fuera de ventana, marcar que requiere plantilla).

5. Frontend (sección WhatsApp / Líneas):
   - Al crear línea, permitir elegir "Conexión por QR (Baileys)" o "API oficial (Cloud API)".
   - Para Cloud API: formulario con Phone Number ID, WABA ID, Access Token, Verify Token, y
     mostrar la URL del webhook para pegar en Meta. Ayuda inline de dónde sacar cada dato.
   - Marcar las líneas Cloud con un badge "Oficial / CTWA".

6. Variables .env nuevas: WHATSAPP_GRAPH_VERSION (default v20.0). Tokens por línea, no global.

REQUISITOS:
- TypeScript estricto, validá con zod. Tokens cifrados en reposo, nunca devueltos enteros.
- No toques el flujo landing+fbclid+Baileys existente: esto convive.
- Verificá con el Test Events Tool de Meta que el Lead CTWA llegue con action_source
  business_messaging y el ctwa_clid, y que matchee.

Mostrame primero un plan corto (cambios de schema, endpoints nuevos, archivos) antes de codear.
```
