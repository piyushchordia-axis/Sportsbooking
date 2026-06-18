---
name: Tenant authorization on owner/staff mutations
description: Role-guarded endpoints that resolve tenant from the target entity (not the caller) need an explicit owner-match check, or any tenant can mutate another's rows by id.
---

# Tenant authorization on owner/staff mutations

Some mutation services look up the target row with `withTenantBypass` (RLS off),
read its `ownerId`, then re-scope writes with `withTenantId(entity.ownerId)`.
This pattern derives the tenant from the **entity id**, not the authenticated
caller, so `@Roles(OWNER, STAFF)` + `RolesGuard` alone does NOT stop an owner
from acting on another tenant's row by guessing/knowing its id.

**Rule:** for owner/staff-initiated mutations on a specific entity id (e.g.
booking settle), pass `@CurrentUser()` into the service and verify
`user.ownerId === entity.ownerId` (throw `ForbiddenException` otherwise) before
mutating. Keep the check conditional on a user being present so public,
signature-verified callbacks (e.g. Razorpay prepay confirmation calling the same
`markPaid`) still work without a user.

**Why:** found while wiring the owner "mark settled" action — `settle` was
role-guarded but not tenant-authorized, allowing cross-tenant settlement.

**How to apply:** audit any service method that starts with
`withTenantBypass(... findUnique by id ...)` then `withTenantId(found.ownerId)`
and is reachable from an owner/staff route. The public booking-create endpoint
is intentionally `@Public()` (guests book too) and derives tenant from the
venue — that one is by design, not a gap.
