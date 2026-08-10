# Prompt — Migrar producción a WAHA (WEBJS), dejando Evolution como rollback

Objetivo: pasar el motor de WhatsApp a **WAHA con engine WEBJS** en producción (arregla el 463 en
fríos: WEBJS es el cliente real y manda el tctoken), sin depender más de Evolution pero
**manteniéndolo como fallback** por la env `WA_ENGINE`.

> ACTUALIZACIÓN IMPORTANTE: desde WAHA **2026.6.1 es 100% gratis y open source**, con **media
> incluida** (imágenes/audio) en la imagen Core. Ya **no existe WAHA Plus** ni hay que pagar.
> Usar la imagen `devlikeapro/waha:latest` (confirmar versión ≥ 2026.6.1 en el dashboard).

---

```
Migramos el motor de WhatsApp a WAHA (engine WEBJS) en producción, manteniendo Evolution como
rollback por la env WA_ENGINE. WAHA ahora es gratis y con media incluida (Core, versión ≥2026.6.1).
Hacé TODO esto sin romper el flujo actual:

=== 1) MEDIA en el adapter WAHA (lib/waha.ts) — hoy está stubbeado; implementarlo (ya es free) ===
- sendWhatsAppAudio: POST /api/sendVoice { session, chatId, file:{mimetype,data|url} }.
- Envío de imagen/archivo si el código lo usa: POST /api/sendImage / /api/sendFile.
- getMediaBase64: la media entrante de WAHA llega en el webhook (payload.media.url o hasMedia).
  Implementá: descargar esa URL con header X-Api-Key y devolver { base64, mimetype }. Si el webhook
  trae la media en base64, usarla directo. Ajustá normalizeWahaEvent para exponer la media del
  mensaje entrante igual que hoy hace routes/webhook.ts con Evolution (para detección de comprobantes).
- Error claro si WAHA responde 4xx.

=== 2) Compose de producción ===
- Agregá el servicio waha (devlikeapro/waha:latest) al docker-compose.vps.yml:
  env: WHATSAPP_DEFAULT_ENGINE=${WAHA_ENGINE:-WEBJS}, WAHA_API_KEY, WHATSAPP_HOOK_URL=
  https://app.publi.lat/api/wa/webhook, WHATSAPP_HOOK_EVENTS=message.any,message.ack,session.status;
  volumen persistente para sesiones; restart: unless-stopped; healthcheck.
- NO borres el servicio evolution: queda para rollback.

=== 3) Env de producción ===
- WA_ENGINE=waha  (switch existente en lib/wa-engine.ts)
- WAHA_ENGINE=WEBJS, WAHA_BASE_URL=http://waha:3000, WAHA_API_KEY=..., WAHA_WEBHOOK_URL=
  https://app.publi.lat/api/wa/webhook
- Documentar en .env.example que WA_ENGINE=evolution revierte al motor viejo.

=== 4) Reconexión de líneas (las sesiones no migran de Evolution a WAHA) ===
- Las WaLine quedan desconectadas en WAHA hasta re-escanear. Agregá:
  - Estado/badge en el panel: "Reconectá tu WhatsApp (actualización del sistema)" con el botón de
    QR/pairing existente, que ahora crea la sesión en WAHA.
  - Banner in-app para usuarios con líneas activas explicando el re-escaneo (una sola vez).
- No borres WaLine ni su historial; solo se rehace la sesión del motor.

=== 5) Salud / webhooks / warmup / proxy con WAHA ===
- Verificá que salud de línea (session.status), acks (message.ack, incl. ERROR del 463), warmup y
  proxy por línea (config.proxy) sigan funcionando. El re-sync de webhooks al boot debe soportar WAHA.

=== 6) Calidad ===
- typecheck backend + build frontend, tests verdes.
- WA_ENGINE=evolution debe seguir funcionando 100% (rollback probado).
- Migraciones incluidas si tocás la DB.

Entregá el diff, env nuevas, y un CHECKLIST de corte:
  a. Levantar WAHA, smoke test: 1 línea de prueba, texto + imagen (enviar y recibir) + ver el ack
     de un frío — todo por WAHA.
  b. Recién con el smoke OK: WA_ENGINE=waha + avisar a clientes que re-escaneen.
  c. Rollback: WA_ENGINE=evolution + docker compose up -d app.
```

---

## Nota de recursos (para tener presente, no bloquea)
WEBJS corre **un Chromium por línea** → consume más RAM/CPU que Baileys. Con pocas líneas va bien;
si escalás a muchas, monitoreá el VPS y evaluá NOWEB (Baileys al día) para las que no necesiten el
plus de resistencia de WEBJS. El switch por línea se puede afinar después.

## Antes de reconectar TODAS las líneas: 5 minutos que pueden ahorrarte la migración
Corré el frío por **Evolution** con el mismo chip Vendly (fila 2 de la planilla) a un número virgen.
- Si Evolution **también entrega** el frío (quizás la versión nueva de WA Web + warming ya lo
  arreglaron) → **no necesitás migrar**: te quedás en Evolution y listo.
- Si Evolution **da 463** → migramos con este prompt, con la evidencia limpia.
