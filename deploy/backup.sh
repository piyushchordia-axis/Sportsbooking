#!/usr/bin/env bash
# Sportline backup: nightly Postgres dump + uploads volume snapshot with local
# retention and an optional offsite copy. Runs ON THE SERVER (host Postgres +
# the sb_uploads docker volume live there) — install it as a cron, e.g.:
#
#   # /etc/cron.d/sportsbooking-backup  (runs 02:30 daily)
#   30 2 * * *  ubuntu  cd /home/ubuntu/sportsbooking && ./deploy/backup.sh >> /home/ubuntu/sportsbooking-backup.log 2>&1
#
# It reads DATABASE_ADMIN_URL from the app .env (same dir), so it never hardcodes
# credentials. Restore instructions are in deploy/README.md ("Backups").
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/backups/sportsbooking}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
UPLOADS_VOLUME="${UPLOADS_VOLUME:-sportsbooking_sb_uploads}"   # compose project 'sportsbooking' + volume 'sb_uploads'
# Optional offsite: set OFFSITE_DEST to an rsync target (user@host:/path) or an
# S3 URI (s3://bucket/prefix). Left empty = local-only (set one before go-live).
OFFSITE_DEST="${OFFSITE_DEST:-}"

# Timestamp is passed in or computed here (backups run outside the app, so a
# shell date is fine — the app code avoids Date.now() for other reasons).
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# --- resolve the DB connection (admin role) from the app .env ---------------
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found — run from the app dir or set ENV_FILE" >&2
  exit 1
fi
DB_URL="$(grep -E '^DATABASE_ADMIN_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
[ -n "$DB_URL" ] || DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [ -z "$DB_URL" ]; then
  echo "ERROR: no DATABASE_ADMIN_URL/DATABASE_URL in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
DB_DUMP="$BACKUP_DIR/db-$STAMP.sql.gz"
UP_DUMP="$BACKUP_DIR/uploads-$STAMP.tgz"

# --- 1) Postgres dump (custom-plain SQL, gzipped) ---------------------------
# pg_dump runs from the api image (has the pg client) to avoid needing a host
# postgres-client install; falls back to a host pg_dump if present.
echo "==> pg_dump -> $DB_DUMP"
if command -v pg_dump >/dev/null 2>&1; then
  pg_dump "$DB_URL" | gzip -9 > "$DB_DUMP"
else
  docker run --rm --network host -e DB_URL="$DB_URL" postgres:16 \
    sh -c 'pg_dump "$DB_URL"' | gzip -9 > "$DB_DUMP"
fi

# --- 2) uploads volume snapshot ---------------------------------------------
echo "==> uploads volume ($UPLOADS_VOLUME) -> $UP_DUMP"
if docker volume inspect "$UPLOADS_VOLUME" >/dev/null 2>&1; then
  docker run --rm -v "$UPLOADS_VOLUME":/data:ro -v "$BACKUP_DIR":/backup alpine \
    tar czf "/backup/uploads-$STAMP.tgz" -C /data .
else
  echo "WARN: volume $UPLOADS_VOLUME not found — skipping uploads (set UPLOADS_VOLUME)" >&2
fi

# --- 3) retention (local) ----------------------------------------------------
echo "==> pruning local backups older than ${RETENTION_DAYS}d"
find "$BACKUP_DIR" -maxdepth 1 -name 'db-*.sql.gz'   -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'uploads-*.tgz' -mtime +"$RETENTION_DAYS" -delete

# --- 4) offsite copy (optional but STRONGLY recommended before go-live) ------
if [ -n "$OFFSITE_DEST" ]; then
  echo "==> offsite copy -> $OFFSITE_DEST"
  case "$OFFSITE_DEST" in
    s3://*) aws s3 cp "$DB_DUMP" "$OFFSITE_DEST/" && [ -f "$UP_DUMP" ] && aws s3 cp "$UP_DUMP" "$OFFSITE_DEST/" || true ;;
    *)      rsync -az "$DB_DUMP" "$UP_DUMP" "$OFFSITE_DEST/" 2>/dev/null || rsync -az "$DB_DUMP" "$OFFSITE_DEST/" ;;
  esac
else
  echo "WARN: OFFSITE_DEST is unset — backups are LOCAL ONLY (single point of failure). Set it before go-live." >&2
fi

echo "==> Done: $DB_DUMP $( [ -f "$UP_DUMP" ] && echo "$UP_DUMP" )"
