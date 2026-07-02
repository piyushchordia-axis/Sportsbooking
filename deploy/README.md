# Deploying Sportline

Production runs as two Docker containers behind the server's existing public
Nginx — the same pattern as the other apps on this host.

```
 Internet ──https──▶ host Nginx (:443, Certbot)
                         │  proxy_pass 127.0.0.1:8093
                         ▼
                  web container (nginx, host net, 127.0.0.1:8093) ──serves SPA
                         │  proxy /api + /uploads ──▶ 127.0.0.1:3001
                         ▼
                  api container (NestJS, host net, 127.0.0.1:3001)
                         │
                         ▼  127.0.0.1:5432 (TCP, password auth)
                  host Postgres
```

- **No Redis** — the app doesn't use it.
- **Host networking** — both containers run on the host net and bind `127.0.0.1`
  only (nothing public). This lets the restricted `sportsbooking_app` role reach
  Postgres on `127.0.0.1:5432` with password auth, so **RLS stays enforced** (RLS
  is ENABLEd + FORCEd; the runtime role is NOBYPASSRLS). The admin/owner role is
  used only for migrations + seed.
- **TLS + the subdomain** are owned by the host Nginx (Certbot), not the containers.

## Files
| File | Purpose |
|---|---|
| `apps/api/Dockerfile` | NestJS API image (also runs migrations) |
| `apps/web/Dockerfile` + `apps/web/nginx.conf` | SPA build + nginx web tier |
| `docker-compose.prod.yml` | the stack (`api`, `web`, `migrate`) |
| `.env.production.example` | env template → copy to `.env` on the server |
| `deploy/nginx-site.conf.template` | host Nginx server block (sudo) |
| `deploy/deploy.sh` | ship committed ref + build SHA-tagged images + migrate + up |
| `deploy/rollback.sh` | re-point the stack at a prior image tag |
| `deploy/backup.sh` | nightly pg_dump + uploads snapshot (cron) |

## One-time setup (on the server)

1. **Database + roles.** As a Postgres admin, create the app database and the
   admin/owner role. `db:push` (run as this admin role) then creates the
   restricted runtime role `sportsbooking_app` automatically from
   `apps/api/src/db/role-setup.sql` — the admin role needs `CREATEROLE` for that:
   ```sql
   CREATE ROLE sportline_admin LOGIN PASSWORD '<admin-pw>' CREATEROLE;
   CREATE DATABASE sportsbooking OWNER sportline_admin;
   ```
   The API connects as `sportsbooking_app` (NOSUPERUSER, NOBYPASSRLS,
   NOCREATEROLE), so RLS (ENABLEd + FORCEd) is the tenant-isolation backstop
   behind the in-code ownerId scoping. `db:set-app-password` (run by `deploy.sh`
   after `db:push`) rotates the role's bootstrap password to the secret in
   `DATABASE_URL`. If the admin role lacks `CREATEROLE`, run `db:push` with
   `SKIP_APP_ROLE=true` and create `sportsbooking_app` manually as a superuser
   (see `role-setup.sql`).

2. **`.env`.** On the server, in the app dir:
   ```bash
   cp .env.production.example .env
   # fill DATABASE_URL (sportsbooking_app), DATABASE_ADMIN_URL (sportline_admin),
   # JWT_SECRET (openssl rand -base64 48), WEB_ORIGIN, WEB_PORT,
   # STORAGE_LOCAL_BASE_URL (https://SUBDOMAIN/uploads),
   # and SMS: NOTIFICATION_DRIVER=live + SMS_API_URL (+ SMS_API_KEY)
   ```
   **SMS is required for player login** — the API refuses to boot in production
   with the default `log` driver (the OTP would silently never arrive). To bring
   the console up first without SMS, set `ALLOW_NO_SMS=true` (player OTP login
   stays disabled until you configure a gateway).

3. **DNS.** Point `SUBDOMAIN.enaacreations.com` (A record) at the server.

4. **Host Nginx + TLS** (sudo):
   ```bash
   sudo cp deploy/nginx-site.conf.template /etc/nginx/sites-available/sportline.conf
   sudoedit /etc/nginx/sites-available/sportline.conf   # set server_name + WEB_PORT
   sudo ln -sf /etc/nginx/sites-available/sportline.conf /etc/nginx/sites-enabled/sportline.conf
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d SUBDOMAIN.enaacreations.com
   ```

## Deploy

