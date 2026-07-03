# Development Plan

> ⚠️ **STALE (historical).** Describes a Prisma-era design (the project migrated
> to **Drizzle**). Kept for background only; for current production-readiness work
> see [GO_LIVE_PLAN.md](GO_LIVE_PLAN.md).

Full v1 build of the platform in `Sports_Venue_Booking_PRD.md`. Backend on
**NestJS**, multi-tenancy via **Postgres Row-Level Security** (tenant = owner),
React + Vite frontend with token-based white-label theming.

## Cross-cutting foundations (Stage 0)

- **Multi-tenancy & RBAC** — every tenant table carries `owner_id`; each request
  sets `app.current_owner_id` (via `PrismaService.withTenant`) and RLS policies
  (folded into the baselined Prisma migration) filter rows. Roles:
  super_admin/owner/staff/customer enforced by `RolesGuard`; staff scoped to
  `assignedVenueIds`. **Defense-in-depth:** because the dev `DATABASE_URL`
  connects as a Postgres superuser that *bypasses* RLS, the service layer also
  scopes writes/reads by `ownerId` explicitly (venues/units/pricing/settings/
  addons/offers/packs and tournament confirm/cancel). RLS is the second layer;
  for prod a dedicated non-superuser DB role is recommended so RLS actually
  enforces.
- **Append-only ledger** (`LedgerService`) — single writer; balances derived,
  never overwritten (PRD §7).
- **Slot locking** — bookings run in one transaction; `UNIQUE(unitId, startsAt)`
  on `slots` rejects concurrent double-booking. The Razorpay webhook
  (`POST /api/payments/webhook`) confirms payments idempotently (`markPaid` is a
  no-op on redelivery).
- **Auth lifecycle** — OTP (customers, throttled: 5 requests/10 min, 5 verify
  attempts) + email/password (owner/staff/admin) with JWT access **and** refresh
  tokens. `POST /auth/refresh` rotates, `/auth/logout` revokes, `/auth/password`
  changes, `/auth/password/reset-request` + `/auth/password/reset` cover forgot-
  password. The JWT strategy rejects a refresh token presented as an access
  token; `JWT_SECRET` is a fatal startup error in production if missing/default.
  (Token/OTP/reset stores are **in-memory** — Redis required for prod.)
- **Adapters** — `NotificationService` (WhatsApp/SMS; `log` driver in dev,
  `live` driver POSTs to a configured HTTP gateway — no outbox/delivery-status
  persistence yet), `PaymentService` (Razorpay: real `createOrder`/
  `verifyPaymentSignature`/`verifyWebhookSignature`/`refund`; deterministic mock
  in dev/test, real path enforced in production with keys).
- **Theming / white-label** — CSS-variable tokens per owner, hydrated on the
  consumer storefront via `StorefrontProvider` (subdomain → `/s/:key` path →
  `?owner=` param → session resolution) and editable by owners on the Branding
  page (`GET/PUT /api/me/branding`).

## Stage sequence (PRD §9)

| Stage | Scope | Status |
|-------|-------|--------|
| 0 | Monorepo, RLS, auth, ledger/adapters, theming, CI | ✅ implemented |
| 1 | Super-admin catalogue & onboarding; venues/units; per-court dynamic pricing; blocking; multi-slot booking; player capture; staff logins | ✅ implemented |
| 2 | Membership packs + loyalty + referral on the unified ledger | ✅ implemented |
| 3 | Add-on sales; offers & promo engine | ✅ implemented |
| 4 | Open matches + player profiles/skill | ✅ implemented |
| 5 | Tournaments (solo/team) + reports & analytics; CRM segmentation | ✅ implemented |

All v1 stages are implemented on the API, and the web app now covers all roles
across stages (super-admin console, owner back-office, customer app, and a
separate public consumer storefront). The Prisma data model
(`apps/api/prisma/schema.prisma`) covers every entity; no schema rework was
needed across stages.

### Stage module map (apps/api/src/modules)
- Stage 0 — `auth/`, `payments/` (incl. webhook), `notifications/`, `ledger/`
- Stage 1 — `super-admin/`, `venues/` (incl. `:id/settings`), `pricing/`,
  `bookings/`, `discovery/`
- Stage 2 — `memberships/` (packs, paid purchase, wallet), `loyalty/`,
  `referral/`
- Stage 3 — `addons/`, `offers/`
- Stage 4 — `players/` (profile/skill, CRM, bulk add, consent), `open-matches/`
- Stage 5 — `tournaments/` (incl. refunds + participant management), `reports/`
- Cross-cutting — `amc/` (renewal reminders + auto-suspend), `owner-settings/`
  (white-label branding editor)

Booking integration (`bookings/bookings.service.ts`) ties packs, offers, loyalty
redemption, slot-locking, `markPaid` (loyalty earn + referral release) and
`cancel` (session/credit refund) together.

## Completed in the latest iteration

These were previously listed as gaps/stubs and are now built and verified in code:

