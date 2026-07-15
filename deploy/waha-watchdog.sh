#!/usr/bin/env bash
# Watchdog de WAHA: detecta el crash SILENCIOSO de mensajes entrantes (parseMessageIdSerialized),
# que deja la sesión en WORKING pero NO procesa mensajes. Si lo detecta, manda un email de alerta
# (Resend, reusa las SMTP_* del .env). Dedup: 1 aviso por hora. Se corre por cron cada 5 min.
cd /opt/publilat 2>/dev/null || exit 0
set -a; . ./.env 2>/dev/null || true; set +a

PATTERN='parseMessageIdSerialized|Cannot read properties of undefined \(reading .includes'
STATE=/var/tmp/waha-watchdog.last

docker compose -f docker-compose.vps.yml logs waha --since 6m 2>/dev/null | grep -qiE "$PATTERN" || exit 0

now=$(date +%s); last=$(cat "$STATE" 2>/dev/null || echo 0)
[ $((now - last)) -lt 3600 ] && exit 0   # ya avisé hace menos de 1 h
echo "$now" > "$STATE"

[ -n "${SMTP_PASS:-}" ] && [ -n "${ADMIN_ALERT_EMAIL:-}" ] || exit 0
curl -s -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer ${SMTP_PASS}" -H "Content-Type: application/json" \
  --data @- >/dev/null 2>&1 <<JSON || true
{"from":"${SMTP_FROM:-alertas@publi.lat}","to":["${ADMIN_ALERT_EMAIL}"],"subject":"🔴 WhatsApp: NO entran mensajes (WAHA crasheando)","text":"El motor WAHA esta crasheando al recibir mensajes (parseMessageIdSerialized). Los mensajes entrantes NO estan llegando al Inbox, aunque las lineas figuren WORKING. Solucion: en el VPS corre  bash /opt/publilat/deploy/update-waha.sh  (actualiza WAHA). Ver RUNBOOK.md seccion 'No entran mensajes al Inbox'."}
JSON