From a checkout on your machine:
```bash
# first deploy (fresh DB — nothing to back up yet, so skip the pre-migration backup)
SEED=1 MIGRATE=1 SKIP_BACKUP=1 ./deploy/deploy.sh

# subsequent deploys — code only
./deploy/deploy.sh

# later, if the schema changed (backs up first, then db:migrate)
MIGRATE=1 ./deploy/deploy.sh
```

`deploy.sh` ships the **committed** ref (via `git archive`, refusing a dirty tree
unless `ALLOW_DIRTY=1`), builds images **tagged with the git short SHA**, optionally
backs up + runs `db:migrate`/`db:seed`, starts the stack on that tag, records the
SHA in `deploys.log`, and curls `/api/healthz`. Deploy a specific commit with
`REF=<sha|tag> ./deploy/deploy.sh`.

### Rollback
Prior image tags stay on the server, so rollback is instant (no rebuild):
```bash
ssh e2e-server 'tail ~/sportsbooking/deploys.log'   # find the previous good SHA
./deploy/rollback.sh <previous-sha>
```
⚠️ Rollback reverts **code only** — it does not undo DB migrations. If the deploy
you're reverting ran `MIGRATE=1`, restore the pre-migration backup (`deploy/backup.sh`
writes one before every migration) instead of just rolling back the image.

## Migrations

Schema changes ship as **reviewed versioned migrations**, not `push --force`.

- **Change the schema:** edit `src/db/schema.ts`, then `pnpm --filter
  @sportsbooking/api db:generate` → review the new `drizzle/NNNN_*.sql` → commit
  it. Never edit an already-shipped migration.
- **Apply on deploy:** `MIGRATE=1 ./deploy/deploy.sh` backs up first, then runs
  `db:migrate` (applies only pending `drizzle/*.sql`, then RLS policies + FORCE +
  the runtime role). No auto-approve, so a rename can't become a silent drop.
- **ONE-TIME cutover for the existing prod DB** (built by the old `db:push`, so it
  has the schema but no migrations table). Baseline it once so `migrate` doesn't
  try to recreate existing tables:
  ```bash
  ssh e2e-server 'cd ~/sportsbooking && docker compose -f docker-compose.prod.yml \
    --profile tools run --rm migrate pnpm db:baseline'
  ```
  Then `MIGRATE=1 ./deploy/deploy.sh` from then on. A FRESH DB skips this — its
  first `db:migrate` runs the baseline migration normally.
- `db:push` remains for local dev only (fast, auto-approve); never on prod data.

## Operating
```bash
ssh e2e-server 'cd ~/sportsbooking && docker compose -f docker-compose.prod.yml ps'
ssh e2e-server 'cd ~/sportsbooking && docker compose -f docker-compose.prod.yml logs -f --tail=100'
```

## Backups

`deploy/backup.sh` runs on the server and writes a gzipped `pg_dump` + a tar of
the `sb_uploads` volume to `$BACKUP_DIR` (default `/home/ubuntu/backups/
sportsbooking`), prunes local copies older than `$RETENTION_DAYS` (14), and — if
`OFFSITE_DEST` is set — copies them offsite (rsync target or `s3://bucket/prefix`).
It reads `DATABASE_ADMIN_URL` from `.env`, so no credentials are hardcoded.

**Set up (one-time):**
```bash
# 1) confirm the uploads volume name (compose prefixes the project name):
ssh e2e-server 'docker volume ls | grep sb_uploads'   # e.g. sportsbooking_sb_uploads
# 2) pick an offsite target and install the cron (runs 02:30 daily):
ssh e2e-server 'sudo tee /etc/cron.d/sportsbooking-backup >/dev/null' <<'CRON'
OFFSITE_DEST=__FILL__            # e.g. user@backup-host:/srv/backups/sportsbooking  OR  s3://bucket/sportsbooking
30 2 * * *  ubuntu  cd /home/ubuntu/sportsbooking && OFFSITE_DEST="$OFFSITE_DEST" ./deploy/backup.sh >> /home/ubuntu/sportsbooking-backup.log 2>&1
CRON
# 3) smoke-test it once by hand:
ssh e2e-server 'cd ~/sportsbooking && ./deploy/backup.sh'
```
⚠️ Leave `OFFSITE_DEST` unset and backups are LOCAL ONLY (lost with the host).
Set an offsite target before go-live.

**Restore:**
```bash
# database (stop the api first so nothing writes mid-restore):
gunzip -c db-<STAMP>.sql.gz | psql "$DATABASE_ADMIN_URL"
# uploads volume:
docker run --rm -v sportsbooking_sb_uploads:/data -v "$PWD":/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/uploads-<STAMP>.tgz -C /data'
```
Test a restore into a scratch database periodically — an untested backup is not a
backup.
