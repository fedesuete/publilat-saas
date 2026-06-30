# Prompt para Claude Code — Fix del Embedded Signup (la línea no se crea tras el popup)

Pegá el bloque en Claude Code. Síntoma real: el popup de Embedded Signup termina y en Meta se crea
la WABA, pero en Publi NO aparece la línea y muestra "No se completó la conexión (faltó el código o
los datos del número)". El handler de postMessage no está capturando bien `phone_number_id` /
`waba_id`, y/o el `code` no llega, así que `finishConnect` nunca se dispara.

---

```
BUG: en frontend/src/pages/WhatsappPage.tsx, el flujo de Embedded Signup (launchSignup +
el listener de window "message" + finishConnect) no crea la línea cuando el popup termina,
aunque en Meta sí se crea la WhatsApp Business Account. Hay que hacerlo robusto y diagnosticable.

Hacé estos cambios:

1) DIAGNÓSTICO (logs temporales claros). En el listener de "message" y en el callback de FB.login,
   agregá console.log que impriman exactamente qué llega:
   - En el message handler: logueá event.origin y el data parseado (type, event, data.phone_number_id,
     data.waba_id). Mostrá también los mensajes que se ignoran por no ser JSON.
   - En el callback de FB.login: logueá si vino response.authResponse?.code, y el contenido de
     esSessionRef.current (phoneNumberId, wabaId).
   Esto es para ver en la consola del navegador si falta el code, el phone_number_id o ambos.

2) HANDLER DE postMessage MÁS TOLERANTE. Meta manda el mensaje del Embedded Signup así:
   { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH' | 'CANCEL' | 'FINISH_ONLY_WABA' | ..., data: { phone_number_id, waba_id, ... } }
   Ajustá el handler para:
   - Aceptar el mensaje cuando data.type === 'WA_EMBEDDED_SIGNUP' aunque el evento NO sea FINISH,
     guardando phone_number_id y waba_id si vienen (a veces vienen en FINISH_ONLY_WABA sin phone).
   - Guardar SIEMPRE en esSessionRef lo que llegue (waba_id aunque falte phone_number_id).
   - No romper si event.data ya es objeto (no string): probar JSON.parse solo si es string.
   - Mantener el chequeo de origin a *.facebook.com.

3) FALLBACK CUANDO FALTA phone_number_id. Si al cerrar el popup tenemos `code` y `wabaId` pero
   NO `phoneNumberId`, igual llamá a finishConnect mandando phoneNumberId vacío/undefined y que el
   BACKEND lo resuelva (ver punto 4). Solo mostrá el error rojo si falta el `code` O falta el `wabaId`.

4) BACKEND: resolver el phone number desde la WABA. En backend/src/routes/wa.ts, en
   POST /api/wa/cloud/connect:
   - Cambiá el schema para que phoneNumberId sea OPCIONAL (wabaId y code siguen obligatorios).
   - Tras exchangeCodeForToken(code) y subscribeWaba(wabaId, token): si phoneNumberId vino vacío,
     consultá la Graph API GET /{wabaId}/phone_numbers con el token y tomá el primer phone number
     (su id es el phone_number_id, y su display_phone_number como número). Usalo para crear la línea.
   - Si la WABA todavía no tiene número (array vacío), devolvé un error claro:
     "La cuenta de WhatsApp se creó pero todavía no tiene número verificado. Volvé a intentar en
     unos segundos." (status 409), sin romper.
   - Guardá phone (display_phone_number) en la línea si lo obtuviste, para que se vea el número.
   - Mantené el resto igual (registerPhone best-effort, encryptSecret del token, verifyToken global).

5) UX: cuando finishConnect crea la línea, además de agregarla al estado, llamá a load() para
   refrescar la lista desde el server (así aparece sí o sí). Mostrá un mensaje verde "WhatsApp
   conectado ✓". Si el backend devuelve 409 (sin número aún), mostrá ese texto y un botón "Reintentar"
   que vuelva a consultar /api/wa/cloud/connect… (o simplemente recargar las líneas).

6) Agregá en lib/wa-cloud.ts (backend) un helper getWabaPhoneNumbers(wabaId, token) que llame a
   GET https://graph.facebook.com/{GRAPH_VERSION}/{wabaId}/phone_numbers?access_token=... y devuelva
   [{ id, display_phone_number, verified_name }]. Usalo en el connect.

Probá: typecheck del backend y build del frontend. Dejá los console.log del punto 1 puestos por
ahora (los sacamos después de confirmar que conecta). No toques la carga manual (Avanzado) ni el
flujo Baileys.
```

---

## Mientras tanto (workaround para no frenarte)

Como la WABA "test2" YA existe en Meta con tu número, podés conectarla a Publi **sin esperar el fix**
usando la carga manual, pero necesitás un **token permanente de Usuario del sistema** (no el temporal).
Si querés, te guío a generar ese token y lo pegás en "Avanzado: cargar credenciales manualmente"
(Phone Number ID + WABA ID + Access Token + Verify Token). Avisá si vas por ahí o si preferís que
Claude Code aplique el fix y reintentás el popup (más limpio y es lo que van a usar tus clientes).