- **Auth lifecycle** — refresh/rotate, logout/revocation, change password,
  forgot-password request + reset; refresh-token-as-access rejection; prod
  `JWT_SECRET` fail-fast; OTP request/verify throttling; client single-flight
  auto-refresh on 401 (`apps/web/src/api/client.ts`).
- **Payments end-to-end** — Razorpay webhook controller
  (`payments/payments.controller.ts`, idempotent `markPaid`); gateway `refund`;
  paid pack purchase (charges the pack price, verifies signature).
- **Consumer storefront** — public landing/browse/venue-detail with per-owner
  white-label theming, login-at-checkout OTP, and multi-slot booking, separate
  from the admin app.
- **Discovery** — city/game filters plus geo/radius "near me", min-price, and
  limit/offset pagination (`discovery/discovery.module.ts`).
- **Venue settings** — `GET/PUT /venues/:id/settings`: cancellation template,
  no-show fee, per-venue loyalty earn/redeem overrides, open-match repayment
  mode (consumed by `bookings`, `loyalty`, `open-matches`).
- **Cancellation policy + no-show** — booking cancellation honors the venue's
  cancellation template (free window + percentage penalty) and the no-show fee
  is recorded as ledger dues.
- **Offers** — auto-apply offers are applied at checkout; game-scope, segment
  targeting, and validity window are enforced in redemption.
- **AMC** — daily reminder + auto-suspend cron (suspension production-gated;
  dry-run elsewhere) plus an on-demand `POST /super-admin/amc/run` trigger.
- **Tournaments** — confirm endpoint is now owner/staff-only (the prior
  unauthenticated `@Public` fraud hole is closed); cancel/refund honors
  `refundAllowedAfterClose`; owner participant-management listing.
- **CRM** — `POST /players/bulk` bulk add and `PATCH /players/:id/consent`
  (DPDP opt-out).
- **Open matches** — browse/list, host reject, host cancel, plus a customer-
  facing page (`pages/customer/OpenMatchesPage.tsx`).
- **Customer booking history** — `GET /bookings/mine` and `GET /bookings/:id`
  with a `MyBookingsPage`.
- **Tenant-scoping hardening** — explicit `ownerId` scoping across owner-scoped
  writes/reads as defense-in-depth over RLS (dev DB superuser bypasses RLS);
  RLS policies baselined into the Prisma migration.
- **Notifications** — `live` driver now POSTs to a configured SMS/WhatsApp HTTP
  gateway (replacing the previous message-dropping TODO).
- **Audit logging** — a global `AuditInterceptor`
  (`common/interceptors/audit.interceptor.ts`, registered via `APP_INTERCEPTOR`)
  writes append-only `AuditLog` rows, best-effort, on successful mutating
  requests (POST/PUT/PATCH/DELETE) made by owner/staff/super-admin. Reads,
  customer/public requests, and noisy auth token routes (login/refresh/logout/
  otp) are skipped; write failures are swallowed and never reach the response.

### Known limitations / still outstanding

- **In-memory stores** — OTP, refresh-token revocation, and password-reset
  tokens live in process memory; a multi-instance prod deploy needs Redis.
- **Password reset delivery** — reset tokens are sent over the SMS channel;
  staff/owner reset really wants an email provider (not yet integrated).
- **Notifications** — generic HTTP gateway only; no provider-specific WhatsApp
  Business / SMS client, no outbox/delivery-status persistence, no scheduled
  reminders beyond the AMC cron.
- **RLS in prod** — recommended hardening is a dedicated non-superuser
  `DATABASE_URL` role so RLS enforces as a true second layer; 5 child tables
  still rely on parent-scoped access (no own-row policy).
- **Tournament refunds** — `PaymentService.refund` is called with the
  participant id as the reference; a real distinct gateway payment-id column is
  needed for production refunds.
- **Audit logging** — a global `AuditInterceptor` now records management
  mutations at runtime (see above), but coverage is method/route-derived
  (action + entity inferred from the HTTP verb and first path segment), not a
  per-handler semantic event, and there is no audit-viewer UI; before/after diffs
  are not captured (metadata holds method + path only).
- **Reports** — occupancy %, peak-hour, loyalty/referral/offer/tournament and
  repeat-rate dimensions, date-range filtering, and export remain unbuilt.

## Open PRD items (defaults chosen, confirm at the relevant stage)

1. **Pay-at-venue no-show fee** — tracked as ledger dues (no card-on-file) for v1.
2. **Recurring-booking price** — resolved & snapshotted per occurrence at creation.
3. **Tournament refunds** — owner-configurable; no refund after registration close
   by default (`Tournament.refundAllowedAfterClose`).

## Verification

- `pnpm test` — unit tests (pricing resolver specificity, pack pricing, ...).
- E2E (Playwright) specs exist and run in CI against a Postgres service
  (`.github/workflows/ci.yml`): login + role routing, customer venue → court →
  slot booking and pack purchase, the owner console, and the super-admin
  console. See README for the local run sequence.
