# Prompt para Claude Code (VS Code) — Fix DEFINITIVO del Embedded Signup

El popup de Meta se completa OK (la WhatsApp Business Account queda conectada del lado de Meta),
pero la app NO crea la línea. Diagnóstico real observado en consola/red:

- Aparece `[ES] FB.login callback` pero **nunca** aparece `[ES] message <- ...`.
  => El `postMessage` `WA_EMBEDDED_SIGNUP` (que trae `waba_id` y `phone_number_id`) NO se está
     capturando en el frontend.
- Como el front exige `wabaId` para llamar al backend, **nunca se dispara** POST /api/wa/cloud/connect.
- Resultado: no se crea la línea y se muestra "No se completó la conexión (faltó el código o la
  cuenta de WhatsApp)".

La solución es dejar de depender del postMessage y **resolver todo en el backend a partir del `code`**.

---

```
Arreglá el flujo de Embedded Signup para que NO dependa del postMessage del popup. El backend debe
resolver la WABA y el número usando solo el `code`. Cambios:

=== BACKEND ===
Archivo: backend/src/routes/wa.ts (POST /api/wa/cloud/connect) y backend/src/lib/wa-cloud.ts

1) Cambiá el schema de /api/wa/cloud/connect: `code` OBLIGATORIO; `phoneNumberId` y `wabaId`
   OPCIONALES (pueden no venir nunca).

2) Nuevo flujo del endpoint:
   a. token = await exchangeCodeForToken(code)   // token de integración del negocio del cliente
   b. Si NO vino wabaId: resolverlo con debug_token:
      GET https://graph.facebook.com/{GRAPH_VERSION}/debug_token
          ?input_token={token}
          &access_token={META_APP_ID}|{META_APP_SECRET}
      En la respuesta, data.granular_scopes es un array de { scope, target_ids }.
      Buscá el scope "whatsapp_business_management" (o, si no está, "whatsapp_business_messaging")
      y tomá target_ids[0] como wabaId. Si no hay target_ids, devolvé 409 con mensaje claro:
      "La cuenta de WhatsApp se conectó en Meta pero todavía no se comparte con la app. Esperá
      unos segundos y tocá Reintentar."
   c. Si NO vino phoneNumberId: resolverlo desde la WABA:
      GET https://graph.facebook.com/{GRAPH_VERSION}/{wabaId}/phone_numbers?access_token={token}
      Tomá data[0].id como phoneNumberId y data[0].display_phone_number como phone.
      Si el array está vacío, devolvé 409 con: "La cuenta no tiene número verificado todavía.
      Reintentá en unos segundos."
   d. await subscribeWaba(wabaId, token)         // suscribe la app al webhook de esa WABA
   e. await registerPhone(phoneNumberId, token)  // best-effort
   f. Creá la waLine (provider "cloud", connected true, status "active", wabaId, wabaPhoneNumberId,
      phone si lo tenés, accessToken cifrado, verifyToken = WHATSAPP_WEBHOOK_VERIFY_TOKEN).
   g. Respondé 201 con la línea.

3) En backend/src/lib/wa-cloud.ts agregá helpers:
   - debugToken(token): Promise<{ wabaIds: string[] }>  -> hace el GET /debug_token y devuelve los
     target_ids de los scopes whatsapp_business_management / whatsapp_business_messaging.
   - getWabaPhoneNumbers(wabaId, token): Promise<Array<{ id:string; display_phone_number:string; verified_name?:string }>>
     -> GET /{wabaId}/phone_numbers.
   Logueá con prefijo "[ES][backend]" cada paso (code recibido, token ok, wabaId resuelto,
   phoneNumberId resuelto, línea creada) y los errores con el body de Graph para diagnosticar.

4) Manejo de errores: si Graph devuelve error, logueá el status y el body completo y respondé 502
   con un detail legible. Nunca tires el server.

=== FRONTEND ===
Archivo: frontend/src/pages/WhatsappPage.tsx

5) En el callback de FB.login: si hay `code`, llamá SIEMPRE a finishConnect(code, phoneNumberId?,
   wabaId?) aunque NO tengamos phoneNumberId/wabaId del postMessage (que quedan como best-effort).
   Mostrá el error rojo SOLO si no hay `code`.

6) finishConnect: el POST a /api/wa/cloud/connect manda { code, phoneNumberId?, wabaId?, label }.
   - Si responde 201: agregá la línea y además llamá load() para refrescar desde el server.
     Mostrá "WhatsApp conectado ✓" en verde.
   - Si responde 409: mostrá el mensaje del backend y un botón "Reintentar conexión" que reintente
     el MISMO POST con el mismo code (guardá el último code en un ref/estado). Reintentar 1 vez
     tras unos segundos suele alcanzar (la WABA tarda en propagar el número).
   - Si 4xx/5xx: mostrá el detail.

7) Mantené los console.log con prefijo "[ES]" (incluido loguear hasCode en el callback) para poder
   verificar en la consola.

=== PRUEBA ===
8) typecheck del backend + build del frontend. No toques el flujo Baileys ni la carga manual.
   Confirmá que con SOLO el code (sin postMessage) se crea la línea.
```

---

## Nota
La WhatsApp Business Account "test2" ya quedó conectada en Meta del intento anterior, así que cuando
Claude Code aplique esto y reintentes el popup, debería resolver esa WABA por `debug_token` y crear la
línea sin pedirte número de nuevo. Si da 409 la primera vez, reintentá a los ~10 segundos.
