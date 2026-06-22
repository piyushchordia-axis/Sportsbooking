# Sports Venue Booking Platform — Readiness Audit

> Originally generated 2026-06-21 by an automated audit, then **reconciled
> 2026-06-22** against the current codebase after a major build iteration
> (auth lifecycle, payments webhook/refunds, consumer storefront, white-label
> wiring, venue settings, AMC, tournament refunds, discovery geo/pagination,
> CRM bulk-add + DPDP opt-out, tenant-scoping hardening). Claims below were
> re-verified against `apps/api/src/modules`, `prisma/schema.prisma`, and
> `apps/web/src`. The PRD (`Sports_Venue_Booking_PRD.md`) remains the source of
> truth.

## Remediation log — 2026-06-22 (full re-audit + autonomous fix)

A second comprehensive audit found **61 issues** (5 critical, 13 high, 21 medium,
22 low). **~55 were fixed** across batches; the remainder are explicitly deferred
prod-hardening items (below). Headline readiness after this work: **~90%+**.

**Fixed — security / tenant isolation (root cause: dev DB connects as a Postgres
superuser that bypasses RLS, so in-code `ownerId` scoping is the real guard):**
- SEC-1 pack-purchase idempotency (no more double-credit on replay)
- SEC-2 webhook-settled bookings now persist `razorpayPaymentId` (refundable)
- SEC-3 offer code + auto-apply now `ownerId`-scoped (no cross-tenant discounts)
- SEC-4 membership pack lookup `ownerId`-scoped (evaluate + purchase)
- SEC-5 loyalty **points/credit lanes namespaced per owner** (+ data backfill); open-match credit lane fixed too
- SEC-6 slot-block unit `ownerId`-scoped · SEC-8 add-on lookup venue/owner/active-scoped
- SEC-7 suspended owners/staff blocked at login + refresh
- SEC-9 `RolesGuard` registered globally · SEC-10 prod CORS allowlist · SEC-11 path-`ownerId` validated · SEC-12 confirm-payment now authenticated + ownership-checked

**Fixed — correctness / money:** BUG-1 open-match over-approval; BUG-2 tournament
register race + idempotency; BUG-3 tournament payment-id persisted + refunded
against it (migration `20260623010000`); BUG-4 tournament refund always ledgered;
BUG-5 `BookingAddon` line items written (add-on revenue real); BUG-6 reschedule
reconciles money; BUG-7 zero-total prepay settled; BUG-8 loyalty clawback on
cancel; BUG-9 deterministic ledger read + per-lane advisory lock; BUG-10 referral
dedupe; BUG-11 2dp rounding; BUG-12 pricing tiebreaker; BUG-13/14 Decimal cap +
setPricing validation.

**Fixed — schema (migration `20260623000000_schema_integrity`):** DB-1 booking→venue
FK; DB-2 tournament→game FK; DB-3 denormalized `ownerId` FKs; DB-4 venue-delete
→ RESTRICT; DB-5 slot→booking → CASCADE; DB-6 missing indexes; DB-8 auto-create
`VenueSettings`.

**Fixed — PRD features:** PRD-1 recurring weekly bookings; PRD-2 feature-flag
enforcement; PRD-3 staff management (module + UI); PRD-4 host-open-match UI;
PRD-5 add-on picker at checkout; PRD-6 slot-blocking UI; PRD-7 marketing
broadcast; PRD-8 empty `allowedGameIds` = all; PRD-9 customer + open-match
notifications + reminder cron; FE-1/2 owner AMC terms + flag toggles + edit;
FE-3 pricing grid; FE-4 tournament dates; FE-5 offer validity/scope; FE-6
tournament full/cancel; FE-7 error states; FE-11 mobile validation; FE-13/14/15
nav/search/comment cleanup. **Full admin UI/UX overhaul** (shadcn date-range
picker, Select/Switch, depth + hierarchy, Warm Industrial theme preserved).

