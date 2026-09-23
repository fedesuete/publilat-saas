# RUNBOOK — "el sitio no funciona" (Publi.lat en prod)

Guía para diagnosticar y recuperar rápido cuando algo se cae. Prod: VPS Hostinger,
`187.77.33.164`, `/opt/publilat`, EasyPanel + Traefik. Deploy: `docker-compose.vps.yml`.

> **Regla de oro:** primero averiguá SI es el server o tu red. La mitad de las veces "no funciona"
> es tu propia conexión/VPN, no el server.

---

## Paso 0 — ¿Es el server o soy yo?
- Probá desde el **celu con datos móviles y VPN apagado**, o pedile a alguien que abra la página.
- O mirá el **monitor externo**: pestaña **Actions → Uptime monitor** en GitHub (corre cada 5 min).
- Si a otros les carga → es **tu red/VPN**, no el server. Fin.
- Si está caído para todos → seguí.

## Paso 1 — ¿El VPS está prendido?
Panel de Hostinger → VPS → ¿dice **"Funcionando"**? ¿CPU/memoria normales?
- Si dice detenido / colgado → **Reiniciar VPS** (botón). Esperá 1-2 min. Los datos NO se pierden.

## Paso 2 — ¿El servidor responde por dentro?
Si el VPS dice "Funcionando" pero el sitio no carga, entrá por la **consola web ("Terminal")** de
Hostinger (funciona aunque el SSH esté caído) y corré:
```
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4010/health
```
- **Da 200** → el servidor y los servicios están SANOS. El problema es de **RED / entrante**
  (firewall o incidente del proveedor). Andá al Paso 3.
- **No responde** → un servicio se cayó. Andá al Paso 4.

## Paso 3 — Red / tráfico entrante bloqueado (localhost daba 200)
1. Verificá el firewall LOCAL (debería estar limpio):
   ```
   ufw status            # esperado: inactive
   iptables -S INPUT     # esperado: -P INPUT ACCEPT
   ```
2. En el **panel de Hostinger → Seguridad → Firewall**: si hay un firewall **activo**, es casi
   seguro el culpable (bloquea todo lo que no esté en sus reglas, incluido el SSH). **Desactivalo
   o eliminalo** (⋯ → Eliminar). Esperá 2-3 min a que propague.
3. Si NO hay firewall (o lo sacaste y sigue caído) → es un **incidente de red de HOSTINGER**.
   Mirá **statuspage.hostinger.com** y abrí **soporte de Hostinger** con este texto:
   > "VPS srv1355299 (187.77.33.164) no acepta NINGUNA conexión entrante (SSH/HTTP/HTTPS). Por
   > consola: servicios responden en localhost 200, ufw inactivo, iptables INPUT ACCEPT. El VPS
   > está sano; el tráfico entrante se descarta antes de llegar. Revisen firewall de red / nodo."
   > *(Esto es exactamente lo que pasó el 2026-07-14 — fue un incidente de Hostinger, se resolvió
   > solo cuando ellos arreglaron su red.)*

## Paso 4 — Un servicio/contenedor se cayó
En SSH o en la consola de Hostinger:
```
cd /opt/publilat && docker compose -f docker-compose.vps.yml ps
```
- Levantar lo que falte: `docker compose -f docker-compose.vps.yml up -d`
- Si Docker no responde: `systemctl restart docker` y esperá ~30s.
- `autoheal` reinicia solo el `app` si queda "unhealthy" (ya configurado), pero podés forzar:
  `docker compose -f docker-compose.vps.yml restart app`

## WhatsApp: verificar que las líneas volvieron
```
cd /opt/publilat && docker compose -f docker-compose.vps.yml exec -T app \
  node -e "fetch('http://waha:3000/api/sessions',{headers:{'X-Api-Key':process.env.WAHA_API_KEY}}).then(r=>r.json()).then(s=>console.log(JSON.stringify(s.map(x=>({name:x.name,status:x.status})))))"
```
Esperado: todas en `WORKING`. Las sesiones persisten en el volumen `waha_sessions` (no se pierden
en un reinicio). Si alguna queda en `SCAN_QR_CODE`, hay que re-escanear esa línea desde el panel.

## No entran mensajes al Inbox (líneas en WORKING pero no llegan)
Síntoma: los clientes escriben y **no aparece nada en el Inbox**, aunque las líneas figuran
`WORKING`. Casi siempre es **WAHA que crashea al parsear el mensaje entrante** (bug de su motor
WEBJS cuando WhatsApp cambia el formato y la imagen quedó vieja).

Diagnóstico (SSH o consola):
```
cd /opt/publilat
# 1) ¿WAHA crashea al recibir? (buscá este error tras un mensaje de prueba)
docker compose -f docker-compose.vps.yml logs waha --since 3m | grep -iE "parseMessageId|includes.*undefined"
# 2) ¿Se guardan mensajes? (si el max es viejo, están frenados)
docker compose -f docker-compose.vps.yml exec -T postgres psql -U postgres -d publilat \
  -c "SELECT max(\"createdAt\") FROM \"Message\" WHERE direction='in';"
```
Si aparece `parseMessageIdSerialized ... reading 'includes' of undefined` → **actualizá WAHA**:
```
# poné temporalmente image: devlikeapro/waha:latest en docker-compose.vps.yml, o:
docker pull devlikeapro/waha:latest
docker compose -f docker-compose.vps.yml up -d waha
# esperá ~75s a que reconecten las sesiones (persisten, NO hace falta re-escanear)
```
Después **fijá el nuevo digest** en `docker-compose.vps.yml` (línea de la imagen `waha`) para no
volver a `latest`. Verificá: mandá un WhatsApp de prueba a una línea y mirá que aparezca en
`Message` (direction='in') y que NO reaparezca el error.

