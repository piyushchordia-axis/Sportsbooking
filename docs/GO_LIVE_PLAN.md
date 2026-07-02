# Production Go-Live Plan

Phased remediation plan derived from the 2026-07-02 codebase audit (security + production-readiness). Phases are **gated**: each phase's exit criteria should be met before the next begins, because earlier phases are either actively exploitable or protect against unrecoverable data loss.

Effort key: **S** ≈ <½ day · **M** ≈ ½–2 days · **L** ≈ multi-day. "∥" = parallelizable within the phase.

---

## Phase 0 — Stop-the-bleed security
**Gate:** must complete before any non-test user touches production. Everything here is exploitable *today*.

| # | Task | Files | Effort |
|---|------|-------|--------|
| 0.1 ✅ | **DONE** — Added explicit `eq(table.ownerId, user.ownerId)` to the 7 unscoped read paths | `reports.module.ts` (ownerSummary), `search.module.ts` (venues/tournaments/players/bookings), `payment-ledger.service.ts` + `payments.controller.ts`, `audit-log.module.ts` (list + entities), `offers.module.ts` (list), `notification-feed.module.ts` (list), `loyalty-settings.module.ts` (getHistory) — typecheck + lint + 31 unit tests green | M |
| 0.2 ✅ | **DONE (repo + dev DB; prod rollout pending)** — `FORCE ROW LEVEL SECURITY` on all 27 tenant tables + restored the non-owner `sportsbooking_app` runtime role (NOSUPERUSER/NOBYPASSRLS/NOCREATEROLE) with grants + append-only REVOKEs on `ledger_txns`/`payments`; `DATABASE_URL`→runtime role, admin only for migrate/seed. Verified on dev DB: cross-tenant reads blocked, append-only enforced, `WITH CHECK` blocks cross-tenant writes, app boots + owner endpoints work as the restricted role. **Prod rollout:** deploy → `MIGRATE=1 ./deploy/deploy.sh` (creates role + rotates password) → switch server `.env` `DATABASE_URL` to `sportsbooking_app`. Files: `rls-policies.sql`, `role-setup.sql`, `db-push.ts`, `set-app-role-password.ts`, `deploy.sh`, `docker-compose.prod.yml`, `.env*.example`, `deploy/README.md`, `ci.yml` | M |
| 0.3 | Remove `STATIC_OTP`; wire a live SMS provider (or gate player login behind `ALLOW_NO_SMS` until ready) | `otp.service.ts:49`, `.env.production.example:38`, server `.env` | M |
| 0.4 | Delete the `.replit` dev launch path + committed dev JWT secret | `.replit:14,49` | S |

**Exit criteria:** With two seeded tenants, hit all 7 endpoints as tenant A and confirm zero tenant-B rows returned; confirm forcing RLS breaks nothing for legitimate queries; login requires a real OTP; no `development` launch path can reach a public host.

---

## Phase 1 — Data safety & deploy integrity
**Gate:** before real customer data accumulates at any scale. Protects against unrecoverable loss.

| # | Task | Files | Effort |
|---|------|-------|--------|
| 1.1 | Nightly `pg_dump` + offsite copy + `sb_uploads` volume; document restore (RTO/RPO) | `deploy/` (new backup script + cron) | M |
| 1.2 | Replace `drizzle-kit push --force` with versioned SQL migrations applied by a migrator; mandatory pre-migration dump | `deploy/deploy.sh:43`, `apps/api/drizzle/` | M |
| 1.3 ✅ | **DONE** — Prevent the silent mock-payment path. Investigation showed the server already fails closed in prod (mock signatures rejected), so the real bug was a customer *dead-end*: a prod build without the key let a customer pick online prepay → PENDING booking → no checkout → silent expiry. Fix: `onlinePrepayAvailable` gate hides online prepay + deposit in a prod build without the key (mock still available in dev), so the storefront offers pay-at-venue only; plus a loud build-time warning in `vite.config.ts`. Chose safe runtime degrade over a hard build-fail to preserve the valid pay-at-venue-only launch mode. Files: `apps/web/src/lib/razorpay.ts`, `apps/web/src/pages/consumer/VenueDetailPage.tsx`, `apps/web/vite.config.ts`. Verified: web typecheck + prod builds (with/without key) + warning. | S |
| 1.4 ∥ | Deploy from a git ref, tag images with the SHA, keep N previous tags for rollback | `deploy/deploy.sh`, `docker-compose.prod.yml` | M |

**Exit criteria:** A restore from last night's backup succeeds on a scratch DB; a test schema change is reviewed as SQL and applied via the migrator (no `--force`); a prod build with the key missing fails; documented one-command rollback to the prior image tag.

---

## Phase 2 — Money & booking correctness
**Gate:** before high booking/payment volume.