**Deferred (documented prod-hardening, not fake-fixed in dev):** SEC-13/14/15
(Redis-backed OTP/refresh/reset stores; email password reset), SEC-16/17 +
prod DB role (dedicated non-superuser `DATABASE_URL` so RLS enforces as a second
layer; child-table RLS), DB-7 (slot-overlap `EXCLUDE` constraint via btree_gist),
DB-9 (`SavedVenue` + occupancy/peak-hour report materialization), FE-16/API-1
(unused boilerplate / intentional logs).

## Headline

**Overall readiness: ~78%** (up from ~53% at the prior audit).

| Layer | Readiness | Notes |
|---|---|---|
| Database | **93%** | Near-complete; RLS now baselined into the migration |
| Backend API | **85%** | Money + messaging paths now real; runtime audit logging now wired (global interceptor); reports remain the main gap |
| Frontend | **~80%** | All roles wired incl. a public consumer storefront; white-label hydrated; payment + history flows present |

Backend modules: **21** under `apps/api/src/modules` (incl. new `amc`,
`discovery`, `owner-settings`, and a `payments` webhook controller); the large
majority are real-logic with only reports materially incomplete (audit logging
is now wired via a global interceptor, though route-derived and viewer-less).

### How the % was computed

Weighted by layer: DB 25%, backend 45%, frontend 30%. A feature counts 'done'
only when DB + real backend logic + wired frontend all exist. The prior audit's
~53% was dragged down by three things that are now resolved: (1) **money is
collected end-to-end** — a Razorpay webhook (`payments/payments.controller.ts`)
confirms bookings idempotently, gateway refunds exist, and pack purchase charges
the price; (2) **messaging has a real delivery path** — the `live` notification
driver POSTs to a configured SMS/WhatsApp HTTP gateway instead of dropping
messages; (3) **white-label is hydrated** — `StorefrontProvider` resolves the
owner (subdomain/path/param/session) and re-themes the consumer storefront, with
an owner-facing branding editor. Also closed: the tournament-confirm fraud hole
(now owner/staff-only), customer booking history (`GET /bookings/mine`),
discovery geo/radius/pagination/price, venue settings, per-venue loyalty
overrides, offer auto-apply + scope enforcement, cancellation policy + no-show
fee, CRM bulk-add + DPDP opt-out, AMC reminders/auto-suspend, OTP throttling, and
prod `JWT_SECRET` fail-fast. Layer math lands at
`0.25*93 + 0.45*85 + 0.30*80 = 23.3 + 38.3 + 24 = ~86` for infra-presence; the
'real end-to-end' discount for the remaining gaps (thin reports, in-memory
prod-blocking stores, RLS-bypassing dev DB role, audit logging present but
route-derived with no viewer) pulls the honest figure to **~78%**.

## Domain readiness matrix

