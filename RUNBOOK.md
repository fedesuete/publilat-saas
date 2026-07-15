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
