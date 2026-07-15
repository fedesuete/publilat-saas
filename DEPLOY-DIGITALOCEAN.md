# DEPLOY / MIGRACIÓN a DigitalOcean — Publi.lat (contexto completo)

Guía para **redesplegar TODO Publi.lat en un droplet nuevo de DigitalOcean** (u otro VPS con
Docker), migrando desde Hostinger. Pensada para que un dev (o Claude) haga la migración de cero.
Contexto del producto: ver `CLAUDE.md`. Operación/incidentes: ver `RUNBOOK.md`.

---

## 1. Arquitectura (qué se levanta)
Todo corre con **Docker Compose** (`docker-compose.vps.yml`). Un solo repo, npm workspaces.

| Servicio | Imagen | Puerto host | Qué es |
|---|---|---|---|
| `app` | build (Dockerfile) | 4010→4000 | Backend Express + Socket.IO **y** el panel (Vite) |
| `postgres` | postgres:16 | interno 5432 | DB principal (`publilat`) + DB `evolution` |
| `redis` | redis:7 | interno 6379 | BullMQ (colas/jobs) |
| `waha` | devlikeapro/waha (**pineado**) | interno 3000 | Motor WhatsApp ACTUAL (WA_ENGINE=waha, WEBJS) |
| `evolution` | evoapicloud/evolution-api:2.4.0-rc2 | interno 8080 | Motor WhatsApp de rollback |
| `landing` | build (Dockerfile.landing) | 4020→80 | Landing de marketing (publi.lat) |
| `chat-pwa` | build (Dockerfile.chat-pwa) | 4030→80 | PWA del Chat App (chat.publi.lat) |
| `autoheal` | willfarrell/autoheal | — | Reinicia el `app` si queda unhealthy |

**Dominios:** `app.publi.lat`→:4010 · `chat.publi.lat`→:4030 · `publi.lat`/`www`→:4020.
Un **reverse proxy con HTTPS** (Caddy o Traefik) rutea los dominios a esos puertos.

> **RAM:** WAHA corre **un Chromium por línea de WhatsApp** (pesado). Elegí un droplet de **≥8 GB
> RAM / 4 vCPU** (los "poderosos" de DO). Con 3-4 líneas, 8 GB va cómodo. Sumá **swap** igual.

---

## 2. Provisionar el droplet
1. DO → Create Droplet → **Ubuntu 24.04**, **Premium/CPU-Optimized 8 GB / 4 vCPU**, SSH key.
2. Entrá por SSH y instalá Docker + compose plugin:
   ```bash
   curl -fsSL https://get.docker.com | sh
   docker compose version   # verificar
   ```
3. **Swap 4 GB** (anti-OOM) y **fail2ban**:
   ```bash
   fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' >> /etc/sysctl.conf
   apt-get update && apt-get install -y fail2ban
   printf '[sshd]\nenabled = true\nmaxretry = 5\nbantime = 1h\n' > /etc/fail2ban/jail.local
   systemctl restart fail2ban
   ```
4. **Firewall:** si usás el firewall de DO (o ufw), **abrí explícito 22, 80, 443** (y no dejes un
   deny-all sin esas reglas — el 2026-07-14 un firewall deny-all dejó el server inalcanzable).

## 3. Traer el código
```bash
mkdir -p /opt && cd /opt
git clone https://github.com/fedesuete/publilat-saas.git publilat
cd /opt/publilat
```

## 4. El `.env` (lo más importante)
```bash
cp .env.example .env && nano .env
```
Completá TODO lo de `.env.example`. Críticos:
- `JWT_SECRET` = `openssl rand -hex 32` · `POSTGRES_PASSWORD` = fuerte.
- `DATABASE_URL=postgresql://postgres:<PASS>@postgres:5432/publilat?schema=public`
- `APP_BASE_URL=https://app.publi.lat` · `PANEL_BASE_URL=https://app.publi.lat` (el boot ABORTA sin estos)
- **`META_TEST_EVENT_CODE=`** ← **VACÍO SIEMPRE en prod** (si tiene valor, los eventos van a Test
  Events y el pixel no recibe conversiones — incidente 2026-07-14). `META_ALLOW_GLOBAL_PIXEL=` vacío.
- WhatsApp: `WA_ENGINE=waha`, `WAHA_API_KEY=...`, `EVOLUTION_API_KEY=...`, `EVOLUTION_WEBHOOK_TOKEN=...`
  (este token va en la URL del webhook de cada sesión WAHA; si cambia, WAHA no puede entregar mensajes).
- Chat App: `CHAT_PWA_ORIGIN=https://chat.publi.lat`, `VAPID_PUBLIC_KEY/PRIVATE_KEY` (generar con
  `npx web-push generate-vapid-keys`), `VAPID_SUBJECT=mailto:soporte@publi.lat`.
- Email/alertas (Resend por SMTP): `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=587`, `SMTP_USER=resend`,
  `SMTP_PASS=re_...` (API key de Resend), `SMTP_FROM`, `ADMIN_ALERT_EMAIL`.
- (Opcional) Landings en S3/CDN: `AWS_*` + `CLOUDFRONT_DOMAIN`. Pagos: `MP_*`/`STRIPE_*`/`NOWPAYMENTS_*`/`PAGOPAR_*`.

> Tip: en Hostinger el `.env` ya está en `/opt/publilat/.env`. Podés **copiarlo tal cual** al droplet
> nuevo (scp) y solo revisar `DATABASE_URL`/hosts. Ojo de NO copiar `META_TEST_EVENT_CODE` con valor.

