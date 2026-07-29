#!/usr/bin/env bash
# =============================================================================
# migrate-import.sh — IMPORTA el estado de Publi.lat en el server NUEVO (DigitalOcean).
#
# Pre-requisitos en el server nuevo (ver deploy/MIGRACION-DIGITALOCEAN.md):
#   1) Docker + docker compose instalados.
#   2) Repo clonado en /opt/publilat  (git clone …).
#   3) Paquete de migración copiado (scp) a /root/publilat-migracion-*.tar.gz
#   4) Postgres NUEVO levantado y vacío:  docker compose -f docker-compose.vps.yml up -d postgres
#
# Uso (en el VPS nuevo):
#   cd /opt/publilat && bash deploy/migrate-import.sh /root/publilat-migracion-<fecha>.tar.gz
#
# OJO: PISA los datos del server nuevo. Corré esto en un server LIMPIO.
# =============================================================================
set -euo pipefail

PKG="${1:-}"
if [[ -z "$PKG" || ! -f "$PKG" ]]; then
  echo "Uso: bash deploy/migrate-import.sh /ruta/al/publilat-migracion-<fecha>.tar.gz" >&2
  exit 1
fi

COMPOSE="docker compose -f docker-compose.vps.yml"
PROJECT="${COMPOSE_PROJECT_NAME:-publilat}"
WORK="/root/migracion-import"
FILE_VOLS=(waha_sessions evolution_instances tutorial_videos redisdata)

echo "==> Desempaquetando $PKG en $WORK"
rm -rf "$WORK"; mkdir -p "$WORK"
tar xzf "$PKG" -C "$WORK"

# --- 0) .env ---
if [[ -f "$WORK/env.backup" ]]; then
  echo "==> [0/3] Instalando .env"
  cp "$WORK/env.backup" /opt/publilat/.env
  chmod 600 /opt/publilat/.env
else
  echo "    !! no vino env.backup en el paquete — cargá el .env a mano antes de seguir" >&2
fi

# --- 1) Postgres: restaurar el dump lógico ---
echo "==> [1/3] Restaurando Postgres (publilat + evolution)…"
echo "    esperando a que postgres esté healthy…"
for i in $(seq 1 30); do
  if $COMPOSE exec -T postgres pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 2
done
# init.sql pudo crear las DBs vacías; las dropeamos para que el dump las recree con datos.
$COMPOSE exec -T postgres psql -U postgres -v ON_ERROR_STOP=0 \
  -c "DROP DATABASE IF EXISTS publilat;" \
  -c "DROP DATABASE IF EXISTS evolution;" || true
gunzip -c "$WORK/pg_all.sql.gz" | $COMPOSE exec -T postgres psql -U postgres -v ON_ERROR_STOP=0
echo "    OK Postgres restaurado"

# --- 2) Volúmenes de archivos ---
echo "==> [2/3] Restaurando volúmenes de archivos…"
for v in "${FILE_VOLS[@]}"; do
  src="$WORK/${v}.tar.gz"
  [[ -f "$src" ]] || { echo "    (saltado: no vino $v.tar.gz)"; continue; }
  vol="${PROJECT}_${v}"
  docker volume create "$vol" >/dev/null
  docker run --rm -v "${vol}:/v" -v "$WORK:/backup" alpine \
    sh -c "rm -rf /v/* /v/..?* 2>/dev/null; tar xzf /backup/${v}.tar.gz -C /v"
  echo "    OK  ${v}"
done

# --- 3) Levantar todo ---
echo "==> [3/3] Levantando la app (build)…"
$COMPOSE up -d --build

echo ""
echo "============================================================"
echo " LISTO. Verificá:"
echo "   curl -s http://localhost:4010/health"
echo "   $COMPOSE ps"
echo "   # sesiones WhatsApp (WAHA): pueden pedir re-escaneo de QR"
echo "   $COMPOSE logs --tail=50 waha"
echo ""
echo " Si las líneas piden QR: re-escanealas desde el panel (Admin → Líneas)."
echo " Recién cuando /health y las sesiones estén OK, cambiá el DNS (ver runbook)."
echo "============================================================"