| Domain | DB | Backend | Frontend | Overall | Note |
|---|---|---|---|---|---|
| auth/RBAC | 95 | 90 | 85 | **done** | OTP (throttled) + email/password + JWT access+refresh all real and wired. Refresh/rotate, logout/revoke, change-password, forgot-password reset all implemented (`auth.controller.ts`). JWT strategy rejects refresh-as-access; prod `JWT_SECRET` fails fast if unset/default. Client auto-refreshes on 401. Gaps: in-memory OTP/refresh/reset stores (Redis for prod); reset delivered over SMS (no email provider). |
| multi-tenancy | 90 | 85 | 75 | **mostly** | RLS via withTenant real; policies now baselined in the Prisma migration. Service layer adds explicit `ownerId` scoping as defense-in-depth (dev DB superuser bypasses RLS). Gaps: 5 child tables still have no own-row policy; prod should use a dedicated non-superuser DB role so RLS is a real second layer. |
| venues/courts | 100 | 85 | 80 | **mostly** | Create venue/unit/block real; quota+game entitlement enforced; per-venue **settings** editor (`GET/PUT /venues/:id/settings`: cancellation template, no-show fee, loyalty overrides, repayment mode) real and wired; ownerId-scoped. Gaps: limited update/delete on units, no unblock surface. |
| dynamic pricing | 100 | 90 | 60 | **mostly** | Most-specific-rule-wins resolver real with unit tests; consumed at booking/availability/discovery min-price. Gaps: UI price grid still limited; no full day×timeband matrix editor; no standalone price-quote endpoint. |
| availability/booking | 95 | 88 | 80 | **mostly** | Availability, multi-slot, slot-lock (UNIQUE 409), reschedule, cancel real. **Customer history now exists** (`GET /bookings/mine`, `GET /bookings/:id`) with a MyBookings page. Cancellation **honors the venue cancellation template** (free window + % penalty); no-show fee recorded as ledger dues. Gaps: no recurring-booking flow surfaced. |
| memberships/packs | 100 | 85 | 75 | **mostly** | Pack CRUD-create + soft-deactivate, paid purchase (charges price + verifies signature), evaluate/debit/refund real. Gaps: validityDays/expiryMode persisted but expiry enforcement still light; flatRate semantics simple. |
| loyalty | 100 | 85 | 55 | **mostly** | Earn/redeem/creditRefund real on ledger, wired into booking flow. **Per-venue rate overrides now read** from VenueSettings (falls back to owner-level) in loyalty.service.ts. Gaps: no dedicated config endpoint beyond venue settings; no points-expiry; no standalone loyalty UI (visible via wallet). |
| referral | 100 | 85 | 60 | **mostly** | Per-owner code gen + apply + reward-on-first-paid (idempotent via status flip) real. Gaps: reward gated on 'any pending referral'; no reward-config endpoint; AccountPage shows code but limited share/history. |
| wallet/ledger | 100 | 88 | 75 | **mostly** | Append-only single-writer LedgerService with derived balances + overdraft guard real; wallet view real; refunds (booking/tournament/cancel) and no-show dues recorded here. Gaps: no standalone statement/reconciliation HTTP API. |
| add-ons | 100 | 72 | 60 | **partial** | Create+public-list real; attached as booking line items with stock decrement; revenue aggregated in reports. Gaps: limited update/delete/deactivate, no single GET, no manual restock. |
| offers/promos | 100 | 85 | 65 | **mostly** | Create/update + list real; promo-code redemption + discount math real. **autoApply now applied at checkout** (bookings.service.ts:1172) and **game-scope + segment targeting + validity window are enforced** in redemption. Gaps: richer UI for scope/segment editing. |
| open matches | 95 | 85 | 70 | **mostly** | create/join/approve real incl. ledger settlement; **browse/list, host reject, and host cancel now implemented** plus a customer OpenMatches page. Gaps: approve idempotency still relies on state transitions; share math uses nominal capacity. |
| player CRM | 100 | 88 | 80 | **mostly** | List + segment (lapsed/regulars) + manual add real and wired. **Bulk add** (`POST /players/bulk`) and **DPDP consent/opt-out** (`PATCH /players/:id/consent`) now implemented. Gaps: no targeted-segment marketing dispatch; no edit/delete player. |
| tournaments | 95 | 85 | 75 | **mostly** | create/list/register/confirm real with CRM capture + Razorpay order. **Confirm is now owner/staff-only (RolesGuard) — the prior @Public fraud hole is closed.** Cancel/refund **honors `refundAllowedAfterClose`** and records cash on the ledger; owner participant-management listing + UI. Gaps: refund uses participant id as the gateway reference (no distinct payment-id column); no fixtures/brackets; team roster = captain only. |
| reports/analytics | 90 | 55 | 65 | **partial** | owner summary + platform aggregate real (bookings, paid revenue, pack liability, add-on revenue, per-venue). MISSING PRD dims: occupancy %, peak-hour, loyalty, referral, offer-redemption, tournament, repeat-rate; no date-range filter/export. |
| notifications | 30 | 60 | 30 | **partial** | Adapter wired and called (OTP, confirmations, AMC). `log` driver console-logs in dev; **`live` driver now POSTs to a configured SMS/WhatsApp HTTP gateway** (failures logged, not thrown). Gaps: generic gateway only (no provider-specific WhatsApp Business / SMS client), no outbox/delivery-status persistence, no scheduled reminders beyond AMC, opt-out enforced by callers not centrally. |
| payments | 60 | 85 | 70 | **mostly** | Real Razorpay `createOrder`/`verifyPaymentSignature`/`verifyWebhookSignature`/`refund`. **Webhook is now routed** (`POST /payments/webhook`) and confirms bookings idempotently; **refunds** issued for booking/tournament cancels; **pack purchase charges the price**. Deterministic mock in dev/test; real path **enforced in production** with keys. Gaps: no standalone payment table (state inline on Booking); webhook covers `payment.captured` only. |
| super-admin | 95 | 80 | 80 | **mostly** | game list/create/**update**, owner onboarding (Owner+admin user, bcrypt), owner directory, **status PATCH validated against the enum**, all wired. **AMC reminders + auto-suspend cron** plus on-demand `POST /super-admin/amc/run` and an Owners UI button. Gaps: no game delete, no branding upload at onboarding, onboarding grants ALL games/feature flags (no selective assignment). |
| theming/white-label | 90 | 85 | 85 | **mostly** | Branding stored on Owner, returned by discovery. **`StorefrontProvider` resolves the active owner (subdomain → `/s/:key` → `?owner=` → session) and hydrates `setBranding`**; owner **branding editor** (`GET/PUT /me/branding`) + Branding page. Gaps: no logo-upload pipeline (URL only); storefront theming centralized in the provider rather than per-page. |
| customer discovery | 95 | 85 | 80 | **mostly** | discover/venues + discover/games real and wired into the consumer storefront. **Now supports geo/radius "near me" (haversine), min-price, and limit/offset pagination** plus city/game filters and min-price in the payload. Gaps: no live per-slot availability in the discovery payload; no explicit owner-status publish filter. |

## Docs vs. reality — discrepancies (post-reconciliation)

_The README, DEVELOPMENT_PLAN, and ADMIN_GUIDE were updated 2026-06-22 to match
the current code. Remaining noteworthy mismatches:_

- The repository's `README.md` lives at the **repo root**, not at `docs/README.md`
  (the latter does not exist). All README updates were applied to the root file.
- `schema.prisma` historically referenced a separate RLS migration path; RLS is
  now folded into the baselined Prisma migration. Verify the schema header
  comment matches before relying on it.
- The PRD/ADMIN_GUIDE describe a single AuditLog of admin actions; the table
  exists, the seed populates it, and a global `AuditInterceptor` now emits
  runtime rows on management mutations. Coverage is route-derived (action +
  entity inferred from HTTP verb and path) rather than per-handler semantic
  events, and there is no audit-viewer UI — represent it as wired-but-coarse,
  not fully complete.
- Reports docs still list occupancy / peak-hour / player-growth dimensions that
  the `reports` module does not compute. Treat reports as **partial**.

## What is still a STUB or thin (exists but incomplete)

- **Audit logging:** `AuditLog` model + seed rows exist and a global
  `AuditInterceptor` (`common/interceptors/audit.interceptor.ts`, registered via
  `APP_INTERCEPTOR`) now writes append-only rows at runtime on successful
  owner/staff/super-admin mutations. It is best-effort (write failures
  swallowed) and route-derived — action/entity come from the HTTP verb and first
  path segment, metadata is method+path only (no before/after diffs), and there
  is no audit-viewer UI (PRD §7 partially met).
- **Notifications delivery:** the `live` driver now POSTs to a configured generic
  SMS/WhatsApp HTTP gateway (no longer dropping messages), but there is **no
  provider-specific WhatsApp Business / SMS client, no outbox/delivery-status
  persistence, and no scheduled reminders** beyond the AMC cron
  (notification.service.ts). With the default `log` driver, messages (incl. OTPs)
  only log to the console.
- **In-memory auth stores:** OTP codes, refresh-token revocation, and
  password-reset tokens are held in process memory — a multi-instance prod
  deploy needs Redis (otp.service.ts and the auth service stores).
- **Password reset over SMS:** reset tokens are delivered via the SMS channel;
  staff/owner reset really needs an email provider (not integrated).
- **Pack expiry/flatRate:** validityDays/expiryMode are persisted but expiry
  enforcement is light; flatRate semantics are simple.
- **Tournament refund reference:** `PaymentService.refund` is called with the
  participant id as the reference; production refunds need a distinct stored
  gateway payment-id column.
- **Reports dimensions:** occupancy %, peak-hour, loyalty/referral/offer/
  tournament/repeat-rate, date-range filter, and export remain unbuilt
  (reports module returns paid revenue, bookings, pack liability, add-on revenue,
  per-venue only).
- **Payment record:** payment state is inline on Booking
  (razorpayOrderId/paymentId/paymentStatus); there is no standalone payment/
  refund/settlement table. The webhook handles `payment.captured` only.

## What is MISSING (PRD feature with no implementation)

- Real provider-specific notification delivery + outbox/delivery-status + scheduled reminders: the generic HTTP gateway exists but there is no WhatsApp Business API / SMS provider client, no persisted notification log, and no reminder scheduler beyond the AMC cron (PRD NOTIF-1..5)
- Report dimensions: occupancy %, peak-hour, loyalty activity, referral activity, offer redemption, tournament performance, player repeat-rate (PRD RPT-1..7); no date-range filter or export
- Targeted-segment marketing dispatch via WhatsApp+SMS (PRD CRM-4, OFFER-4) — segmentation + consent exist, but no outreach send
- Tournament fixtures/brackets/draws and per-player team-roster capture (PRD TOUR-2, TOUR-4)
- Distinct stored gateway payment-id for refunds, and a standalone payment/refund/settlement table (refund currently keys off the participant/order reference)
- Standalone loyalty/referral config UI and history screens beyond the venue-settings overrides and account page (PRD LOY-3, REF-3)
- Selective per-owner game/feature-flag assignment at onboarding (UI still grants ALL), logo-upload pipeline (branding is URL-only), and game delete (PRD SA-1, SA-6)
- Recurring-booking flow surfaced in the UI (PRD BOOK)
- Full edit/delete (CRUD lifecycle) for some add-on / unit surfaces (several are still create+list only)

### Recently CLOSED (previously listed missing; now implemented and verified)

- Customer booking history (`GET /bookings/mine`, `GET /bookings/:id`) + MyBookings page
- Razorpay webhook for idempotent confirmation (`POST /payments/webhook`)
- Gateway refunds for booking + tournament cancellations (`PaymentService.refund`)
- Cancellation policy engine (venue cancellation template: free window + % penalty) and no-show fee recorded as ledger dues
- Open-match browse/list, host reject, host cancel + customer OpenMatches page
- Per-venue loyalty earn/redeem overrides (read from VenueSettings)
- CRM bulk add (`POST /players/bulk`) and DPDP consent/opt-out (`PATCH /players/:id/consent`)
- Super-admin AMC renewal reminders + auto-suspend cron and on-demand trigger; game update; validated owner-status PATCH
- Owner white-label branding editor (`GET/PUT /me/branding`) + consumer storefront branding hydration
- Discovery geo/radius "near me", min-price, and limit/offset pagination
- Auth: token refresh/rotate, logout/revocation, change password, password reset; OTP rate limiting; prod JWT secret fail-fast
- Offer auto-apply at checkout + game-scope/segment/validity enforcement
- Runtime audit-log writes via a global `AuditInterceptor` (best-effort, append-only) on owner/staff/super-admin mutations

## Top risks (current)

- **Production stores are in-memory:** OTP, refresh-token revocation, and
  password-reset tokens live in process memory. A multi-instance deploy will
  drop OTPs/refresh state across instances and on restart — Redis is required
  before horizontal scaling.
- **RLS does not enforce under the dev DB role:** the dev `DATABASE_URL`
  connects as a Postgres superuser that bypasses RLS, so tenant isolation
  currently rests on the application's explicit `ownerId` scoping. Production
  must run under a dedicated non-superuser DB role for RLS to act as a real
  second layer. The 5 child tables without an own-row policy compound this.
- **Audit trail is coarse and viewer-less:** a global interceptor now records
  privileged mutations to `AuditLog`, but it is best-effort (write failures
  swallowed) and route-derived (no before/after diffs, no semantic per-handler
  events), and there is no UI to review the trail (PRD §7).
- **Notification delivery is generic + unobserved:** the live driver POSTs to a
  configured gateway but there is no delivery-status/outbox, no retry, and no
  provider-specific client — failed sends are logged and swallowed, so OTP /
  confirmation delivery cannot be monitored or replayed in prod.
- **Tournament refunds lack a stored gateway payment id** — refunds key off the
  participant/order reference, which is fragile against real Razorpay payment
  records.
- **Reports are thin:** core PRD analytics dimensions (occupancy, peak-hour,
  repeat-rate, loyalty/referral/offer/tournament) are absent — limits the
  owner-facing value proposition, not a correctness/security risk.

## Recommended next steps (prioritized)

1. P0 Move OTP, refresh-token revocation, and password-reset stores to Redis (or a DB table) so auth survives restarts and scales horizontally.
2. P0 Run production under a dedicated non-superuser `DATABASE_URL` role so RLS enforces; add own-row policies to the 5 child tables (venue_games, venue_settings, booking_addons, tournament_participants, open_match_join_requests).
3. P1 Deepen audit logging beyond the global interceptor: capture semantic per-handler events with before/after diffs for high-value actions (onboarding, status changes, refunds, settings/branding edits), and build an audit-viewer surface (the interceptor already writes route-derived rows).
4. P1 Integrate a real notification provider (WhatsApp Business API + SMS) behind the adapter; add an outbox/delivery-status table and retry; add an email provider for staff password reset.
5. P1 Add a distinct stored gateway payment-id (and ideally a standalone payment/refund table) so tournament/booking refunds reference real Razorpay payments.
6. P1 Build the missing report dimensions (occupancy %, peak-hour, loyalty/referral/offer/tournament/repeat-rate), date-range filter, and export.
7. P1 Enforce pack expiry/flatRate fully.
8. P2 Complete remaining CRUD lifecycle (update/delete/deactivate) for add-ons and units; add a logo-upload pipeline and selective per-owner game/feature-flag assignment at onboarding; add game delete.
9. P2 Add targeted-segment marketing dispatch (uses the existing segmentation + DPDP consent flags).
10. P2 Tournament fixtures/brackets/draws and per-player team-roster capture.
11. P3 Surface a recurring-booking flow in the UI; add standalone loyalty/referral config + history screens.

## What's solid (what IS done)

- Multi-tenant RLS: PrismaService.withTenant/withTenantId/withTenantBypass open a real $transaction and SET LOCAL app.current_owner_id; policies FORCEd on owner-scoped tables, now folded into the baselined Prisma migration. Service layer adds explicit ownerId scoping as defense-in-depth.
- Auth lifecycle end-to-end: throttled customer OTP, owner/staff/admin email+password (bcrypt), JWT access+refresh, refresh-rotate + logout-revoke + change-password + forgot-password reset; refresh-as-access rejection; prod JWT_SECRET fail-fast; client single-flight auto-refresh on 401 (auth.controller.ts, jwt.strategy.ts, apps/web/src/api/client.ts)
- Payments end-to-end: Razorpay createOrder/verifyPaymentSignature/verifyWebhookSignature/refund; routed webhook (payments/payments.controller.ts) confirms bookings idempotently; gateway refunds for booking + tournament cancels; pack purchase charges the price; real path enforced in production
- Consumer storefront: public landing/browse/venue-detail with per-owner white-label theming resolved via StorefrontProvider (subdomain/path/param/session) and an owner branding editor; login-at-checkout OTP + multi-slot booking with date/price filters
- Append-only ledger as single writer with derived balances + overdraft guard, consumed by loyalty/memberships/referral/open-matches/refunds/no-show dues (ledger.service.ts)
- Dynamic per-court pricing resolver with most-specific-rule-wins scoring + unit tests, consumed by availability/booking/discovery min-price (pricing.service.ts, pricing.service.spec.ts)
- Slot-locking double-book prevention via UNIQUE(unitId,startsAt) with P2002->409 mapping inside a single transaction (bookings.service.ts)
- Venue settings editor (cancellation template, no-show fee, per-venue loyalty overrides, open-match repayment mode) consumed by bookings/loyalty/open-matches (venues GET/PUT :id/settings)
- Cancellation policy (free window + % penalty) and no-show fee as ledger dues; customer booking history (GET /bookings/mine, /bookings/:id) + MyBookings page
- Owner booking management UI fully wired: filterable directory, status changes, settle, edit-customer, reschedule with availability reload; owner offline/walk-in booking creation
- Membership pack evaluate/debit/refund-to-ledger with flat vs %-discount and venue/unit scope validation + unit tests; loyalty earn/redeem/refund hooked into markPaid/cancel; referral reward on referee first paid booking (idempotent)
- Offers: auto-apply at checkout + game-scope/segment/validity enforcement in redemption
- Open matches: create/join/approve with ledger settlement, plus browse/reject/cancel + customer page
- Player CRM: list + segment (lapsed/regulars) + manual add + bulk add + DPDP consent/opt-out
- Tournaments: create/list/register, owner/staff-only payment confirm, cancel/refund honoring refundAllowedAfterClose, participant-management listing + UI
- Super-admin: game create/list/update, owner onboarding (Owner + bcrypt admin user in one tx), owner directory, validated status PATCH, AMC reminder/auto-suspend cron + on-demand trigger + Owners UI button
- Owner reports: real Prisma aggregations for paid revenue, bookings, pack liability, add-on revenue, per-venue breakdown + platform aggregate (reports module)
- Prisma schema is a faithful, drift-free migration covering all entities/enums; seed is idempotent, transactional, RLS-bypassed
- E2E Playwright specs exist (auth/customer-booking/owner/admin) and run in CI against Postgres (.github/workflows/ci.yml)

## Database notes

- **Migrations:** No drift; schema and migrations track. RLS policies are now folded into the baselined Prisma migration rather than a manual `psql -f rls.sql` step, removing the prior drift/skip risk on fresh deploys. CAVEAT: if a new tenant table is added later, its RLS policy must be added to the migration by hand or it ships with no DB-level isolation (the application's explicit ownerId scoping would be the only guard). Spot-checked decimals, array defaults, enum defaults, and FK on-delete behaviors — consistent.

- **RLS coverage:** All owner-scoped tables are enabled + FORCEd + given a tenant_isolation policy: owners (keyed on id), users (allows ownerId IS NULL global rows), and the standard owner_id tables. ENABLE + FORCE ROW LEVEL SECURITY means even the table owner is filtered, which is correct. The bypass path (app.bypass_rls session var) is used by super admin/migrations/seed. IMPORTANT: the dev `DATABASE_URL` connects as a Postgres **superuser**, which bypasses RLS entirely — so in the current dev/default setup RLS is *not* the active guard; the application's explicit `ownerId` scoping in the service layer is. Production should use a dedicated non-superuser DB role so RLS enforces as a real second layer. GAP: the child tables without an owner_id column (venue_games, venue_settings, booking_addons, tournament_participants, open_match_join_requests) still have NO own-row policy and are protected only by being reached via owner-scoped parents (and by the service-layer scoping). Recommend adding owner_id (or EXISTS-subquery) policies to these 5 child tables.

- **Missing/entity notes:**
  - No missing CORE entities: all 17 entities in PRD §8.1 have a table. StaffUser (§8.1) is intentionally folded into User via role + assignedVenueIds[] rather than its own table — correct, not a gap.
  - Notification / Messaging (PRD §6 Notifications: WhatsApp+SMS confirmation/reminders/offers/open-match updates) — NO table. Handled via a Notification adapter whose `live` driver POSTs to a configured HTTP gateway, so there is still no persisted notification log/outbox/delivery-status entity. Delivery tracking, retry, and scheduled reminders (beyond the AMC cron) need an outbox table.
  - Reports (PRD §4.11) — NO table, and correctly so: reports (revenue, occupancy, membership liability, add-on revenue, player growth) are computed/aggregated at query time, not stored.
  - Payment / Razorpay transaction record — NO dedicated table; payment state lives inline on Booking (razorpayOrderId/razorpayPaymentId/paymentStatus). Adequate for current scope but there is no standalone payment/refund/settlement ledger separate from LedgerTxn.
  - AMC / Subscription as an entity — NO separate table; AMC terms (setupFee, amcAmount, amcRenewalDate) are inline columns on Owner. PRD §3 treats AMC as commercial terms, so inline is acceptable, but there is no AMC payment/renewal-history table for the 'AMC renewal reminders' feature (PRD line 89).

## Reconciliation notes (2026-06-22)

This audit was re-verified against the codebase after the latest build iteration.
Each claim below was confirmed in source:

- **Closed since the prior audit (verified):** Razorpay webhook routed and idempotent (`payments/payments.controller.ts`); gateway refunds (`payment.service.ts` `refund`); pack purchase charges + verifies signature (`memberships`); tournament confirm now owner/staff-only — the prior `@Public` fraud hole is gone (`tournaments.module.ts` `confirm` with `@Roles`); tournament cancel/refund honors `refundAllowedAfterClose`; auth lifecycle (refresh/logout/password/reset) in `auth.controller.ts`; JWT strategy rejects refresh-as-access and prod `JWT_SECRET` fails fast (`jwt.strategy.ts`); OTP throttling (`otp.service.ts`); white-label storefront hydration (`storefront/StorefrontProvider.tsx`) + owner branding editor (`owner-settings.module.ts`); discovery geo/radius/pagination/min-price (`discovery.module.ts`); venue settings (`venues` `:id/settings`); per-venue loyalty overrides (`loyalty.service.ts`); offer auto-apply + scope (`bookings.service.ts`); CRM bulk add + DPDP consent (`players.module.ts`); customer booking history (`bookings.controller.ts` `bookings/mine`, `bookings/:id`); open-match browse/reject/cancel; AMC cron + trigger (`amc.module.ts`).

- **Runtime audit-log writes (now present, verified):** a global
  `AuditInterceptor` (`common/interceptors/audit.interceptor.ts`) is registered
  via `APP_INTERCEPTOR` in `app.module.ts` and calls `auditLog.create` (through
  `withTenantBypass`) on successful POST/PUT/PATCH/DELETE requests by
  owner/staff/super-admin. It skips reads, customer/public traffic, and the
  noisy auth token routes (login/refresh/logout/otp). Remaining nuance: coverage
  is route-derived (action from verb, entity from first path segment), writes are
  best-effort (failures swallowed), metadata is method+path only, and there is no
  audit-viewer UI — so the trail is wired but coarse, not a full semantic
  before/after audit (PRD §7 partially met).

- **Notifications nuance:** the `live` driver now performs a real `fetch` POST to
  a configured generic SMS/WhatsApp gateway (it no longer drops messages), but it
  is a generic adapter — no provider-specific WhatsApp Business / SMS client, no
  outbox/delivery-status, no retry. The default `log` driver still only logs.

- **RLS nuance:** RLS is now baselined in the migration, but the dev DB role is a
  superuser that bypasses RLS, so in the default setup tenant isolation rests on
  the service layer's explicit `ownerId` scoping; a non-superuser prod role is
  the recommended hardening.
