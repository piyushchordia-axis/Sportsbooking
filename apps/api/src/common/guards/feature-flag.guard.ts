import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlag } from '@sportsbooking/shared';
import { eq } from 'drizzle-orm';
import { REQUIRE_FLAG_KEY } from '../decorators/require-flag.decorator';
import { RequestUser } from '../decorators/current-user.decorator';
import { DbService } from '../../db/db.service';
import { owners } from '../../db/schema';

/**
 * Enforces per-owner feature-flag entitlements (PRD §2.2). Routes opt in with
 * `@RequireFlag(FeatureFlag.X)`; this guard loads the caller's owner and rejects
 * when the flag is not present in `owner.featureFlags`.
 *
 * Owner resolution:
 *  - OWNER/STAFF callers carry `user.ownerId` directly.
 *  - CUSTOMER-facing routes acting in an owner context expose the owner via the
 *    route param / body (`ownerId`); we resolve it from there when available.
 *  - If no owner can be resolved (e.g. public browsing), the route is allowed —
 *    feature gating is an owner-side entitlement and must not break public flows.
 *
 * The owner read uses `withTenantBypass` because the guard runs before tenant
 * context is established and only reads the owner's own flag list.
 */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const flag = this.reflector.getAllAndOverride<FeatureFlag>(
      REQUIRE_FLAG_KEY,
      [context.getHandler(), context.getClass()],
    );
    // No flag metadata => not gated.
    if (!flag) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as RequestUser | undefined;

    const ownerId = this.resolveOwnerId(user, request);
    // Owner could not be resolved (e.g. a public/customer browse route without
    // an owner in scope) — do not break the flow; allow it.
    if (!ownerId) return true;

    const owner = await this.db.withTenantBypass((tx) =>
      tx.query.owners.findFirst({
        where: eq(owners.id, ownerId),
        columns: { featureFlags: true },
      }),
    );

    if (!owner || !owner.featureFlags?.includes(flag)) {
      throw new ForbiddenException(`Feature not enabled: ${flag}`);
    }
    return true;
  }

  /**
   * Resolve the owner whose entitlement governs this request. Owner/staff carry
   * `ownerId` on the JWT user; customer-context routes pass it via the route
   * params or body. Returns null when no owner is in scope.
   */
  private resolveOwnerId(
    user: RequestUser | undefined,
    request: { params?: Record<string, unknown>; body?: Record<string, unknown> },
  ): string | null {
    if (user?.ownerId) return user.ownerId;

    const fromParams = request.params?.ownerId;
    if (typeof fromParams === 'string' && fromParams) return fromParams;

    const fromBody = request.body?.ownerId;
    if (typeof fromBody === 'string' && fromBody) return fromBody;

    return null;
  }
}
