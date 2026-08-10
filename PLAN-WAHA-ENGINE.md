# Plan — Agregar motor WAHA (opción 1 WEBJS y opción 2 NOWEB) a Publi.lat

Objetivo: probar y, si funciona, migrar el motor de WhatsApp de Evolution (fork Baileys sin el fix
de `tctoken`) a **WAHA**, que te da los dos motores por config:
- **WEBJS** = Chromium real (whatsapp-web.js) → opción 1, la más resistente al 463 en fríos.
- **NOWEB** = Baileys al día → opción 2, liviano.

Regla de oro: **no tocar producción hasta confirmar el 463 en una instancia de prueba aislada.**
El código de Publi ya abstrae el motor en `backend/src/lib/evolution.ts` (createInstance,
connectInstance, sendText, webhook…). Vamos a hacer un **adapter WAHA** con la misma interfaz y un
switch por env. Así Evolution sigue intacto y podés volver atrás con una variable.

---

## PASO 1 — Deployar WAHA en una instancia de prueba (Docker, aparte de producción)

`docker-compose.waha.yml` (levantalo en un puerto distinto o en otro server de prueba):
```yaml
services:
  waha:
    image: devlikeapro/waha:latest        # Core: incluye WEBJS y NOWEB. (Plus: devlikeapro/waha-plus)
    restart: unless-stopped
    ports:
      - "3001:3000"                        # puerto de prueba, distinto a Evolution (8080)
    environment:
      - WAHA_API_KEY=cambia-esta-clave
      - WHATSAPP_DEFAULT_ENGINE=WEBJS      # opción 1. Para probar opción 2: NOWEB
      - WHATSAPP_HOOK_URL=https://TU-URL-DE-PRUEBA/api/wa/webhook
      - WHATSAPP_HOOK_EVENTS=message,session.status
    volumes:
      - waha-sessions:/app/.sessions       # persiste sesiones (evita re-escanear)
volumes:
  waha-sessions:
```
> WAHA levanta un dashboard en `http://localhost:3001` para probar a mano antes de tocar el código.
> Para muchas sesiones simultáneas y proxies avanzados puede que necesites WAHA Plus (de pago).

---

## PASO 2 — Prompt para Claude Code (adapter WAHA con switch, sin romper Evolution)

```
Agregá WAHA como motor de WhatsApp alternativo a Evolution, sin romper el actual. El código ya
abstrae Evolution en backend/src/lib/evolution.ts. Hacé:

1) Definí una interfaz WhatsAppEngine con los métodos que ya usa la app:
   createInstance, connectInstance (QR/pairing), connectionState, sendText, sendWhatsAppAudio,
   getMediaBase64, restartInstance, logoutInstance, deleteInstance, fetchOwnerNumber, setWebhook.
2) Refactorizá lib/evolution.ts para que implemente esa interfaz (sin cambiar su comportamiento).
3) Creá lib/waha.ts que implemente la MISMA interfaz contra la API REST de WAHA:
   - Sesiones: POST /api/sessions (start con name, config.engine, config.webhooks, config.proxy),
     GET /api/sessions/{name} (estado), QR: GET /api/{session}/auth/qr, pairing si WAHA lo soporta.
   - Enviar: POST /api/sendText { session, chatId, text } (chatId = numero@c.us).
   - Media entrante: descargar por la API de WAHA.
   - Webhooks de WAHA (evento "message", "session.status"): mapealos al MISMO formato que ya
     consume backend/src/routes/webhook.ts, o agregá un branch que normalice ambos payloads.
   - Config de PROXY por sesión (WAHA lo soporta en config.proxy) — dejá el campo listo para
     cargar un proxy residencial por número.
   - Engine configurable: WEBJS o NOWEB.
4) Selector por env: WA_ENGINE=evolution|waha (default evolution). Un factory getEngine() que
   devuelva el adapter según la env. Todo el resto del código llama a getEngine(), no a evolution
   directo.
5) Env nuevas: WAHA_BASE_URL, WAHA_API_KEY, WAHA_ENGINE (WEBJS|NOWEB), WAHA_WEBHOOK_URL.
6) NO cambies el flujo de producción por defecto (WA_ENGINE=evolution). typecheck backend.

No toques la base de datos ni el despliegue de producción. Es solo código + config para poder
levantar WAHA en una instancia de prueba y comparar.
```

---

## PASO 3 — Probar el 463 (la prueba que decide)

Con WAHA levantado y `WA_ENGINE=waha`, en la instancia de prueba:
1. Conectá un **chip nuevo** por QR en WAHA (engine **WEBJS** primero).
2. Mandá a un número **frío** (que nunca habló con esa línea). Confirmá recepción en el destino.
3. Repetí con **NOWEB**.
4. Compará contra Evolution con un chip equivalente el mismo día.

**Interpretación:**
- WEBJS entrega el frío y Evolution da 463 → migrás a WAHA WEBJS. Es la solución.
- NOWEB también entrega → tenés la opción liviana.
- Si ninguno entrega el frío → el problema es de IP/número: sumá **proxy residencial** (config.proxy
  de WAHA) + **warming**, y reprobá.

---

## PASO 4 — Si funciona: migrar producción (otra sesión, con cuidado)
- Cambiar `WA_ENGINE=waha` en producción, reconectar líneas (hay que re-escanear QR una vez).
- Mantener Evolution como fallback hasta estar seguro.
- Sumar proxy residencial por número y rampa de warming.

> Todo esto es plan. Los cambios se ejecutan y prueban en instancia aislada, nunca directo en
> producción con clientes.
