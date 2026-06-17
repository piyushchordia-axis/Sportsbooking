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

## What's implemented (Stage 0 + Stage 1)

- **Foundations:** monorepo, RLS multi-tenancy (`PrismaService.withTenant`),
  RBAC guards, OTP + email/password auth, append-only `LedgerService`,
  Notification + Payment adapters, white-label theming.
- **Stage 1:** Super-admin game catalogue & owner onboarding; owner venues
  within quota, bookable units, per-court **dynamic price grid** with a
  most-specific-rule-wins resolver, slot **blocking**; customer **availability
  calendar** with resolved pricing and **multi-slot booking** with slot-locking
  (unique-constraint guard) and **player capture** into the owner CRM.

Stages 2–5 (memberships/loyalty/referral, add-ons/offers, open matches,
tournaments/reports) follow per the development plan; the data model and shared
enums already cover all of them.

## Tests

```bash
pnpm test          # unit tests (e.g. pricing resolver specificity)
```
