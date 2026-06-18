# End-to-end tests (Playwright)

These specs drive the real React app at `http://localhost:5173` against a live
API (`:3001`) and seeded Postgres. They cover the key role flows:

| Spec | Covers |
|------|--------|
| `auth.spec.ts` | OTP + password login, role-adaptive nav, route guards |
| `customer-booking.spec.ts` | venue discovery → court → slot booking; pack purchase + wallet |
| `owner.spec.ts` | dashboard reports; create pack / offer; players CRM |
| `admin.spec.ts` | platform overview; game catalogue; owners directory |

## Run locally

```bash
# 1. Infra + schema + seed (one-time per fresh DB)
docker compose up -d
cp .env.example .env
pnpm install
pnpm --filter @sportsbooking/shared build
pnpm --filter @sportsbooking/api db:generate
pnpm --filter @sportsbooking/api db:migrate
psql "$DATABASE_URL" -f apps/api/prisma/sql/rls.sql
pnpm db:seed

# 2. Install the browser, then run
pnpm test:e2e:install
pnpm test:e2e
```

`playwright.config.ts` starts the full stack via `pnpm dev` automatically (and
reuses an already-running stack outside CI). Customer specs use a fresh random
mobile and a random future date each run, so they stay independent and
re-runnable without resetting the database.
