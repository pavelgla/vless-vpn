#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-${SCRIPT_DIR}/backups}"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
FILENAME="vpndb_${DATE}.sql.gz"

mkdir -p "$BACKUP_DIR"

# Load .env if present
if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  # shellcheck disable=SC1091
  set -a; source "${SCRIPT_DIR}/.env"; set +a
fi

: "${DB_PASSWORD:?DB_PASSWORD is not set}"
: "${DB_NAME:=vpndb}"
: "${DB_USER:=vpnuser}"

echo "[backup] Dumping ${DB_NAME} → ${BACKUP_DIR}/${FILENAME}"

docker compose -f "${SCRIPT_DIR}/docker-compose.yml" exec -T db \
  pg_dump -U "$DB_USER" "$DB_NAME" \
  | gzip > "${BACKUP_DIR}/${FILENAME}"

SIZE=$(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1)
echo "[backup] Done: ${FILENAME} (${SIZE})"

# Keep last 30 backups, remove older ones
find "$BACKUP_DIR" -name 'vpndb_*.sql.gz' -type f | \
  sort | head -n -30 | xargs -r rm -v

echo "[backup] Cleanup done. Backups kept: $(find "$BACKUP_DIR" -name '*.sql.gz' | wc -l)"