## 5. Migrar los datos (desde Hostinger)
**Base de datos** (lo importante: clientes, líneas, contactos, mensajes, pixels):
```bash
# En Hostinger:
docker compose -f docker-compose.vps.yml exec -T postgres pg_dump -U postgres publilat > publilat.sql
docker compose -f docker-compose.vps.yml exec -T postgres pg_dump -U postgres evolution > evolution.sql  # si se usa
# copiar los .sql al droplet nuevo (scp), y en DO, tras levantar postgres:
cat publilat.sql | docker compose -f docker-compose.vps.yml exec -T postgres psql -U postgres -d publilat
```
**Sesiones de WhatsApp (WAHA):** están en el volumen `waha_sessions`. Migrar el volumen es posible
pero **frágil** (WhatsApp puede pedir re-escanear al cambiar de servidor/IP). Plan realista: **asumí
que hay que RE-ESCANEAR cada línea** desde el panel tras migrar (QR). Coordiná un horario y avisá.
(Si querés intentar copiar el volumen: `docker run --rm -v waha_sessions:/v -v $PWD:/b alpine tar czf /b/waha.tgz -C /v .` en Hostinger, y restaurar en DO antes de levantar waha.)

## 6. Levantar todo
```bash
cd /opt/publilat
docker compose -f docker-compose.vps.yml up -d --build
# migraciones de Prisma corren solas al arrancar el app (migrate deploy). Ver health:
curl -s localhost:4010/health   # -> {"ok":true,...}
```

## 7. Reverse proxy + HTTPS (los 3 dominios)
En Hostinger se usó el Traefik de EasyPanel. En un droplet **sin EasyPanel**, lo más simple es
**Caddy** (HTTPS automático con Let's Encrypt). Agregá un `Caddyfile` en `/opt/publilat`:
```
app.publi.lat  { reverse_proxy 127.0.0.1:4010 }
chat.publi.lat { reverse_proxy 127.0.0.1:4030 }
publi.lat, www.publi.lat { reverse_proxy 127.0.0.1:4020 }
```
Y corré Caddy (contenedor con red del host, puertos 80/443):
```bash
docker run -d --name caddy --restart unless-stopped --network host \
  -v /opt/publilat/Caddyfile:/etc/caddy/Caddyfile \
  -v caddy_data:/data -v caddy_config:/config caddy:2
```
(Abrí 80 y 443 en el firewall de DO.) Caddy saca y renueva los certs solo.

## 8. DNS (cambiar de Hostinger a DO)
En Cloudflare (o donde estén los NS de publi.lat), apuntá los **A records** a la **IP nueva del
droplet**: `app`, `chat`, `@` (publi.lat), `www`. En **DNS-only / nube gris** (no proxied), o el
challenge de Let's Encrypt falla. Bajá el TTL antes de migrar para que propague rápido.

## 9. Verificación post-deploy
```bash
docker compose -f docker-compose.vps.yml ps            # todos Up (postgres/waha healthy)
curl -s https://app.publi.lat/health                   # 200
curl -s -o /dev/null -w "%{http_code}\n" https://chat.publi.lat/   # 200
# WhatsApp: líneas WORKING
docker compose -f docker-compose.vps.yml exec -T app node -e "fetch('http://waha:3000/api/sessions',{headers:{'X-Api-Key':process.env.WAHA_API_KEY}}).then(r=>r.json()).then(s=>console.log(s.map(x=>x.name+':'+x.status).join('  ')))"
```
Probá el loop end-to-end: abrir un link `/go`, escribir por WhatsApp, ver el lead en el Inbox,
marcar Compró, y verificar Lead/Purchase en el **Test Events Tool** de Meta (con META_TEST_EVENT_CODE
**vacío**, deben ir al pixel EN VIVO).

## 10. Resiliencia y operación (ya montado en el repo)
- **Monitor externo:** `.github/workflows/uptime.yml` (GitHub Actions) — actualizá las URLs si el
  dominio cambia. Sumá **UptimeRobot** apuntando a `app.publi.lat/health` y `chat.publi.lat`.
- **WAHA:** está **pineado** por digest (no `:latest`, que puede venir roto). Actualizalo cada tanto
  proactivamente con `bash deploy/update-waha.sh` (WhatsApp cambia el protocolo y WAHA viejo se rompe
  con `parseMessageIdSerialized` = mensajes entrantes caídos, sesión igual WORKING).
- **Watchdog WAHA:** instalá el cron (detecta ese crash y avisa por email):
  ```bash
  chmod +x deploy/*.sh
  ( crontab -l 2>/dev/null; echo "*/5 * * * * /opt/publilat/deploy/waha-watchdog.sh >/dev/null 2>&1" ) | crontab -
  ```
- **autoheal + healthcheck** del app: ya en el compose.
- **RUNBOOK.md:** diagnóstico de caídas (¿es el server o mi red? / mensajes que no entran / etc.).

## 11. Gotchas heredados (NO repetir)
- `META_TEST_EVENT_CODE` **vacío** en prod (si no, el pixel no recibe conversiones — silencioso).
- **Multi-tenant del pixel:** cada cliente carga SU pixel en el panel; sin `META_ALLOW_GLOBAL_PIXEL=true`
  un cliente sin pixel NO manda al pixel global (por diseño; se le avisa que lo configure).
- **Landings de HTML propio:** el sistema les inyecta el tracking al publicar; el botón debe ir al
  link `/go` (no directo a wa.me). El bucket S3 es privado: sin `CLOUDFRONT_DOMAIN`, el logo/branding
  se sirve por el backend (ya resuelto en código).
- **Firewall:** nunca dejar un firewall deny-all sin permitir 22/80/443 (te lockea afuera).
