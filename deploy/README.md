# Deploying Sportline

Production runs as two Docker containers behind the server's existing public
Nginx — the same pattern as the other apps on this host.

```
 Internet ──https──▶ host Nginx (:443, Certbot)
                         │  proxy_pass 127.0.0.1:${WEB_PORT}
                         ▼
                  web container (nginx)  ──serves SPA
                         │  proxy /api + /uploads ──▶ api container (:3001)
                         ▼
                  api container (NestJS) ──▶ host Postgres (Unix socket)
```

- **No Redis** — the app doesn't use it.
- **Postgres** is the host's existing instance, reached over the bind-mounted
  Unix socket (`/var/run/postgresql`); nothing is exposed over TCP.
- **TLS + the subdomain** are owned by the host Nginx (Certbot), not the containers.

## Files
| File | Purpose |
|---|---|
| `apps/api/Dockerfile` | NestJS API image (also runs migrations) |
| `apps/web/Dockerfile` + `apps/web/nginx.conf` | SPA build + nginx web tier |
| `docker-compose.prod.yml` | the stack (`api`, `web`, `migrate`) |
| `.env.production.example` | env template → copy to `.env` on the server |
| `deploy/nginx-site.conf.template` | host Nginx server block (sudo) |
| `deploy/deploy.sh` | sync + build + migrate + up |

## One-time setup (on the server)

1. **Database + roles.** As a Postgres admin, create the app database and the
   admin/owner role (the restricted `sportsbooking_app` runtime role is created
   automatically by `db:push`):
   ```sql
   CREATE ROLE sportline_admin LOGIN PASSWORD '<admin-pw>' CREATEROLE;
   CREATE DATABASE sportsbooking OWNER sportline_admin;
   ```
   The runtime role password must match `DATABASE_URL` in `.env`
   (default name `sportsbooking_app`, set in `apps/api/src/db/role-setup.sql`).

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

   The restricted runtime role's password is rotated to match `DATABASE_URL`
   automatically by `db:set-app-password` (run after `db:push` in `deploy.sh`),
   so the weak bootstrap default from `role-setup.sql` is never the live secret.

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
# first deploy — also applies schema/RLS and seeds demo data
SEED=1 MIGRATE=1 ./deploy/deploy.sh

# subsequent deploys — code only
./deploy/deploy.sh

# later, if the schema changed
MIGRATE=1 ./deploy/deploy.sh
```

`deploy.sh` rsyncs the working tree (no `node_modules`/`.git`/`.env`), builds the
images, optionally runs `db:push`/`db:seed`, brings the stack up, and curls
`/api/healthz`.

## Operating
```bash
ssh e2e-server 'cd ~/sportsbooking && docker compose -f docker-compose.prod.yml ps'
ssh e2e-server 'cd ~/sportsbooking && docker compose -f docker-compose.prod.yml logs -f --tail=100'
```
