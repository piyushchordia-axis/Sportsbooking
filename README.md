# Multi-Venue Sports Booking & Facility Management Platform

A multi-tenant SaaS for sports-facility owners (turf, pickleball, multi-sport
academies) to list venues, run per-court dynamic pricing, accept bookings, sell
memberships & add-ons, run open matches and tournaments, and build a player CRM.

Built to the PRD (`Sports_Venue_Booking_PRD.md`, v2.1). See
[`docs/`](docs/) — start with the development plan referenced in
[`docs/DEVELOPMENT_PLAN.md`](docs/DEVELOPMENT_PLAN.md). For operating the
Super Admin console (with screen snapshots) see
[`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md).

## Stack

| Layer    | Tech                                                              |
|----------|-------------------------------------------------------------------|
| Frontend | React + Vite, token-based white-label theming                     |
| Backend  | NestJS (REST), modular per domain                                 |
| Database | PostgreSQL 16, multi-tenant via Row-Level Security (tenant=owner) |
| ORM      | Prisma                                                            |
| Payments | Razorpay (mocked when test keys absent)                           |
| Auth     | OTP (customers) · email/password + RBAC (owner/staff)             |

## Monorepo layout

```
apps/api      NestJS backend
apps/web      React + Vite SPA (all roles)
packages/shared   shared TS enums/types (API ↔ web contract)
packages/ui       themed component primitives (white-label tokens)
packages/config   base tsconfig / lint
```

## Getting started

```bash
pnpm install
cp .env.example .env                 # adjust if needed
docker compose up -d                 # Postgres + Redis

pnpm --filter @sportsbooking/shared build
pnpm --filter @sportsbooking/api db:generate
pnpm --filter @sportsbooking/api db:migrate     # create tables + RLS policies
pnpm --filter @sportsbooking/api db:seed        # demo owner/venue/courts

pnpm dev   # turbo runs api (:3001) + web (:5173)
```

> **RLS in dev vs. prod.** RLS policies are folded into the baselined Prisma
> migration (no separate `psql -f` step). The dev `DATABASE_URL` connects as a
> Postgres **superuser**, which *bypasses* RLS — so the service layer also scopes
> every owner-owned read/write by `ownerId` explicitly (defense in depth). For
> production, run the app under a dedicated **non-superuser** DB role so RLS
> enforces as a real second layer.

### Demo logins (from seed)
- Super admin: `admin@sportsbooking.local` / `admin12345`
- Owner: `owner@smasharena.local` / `owner12345`
- Customer: any mobile via OTP — in dev the OTP is always `123456`.

## What's implemented (all v1 stages, API + web)

- **Foundations:** monorepo, RLS multi-tenancy (`PrismaService.withTenant`) with
  explicit `ownerId` scoping as defense-in-depth, RBAC guards, append-only
  `LedgerService`, Notification + Payment adapters, white-label theming.
  - **Auth lifecycle:** customer OTP (throttled) + owner/staff/admin
    email-password, JWT **access + refresh** tokens, `POST /auth/refresh`
    (rotate), `/auth/logout` (revoke), `/auth/password` (change),
    `/auth/password/reset-request` + `/auth/password/reset` (forgot password).
    The client auto-refreshes on 401 (single-flight). `JWT_SECRET` is required
    in production (fatal if unset/default). _OTP, refresh-revocation and reset
    stores are in-memory — use Redis in prod._
  - **Payments:** Razorpay webhook (`POST /api/payments/webhook`) confirms paid
    bookings idempotently; gateway refunds for booking/tournament cancellations;
    pack purchase charges the pack price and verifies the signature. A
    deterministic mock is used in dev/test; the real path is enforced in
    production when keys are present.
- **Stage 1:** Super-admin game catalogue & owner onboarding; owner venues
  within quota, bookable units, per-court **dynamic price grid** with a
  most-specific-rule-wins resolver, slot **blocking**, and per-venue
  **settings** (`GET/PUT /venues/:id/settings`: cancellation template, no-show
  fee, loyalty overrides, open-match repayment mode); customer **availability
  calendar** with resolved pricing and **multi-slot booking** with slot-locking
  (unique-constraint guard) and **player capture** into the owner CRM. Public
  **discovery** with city/game filters, geo/radius "near me", min-price, and
  pagination. Customer **booking history** (`GET /bookings/mine`, `/bookings/:id`).
- **Stage 2:** membership **session packs** (flat / %-discount, scope, expiry),
  **loyalty** (earn on settle, redeem as credit) and **referral** (reward on the
  referee's first paid booking) — all on the unified append-only ledger; customer
  **wallet** view. Cancellation returns session credit (not cash).
- **Stage 3:** per-venue **add-on** catalogue (rental/café/coaching, stock) as
  booking line items; **offers & promo engine** (% / flat, code or auto-apply,
  validity window, venue/game/segment scope).
- **Stage 4:** per-owner **player profiles + skill level**; **open matches** —
  host opens spare spots, players request, host approves/rejects or cancels;
  browse endpoint + customer page; repayment info-only or ledger-settled per
  venue.
- **Stage 5:** **tournaments** (solo/team, fee collection via Razorpay,
  participant capture, owner/staff-only payment confirmation, cancel/refund
  honoring `refundAllowedAfterClose`, participant-management listing),
  **reports** (paid revenue, bookings, membership liability, add-on revenue —
  per venue + consolidated) and a Super-Admin **platform aggregate**; CRM
  **segmentation** (lapsed / regulars), **bulk add** (`POST /players/bulk`) and
  **DPDP consent/opt-out** (`PATCH /players/:id/consent`).
- **Cross-cutting:** **AMC** lifecycle (daily renewal reminders + auto-suspend
  cron, suspension production-gated; on-demand `POST /super-admin/amc/run`);
  owner **white-label branding editor** (`GET/PUT /api/me/branding`).

### Web UI (all roles, stitched to the API)

A role-aware React SPA (`apps/web`), redesigned on a "Warm Industrial" OKLCH
theme (Geist font, shadcn/ui + Recharts, dark + light) with token-based per-owner
white-label theming:

- **Public consumer storefront:** landing + browse + venue-detail, rendered as a
  per-owner white-label site. The active owner is resolved from subdomain →
  `/s/:key` path → `?owner=` param → session (`StorefrontProvider`), and the
  whole storefront re-themes to that owner's branding. Guests browse freely;
  authentication is **login-at-checkout** (inline OTP) followed by multi-slot
  booking with date/price filters.
- **Customer (signed-in app):** wallet (balances + ledger history) & pack
  purchase; booking history (`MyBookings`); open matches; tournaments browse +
  registration; account (referral code + skill level).
- **Owner/Staff:** dashboard (reports), venues/courts/price-grid/settings/
  add-ons, membership packs, offers, player CRM with segments + bulk add,
  tournament creation + participant management, white-label branding editor.
- **Super Admin:** platform overview, game catalogue, owner onboarding &
  oversight (with an AMC "run now" trigger).

Auth is via `AuthProvider` (JWT in localStorage, auto-refresh on 401); routes are
role-guarded and the nav adapts per role. Public discovery endpoints
(`/api/discover/venues|games`) drive the storefront browse flow.

## Tests

```bash
pnpm test          # unit tests (pricing resolver, pack pricing, ...)

# End-to-end (Playwright) — drives the real app against a live API + seeded DB.
# See e2e/README.md for the one-time DB setup (push schema, apply RLS, seed).
pnpm test:e2e:install   # one-time: install the Chromium browser
pnpm test:e2e           # boots the stack (pnpm dev) and runs the specs
```

E2E specs (`e2e/`) cover login + role routing, customer venue→court→slot booking
and pack purchase, the owner console (dashboard, pack/offer creation, CRM) and
the super-admin console. They run in CI against a Postgres service (`e2e` job in
`.github/workflows/ci.yml`).
