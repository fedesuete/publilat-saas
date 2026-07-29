# Migración Hostinger → DigitalOcean

> Runbook de corte. Objetivo: mover TODO el estado (Postgres, sesiones WhatsApp, tutoriales,
> redis, `.env`) al server nuevo con **mínima ventana** y **rollback inmediato por DNS**.
> Scripts: [`migrate-export.sh`](migrate-export.sh) (server viejo) + [`migrate-import.sh`](migrate-import.sh) (server nuevo).

## Lo que se migra
| Componente | Cómo viaja |
|---|---|
| Postgres (`publilat` + `evolution` + roles) | `pg_dumpall` lógico (`pg_all.sql.gz`) |
| Sesiones WAHA (WhatsApp actual) | volumen `waha_sessions` (tar byte-a-byte) |
| Sesiones Evolution (rollback) | volumen `evolution_instances` + DB `evolution` |
| Videos de tutoriales | volumen `tutorial_videos` |
| Colas BullMQ | volumen `redisdata` (transitorio; si se pierde, no pasa nada grave) |
| Secretos | `.env` |

## Riesgo principal
**Re-escaneo de QR.** Las sesiones WAHA se copian byte-a-byte y **deberían** reanudar si la
**imagen WAHA es la MISMA** (no actualizar la imagen en esta movida — item 7 quedó en espera).
Si aun así piden QR, se re-escanean desde el panel. Meta **no** se rompe: la atribución va por
**dominio**, no por IP (los `*.cloudfront.net` y `app.publi.lat` no cambian de nombre).

---

## Antes del corte (con tiempo, sin apuro)
1. **DigitalOcean:** crear droplet (Ubuntu 22.04+, ≥ 4 GB RAM + swap), instalar Docker + compose.
2. **DNS TTL a 60s** en `app.publi.lat`, `chat.publi.lat`, `publi.lat` (Cloudflare) **≥ 24 h antes**,
   así el cambio propaga rápido en el corte.
3. En el droplet nuevo: `git clone` del repo en `/opt/publilat`.
4. Recrear el ruteo (Traefik/EasyPanel **o** Caddy) apuntando a los puertos `4010/4020/4030`.
   Emitir certs Let's Encrypt para los 3 hostnames (o dejarlo listo para emitir al apuntar DNS).

## Corte (de madrugada, ventana corta)
> Durante el corte NO se pierden pagos: los webhooks de Pagopar reintentan; los mensajes de
> WhatsApp quedan en el teléfono y entran al reconectar.

1. **(viejo)** Exportar:
   ```bash
   cd /opt/publilat && bash deploy/migrate-export.sh
   ```
   Copiar el paquete al nuevo:
   ```bash
   scp -i ~/.ssh/publilat_deploy /opt/publilat/migracion/publilat-migracion-*.tar.gz root@<IP_NUEVA>:/root/
   ```
2. **(nuevo)** Postgres vacío arriba + importar:
   ```bash
   cd /opt/publilat
   docker compose -f docker-compose.vps.yml up -d postgres
   bash deploy/migrate-import.sh /root/publilat-migracion-<fecha>.tar.gz
   ```
3. **(nuevo)** Verificar ANTES de tocar DNS:
   ```bash
   curl -s http://localhost:4010/health           # {"ok":true}
   docker compose -f docker-compose.vps.yml ps      # todos up/healthy
   docker compose -f docker-compose.vps.yml logs --tail=50 waha
   ```
   Probar el panel apuntando el hosts local o por IP. Si WAHA pide QR → re-escanear en Admin → Líneas.
4. **Cutover DNS:** apuntar `app.` / `chat.` / `publi.lat` a la IP nueva (TTL 60s → propaga en minutos).
5. **Dual-run:** dejar el server VIEJO PRENDIDO ~24-48 h (sin recibir tráfico nuevo) por si hay rollback.

## Verificación post-corte
- [ ] Login al panel + ver leads/analytics (Postgres migró).
- [ ] Enviar/recibir un mensaje de WhatsApp de prueba (WAHA reanudó o re-escaneado).
- [ ] Chat App (`chat.publi.lat`) abre y loguea un jugador.
- [ ] Un pago de prueba Pagopar acredita (webhook llega a la IP nueva).
- [ ] Videos de tutoriales se reproducen (volumen `tutorial_videos`).
- [ ] `META_TEST_EVENT_CODE` sigue **vacío** en el `.env` nuevo (regla dura).

## Rollback
Si algo falla tras el DNS: **volver a apuntar el DNS a la IP vieja** (sigue prendida, TTL 60s).
El estado viejo quedó intacto (el export es de solo-lectura). Diagnosticar en el nuevo sin presión.

## Al terminar (cuando el nuevo esté sólido, 48 h después)
- Bajar el server viejo de Hostinger.
- Subir el TTL del DNS de vuelta (300–3600s).
- Borrar el paquete de migración (contiene secretos): `rm -rf /opt/publilat/migracion /root/migracion-import /root/publilat-migracion-*.tar.gz`.