| # | Task | Files | Effort |
|---|------|-------|--------|
| 2.1 | Webhook: handle `payment.failed` + `refund.*`; add a reconciliation job/report for orphaned gateway payments and stuck-PENDING bookings | `payments.controller.ts:77`, payments module | M |
| 2.2 ∥ | Pin every datetime parse to `Asia/Kolkata` (create/reschedule paths) | `bookings.service.ts:420,1021,1947` (+ audit for others) | S |
| 2.3 ∥ | Add a `btree_gist` EXCLUDE overlap constraint for variable-duration slots (current UNIQUE guards exact start only) | `apps/api/src/db/schema.ts:295` | M |
| 2.4 | Surface deposit "balance due at venue" (owner dues dashboard) + forfeited-balance-on-cancel in API/UI | bookings module, owner `BookingsPage` | M |

**Exit criteria:** e2e test drives a failed payment and a gateway refund and both reconcile; TZ tests pass on a UTC-clock host; an overlapping-duration double-book attempt is rejected by the DB.

---

## Phase 3 — Feature completeness (PRD parity)
**Gate:** before marketing the full feature set. Not a security/data risk — parity and UX.

| # | Task | Files | Effort |
|---|------|-------|--------|
| 3.1 | Staff check-in flow + `checked_in` `BookingStatus` state (PRD §2/§4.3) | `packages/shared/src/enums.ts`, bookings module, owner UI | M |
| 3.2 ∥ | Consumer recurring booking (API exists; add storefront control) — PRD §5.2 | `pages/consumer/VenueDetailPage.tsx` | M |
| 3.3 ∥ | Player-facing notification feed (currently owner/staff only) | `notification-feed.module.ts`, consumer UI | M |
| 3.4 | Consolidate the two consumer surfaces (`pages/consumer/*` vs older `pages/customer/*`) — pick one, retire the other | `apps/web/src/App.tsx` route table | L |
| 3.5 ∥ | Feature-flag-aware UI (hide disabled features instead of 403-on-action); add `@RequireFlag(LOYALTY)` guard | owner pages, loyalty modules | S |

**Exit criteria:** PRD feature checklist is wired end-to-end (API + UI) or explicitly descoped; no owner route renders a feature the tenant lacks entitlement for.

---

## Phase 4 — Observability & operational maturity
**Gate:** before relying on prod for revenue without a person watching logs.

| # | Task | Files | Effort |
|---|------|-------|--------|
| 4.1 ∥ | Env-schema validation at boot (zod/joi) covering `DATABASE_URL`, Razorpay, storage | `app.module.ts:47` | S |
| 4.2 ∥ | Error tracking (Sentry/OTel) with alerting | api bootstrap | M |
| 4.3 ∥ | DB-aware readiness probe (current healthz is liveness-only) | `health.controller.ts:9` | S |
| 4.4 ∥ | SPA security headers (HSTS, CSP, X-Frame-Options, nosniff) + commit the 80→443 redirect | `apps/web/nginx.conf`, `deploy/nginx-site.conf.template` | S |
| 4.5 | Move rate-limit store to Redis before scaling out; verify `trust proxy` hop count vs the real Nginx chain | `app.module.ts:54`, `main.ts:22` | M |

**Exit criteria:** A synthetic DB outage flips the readiness probe; a thrown error appears in the tracker with an alert; `securityheaders.com` grades the SPA A/A+.

---

## Phase 5 — Hardening & cleanup
**Gate:** none — ongoing hygiene, do opportunistically.

- nginx web container as non-root (`nginxinc/nginx-unprivileged`) — `apps/web/Dockerfile:19`
- CPU/memory limits in `docker-compose.prod.yml`
- Finite throttle on `POST /api/client-logs` (currently `@Public` + `@SkipThrottle`) — `client-logs.controller.ts:41`
- Remove dead `ioredis` dependency (once 4.5 decides Redis usage) — `apps/api/package.json`
- Fix/delete stale Prisma-era `scripts/post-merge.sh`
- Pin image digests (`@sha256:`) — `apps/*/Dockerfile`
- Bind dev compose Postgres/Redis to `127.0.0.1` — `docker-compose.yml:10,24`
- Bridge network instead of `network_mode: host` (or document the tradeoff)
- Delete/replace stale `docs/AUDIT.md` and `docs/DEVELOPMENT_PLAN.md` (describe the removed Prisma stack)

---

## Sequencing summary

```
Phase 0 (exploitable now) ──► Phase 1 (data loss) ──► Phase 2 (money correctness)
                                                            │
                                     Phase 3 (features) ────┤  (3 can overlap 2/4)
                                                            │
                                     Phase 4 (observability)┘ ──► Phase 5 (hygiene, ongoing)
```

Phase 0 is the only hard blocker for *any* live user. Phases 1–2 are blockers for *scaled/revenue* use. Phases 3–4 gate a *confident* full launch. Phase 5 is continuous.
