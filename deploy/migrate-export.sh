#!/usr/bin/env bash
# =============================================================================
# migrate-export.sh — EXPORTA todo el estado de Publi.lat desde el VPS ACTUAL
# (Hostinger) a un paquete listo para copiar al server NUEVO (DigitalOcean).
#
# Qué exporta:
#   - Postgres COMPLETO (pg_dumpall): DBs publilat + evolution + roles.
#   - Volúmenes de archivos: waha_sessions, evolution_instances, tutorial_videos, redisdata.
#   - .env (secretos) — TRATALO COMO CONTRASEÑA.
#
# Uso (en el VPS viejo):
#   cd /opt/publilat && bash deploy/migrate-export.sh
#   # deja un tar en /opt/publilat/migracion/<fecha>.tar.gz + imprime el scp para el server nuevo
#
# NO corta el servicio: pg_dumpall y el tar de volúmenes se hacen en caliente.
# =============================================================================
set -euo pipefail

COMPOSE="docker compose -f docker-compose.vps.yml"
PROJECT="${COMPOSE_PROJECT_NAME:-publilat}"   # prefijo de los volúmenes docker (basename del dir)
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="/opt/publilat/migracion/$STAMP"
FILE_VOLS=(waha_sessions evolution_instances tutorial_videos redisdata)

echo "==> Exportando a $OUT (proyecto docker: $PROJECT)"
mkdir -p "$OUT"

# --- 1) Postgres: dump lógico de TODO el cluster (incluye publilat + evolution) ---
echo "==> [1/4] pg_dumpall (publilat + evolution + roles)…"
$COMPOSE exec -T postgres pg_dumpall -U postgres | gzip > "$OUT/pg_all.sql.gz"
echo "    OK  $(du -h "$OUT/pg_all.sql.gz" | cut -f1)"

# --- 2) Volúmenes de archivos (sesiones WAHA/Evolution, tutoriales, redis) ---
echo "==> [2/4] Tar de volúmenes de archivos…"
for v in "${FILE_VOLS[@]}"; do
  vol="${PROJECT}_${v}"
  if ! docker volume inspect "$vol" >/dev/null 2>&1; then
    echo "    !! volumen $vol NO existe — reviso el nombre (¿COMPOSE_PROJECT_NAME correcto?)" >&2
    docker volume ls --format '{{.Name}}' | grep -E "$v" || true
    exit 1
  fi
  docker run --rm -v "${vol}:/v:ro" -v "$OUT:/backup" alpine \
    tar czf "/backup/${v}.tar.gz" -C /v . 2>/dev/null
  echo "    OK  ${v}  $(du -h "$OUT/${v}.tar.gz" | cut -f1)"
done

# --- 3) .env (secretos) ---
echo "==> [3/4] Copiando .env…"
cp /opt/publilat/.env "$OUT/env.backup"
chmod 600 "$OUT/env.backup"
echo "    OK  (SECRETO — no lo compartas)"

# --- 4) Empaquetar todo en un solo tar ---
echo "==> [4/4] Empaquetando…"
PKG="/opt/publilat/migracion/publilat-migracion-${STAMP}.tar.gz"
tar czf "$PKG" -C "$OUT" .
echo ""
echo "============================================================"
echo " LISTO. Paquete: $PKG"
echo " Tamaño: $(du -h "$PKG" | cut -f1)"
echo ""
echo " Copialo al server NUEVO (DigitalOcean):"
echo "   scp -i ~/.ssh/publilat_deploy $PKG root@<IP_NUEVA>:/root/"
echo ""
echo " Después, en el server nuevo, seguí deploy/MIGRACION-DIGITALOCEAN.md"
echo "============================================================"
