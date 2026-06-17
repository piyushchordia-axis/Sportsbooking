# Multi-Venue Sports Booking & Facility Management Platform

A multi-tenant SaaS for sports-facility owners (turf, pickleball, multi-sport
academies) to list venues, run per-court dynamic pricing, accept bookings, sell
memberships & add-ons, run open matches and tournaments, and build a player CRM.

Built to the PRD (`Sports_Venue_Booking_PRD.md`, v2.1). See
[`docs/`](docs/) — start with the development plan referenced in
[`docs/DEVELOPMENT_PLAN.md`](docs/DEVELOPMENT_PLAN.md).

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
pnpm --filter @sportsbooking/api db:migrate     # create tables
psql "$DATABASE_URL" -f apps/api/prisma/sql/rls.sql   # enable RLS policies
pnpm --filter @sportsbooking/api db:seed        # demo owner/venue/courts

pnpm dev   # turbo runs api (:3001) + web (:5173)
```

### Demo logins (from seed)
- Super admin: `admin@sportsbooking.local` / `admin12345`
- Owner: `owner@smasharena.local` / `owner12345`
- Customer: any mobile via OTP — in dev the OTP is always `123456`.

## What's implemented (all v1 stages, API)

- **Foundations:** monorepo, RLS multi-tenancy (`PrismaService.withTenant`),
  RBAC guards, OTP + email/password auth, append-only `LedgerService`,
  Notification + Payment adapters, white-label theming.
- **Stage 1:** Super-admin game catalogue & owner onboarding; owner venues
  within quota, bookable units, per-court **dynamic price grid** with a
  most-specific-rule-wins resolver, slot **blocking**; customer **availability
  calendar** with resolved pricing and **multi-slot booking** with slot-locking
  (unique-constraint guard) and **player capture** into the owner CRM.
- **Stage 2:** membership **session packs** (flat / %-discount, scope, expiry),
  **loyalty** (earn on settle, redeem as credit) and **referral** (reward on the
  referee's first paid booking) — all on the unified append-only ledger; customer
  **wallet** view. Cancellation returns session credit (not cash).
- **Stage 3:** per-venue **add-on** catalogue (rental/café/coaching, stock) as
  booking line items; **offers & promo engine** (% / flat, code or auto-apply,
  validity window, venue/game/segment scope).
- **Stage 4:** per-owner **player profiles + skill level**; **open matches** —
  host opens spare spots, players request, host approves; repayment info-only or
  ledger-settled per venue.
- **Stage 5:** **tournaments** (solo/team, fee collection, participant capture),
  **reports** (revenue, occupancy, membership liability, add-on revenue, player
  growth — per venue + consolidated) and a Super-Admin **platform aggregate**;
  CRM **segmentation** (lapsed / regulars) for marketing.

### Web UI (all roles, stitched to the API)

A role-aware React SPA (`apps/web`) with token-based per-owner theming:

- **Customer:** browse venues → pick court → live calendar → multi-slot booking
  with pack / points / offer; wallet (balances + ledger history) & pack purchase;
  tournaments browse + registration; account (referral code + skill level).
- **Owner/Staff:** dashboard (reports), venues/courts/price-grid/add-ons,
  membership packs, offers, player CRM with segments, tournament creation.
- **Super Admin:** platform overview, game catalogue, owner onboarding & oversight.

Auth is via `AuthProvider` (JWT in localStorage); routes are role-guarded and the
nav adapts per role. The customer side re-themes from each venue owner's branding
tokens (white-label). Public discovery endpoints (`/api/discover/venues|games`)
drive the customer browse flow.

## Tests

```bash
pnpm test          # unit tests (e.g. pricing resolver specificity)
```
