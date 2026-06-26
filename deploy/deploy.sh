#!/usr/bin/env bash
# Sportline deploy: sync the working tree to the server, build the images, apply
# the schema/RLS, and (re)start the stack. Idempotent + re-runnable.
#
# Prereqs (one-time, see deploy/README.md):
#   - SSH alias reachable (default: e2e-server)
#   - The app DB + roles exist, and ~/sportsbooking/.env is filled in on the server
#   - The host Nginx site + cert are in place (deploy/nginx-site.conf.template)
#
# Usage:
#   ./deploy/deploy.sh                 # sync + build + up (no migration)
#   MIGRATE=1 ./deploy/deploy.sh       # also run db:push (schema + RLS)
#   SEED=1 MIGRATE=1 ./deploy/deploy.sh# also seed demo data (first deploy only)
set -euo pipefail

SSH_HOST="${SSH_HOST:-e2e-server}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/sportsbooking}"
COMPOSE="docker compose -f docker-compose.prod.yml"

here() { cd "$(dirname "$0")/.."; }
here

echo "==> Syncing working tree to ${SSH_HOST}:${REMOTE_DIR}"
ssh "$SSH_HOST" "mkdir -p '$REMOTE_DIR'"
# Never ship node_modules/dist/.git/.env — the image builds fresh; .env lives
# only on the server. --delete keeps the remote tree an exact mirror of source.
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '**/node_modules' \
  --exclude '**/dist' \
  --exclude '.turbo' \
  --exclude '**/.turbo' \
  --exclude 'test-results' \
  --exclude 'playwright-report' \
  --exclude '.env' \
  ./ "${SSH_HOST}:${REMOTE_DIR}/"

echo "==> Building images on the server"
ssh "$SSH_HOST" "cd '$REMOTE_DIR' && test -f .env || { echo 'ERROR: $REMOTE_DIR/.env missing — copy .env.production.example and fill it in'; exit 1; }"
ssh "$SSH_HOST" "cd '$REMOTE_DIR' && $COMPOSE build"

if [ "${MIGRATE:-0}" = "1" ]; then
  # NOTE: db:push runs `drizzle-kit push --force` — it auto-approves schema
  # changes. Safe on a FRESH database (first deploy). On an existing DB with
  # data, review the diff first (run `pnpm db:push -- --strict` manually) so a
  # column/table rename isn't silently dropped.
  echo "==> Applying schema + RLS (db:push)"
  ssh "$SSH_HOST" "cd '$REMOTE_DIR' && $COMPOSE --profile tools run --rm migrate"
fi

if [ "${SEED:-0}" = "1" ]; then
  echo "==> Seeding demo data (db:seed)"
  ssh "$SSH_HOST" "cd '$REMOTE_DIR' && $COMPOSE --profile tools run --rm migrate pnpm db:seed"
fi

echo "==> Starting the stack"
ssh "$SSH_HOST" "cd '$REMOTE_DIR' && $COMPOSE up -d"

echo "==> Health check"
ssh "$SSH_HOST" "cd '$REMOTE_DIR' && sleep 6 && curl -fsS http://127.0.0.1:\$(grep -E '^WEB_PORT=' .env | cut -d= -f2)/api/healthz && echo" || {
  echo 'Health check failed — inspect: ssh '"$SSH_HOST"' "cd '"$REMOTE_DIR"' && '"$COMPOSE"' logs --tail=80"'; exit 1; }

echo "==> Done."
