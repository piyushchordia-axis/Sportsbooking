#!/usr/bin/env bash
# Sportline deploy: ship a COMMITTED git ref to the server, build SHA-tagged
# images, (optionally) back up + migrate, and (re)start the stack. Idempotent.
#
# Every deploy maps to a commit: images are tagged with the short git SHA and the
# running stack points at that tag, so rollback = start a previous tag (no
# rebuild). Deploying the working tree (uncommitted changes) is refused unless
# ALLOW_DIRTY=1.
#
# Prereqs (one-time, see deploy/README.md):
#   - SSH alias reachable (default: e2e-server)
#   - The app DB + roles exist, and ~/sportsbooking/.env is filled in on the server
#   - The host Nginx site + cert are in place (deploy/nginx-site.conf.template)
#
# Usage:
#   ./deploy/deploy.sh                          # deploy HEAD (code only)
#   REF=<sha|tag|branch> ./deploy/deploy.sh     # deploy a specific committed ref
#   MIGRATE=1 ./deploy/deploy.sh                # back up, then db:migrate
#   SEED=1 MIGRATE=1 SKIP_BACKUP=1 ./deploy/deploy.sh   # first deploy (fresh DB)
#   ALLOW_DIRTY=1 ./deploy/deploy.sh            # deploy a dirty tree (discouraged)
# Roll back:
#   ./deploy/rollback.sh <previous-sha>         # see $REMOTE_DIR/deploys.log
set -euo pipefail

SSH_HOST="${SSH_HOST:-e2e-server}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/sportsbooking}"
COMPOSE="docker compose -f docker-compose.prod.yml"
REF="${REF:-HEAD}"

here() { cd "$(dirname "$0")/.."; }
here

# Resolve the ref to a short SHA and refuse a dirty tree, so the running image
# always maps to a commit. ALLOW_DIRTY=1 overrides (e.g. an emergency hotfix).
GIT_SHA="$(git rev-parse --short "$REF")"
if [ "$REF" = "HEAD" ] && ! git diff-index --quiet HEAD -- && [ "${ALLOW_DIRTY:-0}" != "1" ]; then
  echo "ERROR: working tree is dirty — commit your changes or set ALLOW_DIRTY=1 (discouraged)." >&2
  exit 1
fi
IMAGE_TAG="$GIT_SHA"
CENV="IMAGE_TAG=$IMAGE_TAG"   # threaded into remote compose calls so they use this build
echo "==> Deploying ref $REF ($GIT_SHA) to ${SSH_HOST}:${REMOTE_DIR}"

# Ship the COMMITTED tree (not the working dir): export the ref to a clean temp
# dir, then rsync that with --delete (keeping the server's .env). The image build
# is fresh, so node_modules/dist aren't shipped; git archive omits untracked files.
ssh "$SSH_HOST" "mkdir -p '$REMOTE_DIR'"
EXPORT_DIR="$(mktemp -d)"
trap 'rm -rf "$EXPORT_DIR"' EXIT
git archive "$REF" | tar -x -C "$EXPORT_DIR"
# --delete mirrors the export, but keep server-only files: .env (secrets) and
# deploys.log (rollback history) live only on the server, not in git.
rsync -az --delete --exclude '.env' --exclude 'deploys.log' "$EXPORT_DIR/" "${SSH_HOST}:${REMOTE_DIR}/"

echo "==> Building images ($IMAGE_TAG) on the server"
ssh "$SSH_HOST" "cd '$REMOTE_DIR' && test -f .env || { echo 'ERROR: $REMOTE_DIR/.env missing — copy .env.production.example and fill it in'; exit 1; }"
ssh "$SSH_HOST" "cd '$REMOTE_DIR' && $CENV $COMPOSE build"
# Move :latest to this build (convenience/fallback for the default compose tag).
ssh "$SSH_HOST" "docker tag sportsbooking-api:$IMAGE_TAG sportsbooking-api:latest && docker tag sportsbooking-web:$IMAGE_TAG sportsbooking-web:latest"

if [ "${MIGRATE:-0}" = "1" ]; then
  # Back up BEFORE any schema change — a migration is the one operation that can
  # lose data, so we snapshot first. SKIP_BACKUP=1 bypasses (first deploy on a
  # fresh DB, where there's nothing to back up).
  if [ "${SKIP_BACKUP:-0}" != "1" ]; then
    echo "==> Backing up before migration (deploy/backup.sh)"
    ssh "$SSH_HOST" "cd '$REMOTE_DIR' && ./deploy/backup.sh" || {
      echo "ERROR: pre-migration backup failed — aborting. Fix backups or re-run with SKIP_BACKUP=1 (fresh DB only)." >&2; exit 1; }
  fi
  # db:migrate applies ONLY the reviewed SQL in drizzle/*.sql (no `push --force`,
  # so a rename can't be applied as a silent drop), then the RLS policies + FORCE
  # and the runtime role.
  # ONE-TIME per existing DB (built by the old db:push): run the baseline first so
  # migrate doesn't try to recreate existing tables —
  #   ssh $SSH_HOST "cd $REMOTE_DIR && $CENV $COMPOSE --profile tools run --rm migrate pnpm db:baseline"
  echo "==> Applying migrations + RLS + runtime role (db:migrate)"
  ssh "$SSH_HOST" "cd '$REMOTE_DIR' && $CENV $COMPOSE --profile tools run --rm migrate"
  # Rotate sportsbooking_app's bootstrap password to the DATABASE_URL secret so
  # the live runtime password is never the weak default. Idempotent.
  echo "==> Rotating runtime DB role password to match DATABASE_URL"
  ssh "$SSH_HOST" "cd '$REMOTE_DIR' && $CENV $COMPOSE --profile tools run --rm migrate pnpm db:set-app-password"
fi

if [ "${SEED:-0}" = "1" ]; then
  echo "==> Seeding demo data (db:seed)"
  ssh "$SSH_HOST" "cd '$REMOTE_DIR' && $CENV $COMPOSE --profile tools run --rm migrate pnpm db:seed"
fi

echo "==> Starting the stack ($IMAGE_TAG)"
ssh "$SSH_HOST" "cd '$REMOTE_DIR' && $CENV $COMPOSE up -d"

# Record the deploy so rollback knows prior good SHAs (append-only history).
ssh "$SSH_HOST" "cd '$REMOTE_DIR' && printf '%s  %s\n' \"\$(date -u +%FT%TZ)\" '$IMAGE_TAG' >> deploys.log"

echo "==> Health check"
ssh "$SSH_HOST" "cd '$REMOTE_DIR' && sleep 6 && curl -fsS http://127.0.0.1:\$(grep -E '^WEB_PORT=' .env | cut -d= -f2)/api/healthz && echo" || {
  echo 'Health check failed — inspect: ssh '"$SSH_HOST"' "cd '"$REMOTE_DIR"' && '"$COMPOSE"' logs --tail=80"' >&2
  echo "Roll back with: ./deploy/rollback.sh <previous-sha>  (see $REMOTE_DIR/deploys.log)" >&2
  exit 1; }

echo "==> Done. Deployed $IMAGE_TAG."
echo "    Roll back with:  ./deploy/rollback.sh <previous-sha>   (history: $REMOTE_DIR/deploys.log)"