> Prevención: WAHA WEBJS corre un Chromium por línea y se rompe cuando WhatsApp cambia su protocolo.
> Conviene actualizarlo cada tanto (mismo comando) de forma proactiva, en horario de bajo tráfico.

## Redeploy (tras un cambio de código)
```
cd /opt/publilat && git pull && docker compose -f docker-compose.vps.yml up -d --build app
```
Antes de tocar la DB: `pg_dump` primero. Migraciones: `prisma migrate deploy` (nunca `db push`).

---

## Prevención montada (resiliencia)
- **Monitor externo:** GitHub Actions (`.github/workflows/uptime.yml`) chequea los 3 sitios cada
  5 min y avisa (email de GitHub + Telegram si están los secrets). **Recomendado además:**
  UptimeRobot (1 min) apuntando a `app.publi.lat/health` y `chat.publi.lat`.
- **Auto-recuperación:** `autoheal` reinicia el `app` si su healthcheck falla.
- **Anti-OOM:** swap en el VPS (WAHA corre un Chromium por línea, pesado en RAM).
- **SSH:** fail2ban contra fuerza bruta.
- **Firewall:** mantener el de red de Hostinger **apagado** (Docker ya expone solo lo necesario), o
  si se quiere uno, configurarlo permitiendo EXPLÍCITO 22/80/443 + puertos de todas las apps.

## Cloudflare (nube naranja) en app.publi.lat y chat.publi.lat

Desde 2026-09-23 la app soporta ir detrás del proxy de Cloudflare (arregla los `ERR_CONNECTION_TIMED_OUT`
de jugadores en ISPs con mala ruta al VPS). **No hace falta tocar el Traefik de EasyPanel**: la IP real
se resuelve en la app (`lib/cloudflare-ip.ts`), a prueba de `CF-Connecting-IP` falsas.

- Los DOS registros van en naranja: `chat` (la PWA) **y** `app` (la PWA llama a la API en app.publi.lat;
  si solo va `chat`, la API sigue pegándole al VPS pelado y los timeouts siguen).
- SSL/TLS: **Full (strict)**. Traefik renueva por desafío HTTP → funciona detrás de Cloudflare.
  **NO prender "Always Use HTTPS"** en Cloudflare (Traefik ya redirige; el redirect de Cloudflare
  puede pisar la renovación del certificado).
- Speed → apagar **Rocket Loader** (rompe los módulos de Vite). Scrape Shield → apagar
  **Email Address Obfuscation**. Bot Fight Mode: dejar APAGADO.
- WAF → regla "Skip" (todas las protecciones) para los callbacks que llaman máquinas:
  `/api/billing/webhook*`, `/api/webhooks/leadgen*`, `/api/wa/cloud/webhook*`, `/api/chat/pay/webhook`,
  `/api/integrations/kommo*`, `/api/bot-relay*`, `/go*`.
- Límite: el plan gratis corta subidas de más de **100 MB** (413) → videos de tutoriales grandes hay
  que comprimirlos. Los que ya están suben igual (los sirve el backend).
- Verificar después de prender: `GET /api/admin/whoami` (logueado como admin) tiene que devolver TU IP en
  `ip` y un `cfRay` no nulo. Si `ip` es una 104.x/172.6x/162.15x = está viendo el borde: avisar.
- Volver atrás = nube gris de nuevo (DNS-only). Nada del lado de la app cambia.

## Tormenta de caidas (linea detenida) y avisos por WhatsApp

Desde 2026-09-23, una linea que se cae **10 veces en 1 hora** (`LINE_STORM_FLAPS`) se DETIENE (WAHA `stop`,
credenciales intactas) y ningun automatismo la levanta: el cliente recibe campanita + mail con la
instruccion "toca Conectar / Ver QR, NO borres la linea", y el dueno recibe WhatsApp. Se levanta el freno
cuando el usuario toca Conectar (o sola a las 6 h). Motivo: el 78% de los cierres de 48 h venian de 3
lineas que reintentaban sin limite hasta que el cliente las borraba y recreaba (QR + sync por proxy).

Los avisos de admin (`alertAdminProxy`: saldo IPRoyal bajo, proxy caido, linea esperando proxy, tormenta)
salen tambien por **WhatsApp** al celular del dueno (`ADMIN_ALERT_WA_TO`) desde la linea de
`ADMIN_ALERT_WA_FROM_EMAIL` (o cualquier linea paga de un ADMIN que no sea el destino), 1 por tipo cada 6 h.
Umbral de saldo IPRoyal: 3 GB (`IPROYAL_LOW_GB`). El fix definitivo del saldo es el AUTO TOP-UP en IPRoyal.
