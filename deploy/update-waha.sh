#!/usr/bin/env bash
# Actualiza WAHA de forma SEGURA: baja la última imagen, recrea, espera y VERIFICA que las sesiones
# vuelvan a WORKING y que NO reaparezca el crash de mensajes entrantes (parseMessageIdSerialized).
# Correr cada tanto en HORARIO DE BAJO TRÁFICO (WhatsApp cambia su protocolo y WAHA viejo se rompe).
#   Uso:  bash /opt/publilat/deploy/update-waha.sh
set -e
cd /opt/publilat
C="docker compose -f docker-compose.vps.yml"

echo "[waha-update] bajando devlikeapro/waha:latest ..."
docker pull devlikeapro/waha:latest >/dev/null
NEW=$(docker inspect --format '{{index .RepoDigests 0}}' devlikeapro/waha:latest)
echo "[waha-update] imagen nueva: $NEW"

echo "[waha-update] recreando WAHA con la imagen nueva..."
WAHA_IMAGE="devlikeapro/waha:latest" $C up -d waha

echo "[waha-update] esperando reconexión de sesiones (~80s)..."
sleep 80

echo "[waha-update] estado de sesiones:"
$C exec -T app node -e "fetch((process.env.WAHA_BASE_URL||'http://waha:3000')+'/api/sessions',{headers:{'X-Api-Key':process.env.WAHA_API_KEY||''}}).then(r=>r.json()).then(s=>console.log(s.map(x=>x.name+':'+x.status).join('  '))).catch(e=>console.log('ERR',e.message))" || true

echo "[waha-update] ¿reaparece el crash?"
if $C logs waha --since 2m 2>/dev/null | grep -qiE 'parseMessageIdSerialized|Cannot read properties of undefined'; then
  echo "  ⚠️  REAPARECE el crash con esta versión. NO la pinees; probá otra o pedí ayuda."
else
  echo "  ✅ OK, sin crash."
fi

echo ""
echo "[waha-update] Si quedó OK, PINEÁ la versión nueva en docker-compose.vps.yml (línea image de waha):"
echo "    image: \${WAHA_IMAGE:-$NEW}"
echo "  y comiteá el cambio. Después mandá un WhatsApp de prueba a una línea y verificá que entre."
