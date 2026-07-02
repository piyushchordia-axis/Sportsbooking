#!/usr/bin/env bash
# Roll the running stack back to a previously-built image tag (git short SHA).
# Deploys keep prior image tags on the server until pruned, so rollback is just
# `up -d` with an older IMAGE_TAG — no rebuild.
#
# Usage:
#   ./deploy/rollback.sh <sha>        # see prior deploys in $REMOTE_DIR/deploys.log
#
# ⚠️ This reverts CODE only. It does NOT undo database migrations. If the deploy
#    you're rolling back from ran a migration, restore the pre-migration backup
#    (deploy/backup.sh writes one before every MIGRATE=1 deploy).
set -euo pipefail

SSH_HOST="${SSH_HOST:-e2e-server}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/sportsbooking}"
COMPOSE="docker compose -f docker-compose.prod.yml"
TAG="${1:-}"

if [ -z "$TAG" ]; then
  echo "usage: $0 <image-tag/sha>" >&2
  echo "recent deploys:" >&2
  ssh "$SSH_HOST" "tail -n 10 '$REMOTE_DIR/deploys.log' 2>/dev/null" || true
  exit 1
fi

echo "==> Verifying sportsbooking-{api,web}:$TAG exist on $SSH_HOST"
if ! ssh "$SSH_HOST" "docker image inspect sportsbooking-api:$TAG >/dev/null 2>&1 && docker image inspect sportsbooking-web:$TAG >/dev/null 2>&1"; then
  echo "ERROR: image tag '$TAG' not found on the server. Available:" >&2
  ssh "$SSH_HOST" "docker image ls --format '{{.Repository}}:{{.Tag}}' | grep '^sportsbooking-'" >&2 || true
  exit 1
fi

echo "==> Rolling back to $TAG"
ssh "$SSH_HOST" "cd '$REMOTE_DIR' && IMAGE_TAG=$TAG $COMPOSE up -d"
ssh "$SSH_HOST" "cd '$REMOTE_DIR' && printf '%s  %s (rollback)\n' \"\$(date -u +%FT%TZ)\" '$TAG' >> deploys.log"

echo "==> Health check"
ssh "$SSH_HOST" "cd '$REMOTE_DIR' && sleep 6 && curl -fsS http://127.0.0.1:\$(grep -E '^WEB_PORT=' .env | cut -d= -f2)/api/healthz && echo" || {
  echo 'Health check failed after rollback — inspect the logs.' >&2; exit 1; }

echo "==> Done. Now running $TAG (code only — DB migrations are NOT reverted)."
