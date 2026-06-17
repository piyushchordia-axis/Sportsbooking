# Development Plan

Full v1 build of the platform in `Sports_Venue_Booking_PRD.md`. Backend on
**NestJS**, multi-tenancy via **Postgres Row-Level Security** (tenant = owner),
React + Vite frontend with token-based white-label theming.

## Cross-cutting foundations (Stage 0)

- **Multi-tenancy & RBAC** — every tenant table carries `owner_id`; each request
  sets `app.current_owner_id` (via `PrismaService.withTenant`) and RLS policies
  (`apps/api/prisma/sql/rls.sql`) filter rows. Roles: super_admin/owner/staff/
  customer enforced by `RolesGuard`; staff scoped to `assignedVenueIds`.
- **Append-only ledger** (`LedgerService`) — single writer; balances derived,
  never overwritten (PRD §7).
- **Slot locking** — bookings run in one transaction; `UNIQUE(unitId, startsAt)`
  on `slots` rejects concurrent double-booking. Idempotency keys on confirm.
- **Adapters** — `NotificationService` (WhatsApp/SMS, log driver in dev),
  `PaymentService` (Razorpay, mocked without live keys).
- **Theming** — CSS-variable tokens per owner; subdomain-ready.

## Stage sequence (PRD §9)

| Stage | Scope | Status |
|-------|-------|--------|
| 0 | Monorepo, RLS, auth, ledger/adapters, theming, CI | ✅ implemented |
| 1 | Super-admin catalogue & onboarding; venues/units; per-court dynamic pricing; blocking; multi-slot booking; player capture; staff logins | ✅ core implemented |
| 2 | Membership packs + loyalty + referral on the unified ledger | ▢ planned |
| 3 | Add-on sales; offers & promo engine | ▢ planned |
| 4 | Open matches + player profiles/skill | ▢ planned |
| 5 | Tournaments (solo/team) + reports & analytics; marketing outreach | ▢ planned |

The Prisma data model (`apps/api/prisma/schema.prisma`) and shared enums already
cover Stages 2–5, so later stages add services/controllers/screens without
schema rework.

## Open PRD items (defaults chosen, confirm at the relevant stage)

1. **Pay-at-venue no-show fee** — tracked as ledger dues (no card-on-file) for v1.
2. **Recurring-booking price** — resolved & snapshotted per occurrence at creation.
3. **Tournament refunds** — owner-configurable; no refund after registration close
   by default (`Tournament.refundAllowedAfterClose`).

## Verification

- `pnpm test` — unit tests (pricing resolver specificity today; ledger & slot-lock
  to follow).
- E2E (Playwright, planned): onboarding → venue/court → price grid → customer
  multi-slot booking → slot locked → player captured; concurrent double-book
  rejected. See README for the local run sequence.
