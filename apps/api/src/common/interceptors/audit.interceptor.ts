import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { UserRole } from '@sportsbooking/shared';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../decorators/current-user.decorator';

/** HTTP verb -> audit action. Non-mutating verbs are not mapped. */
const ACTION_BY_METHOD: Record<string, 'create' | 'update' | 'delete'> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

/** Roles whose mutations represent management actions worth auditing. */
const AUDITED_ROLES: ReadonlySet<UserRole> = new Set([
  UserRole.OWNER,
  UserRole.STAFF,
  UserRole.SUPER_ADMIN,
]);

/**
 * First static path segment -> singular PascalCase entity label. Segments not
 * listed fall back to a capitalised form of the segment itself.
 */
const ENTITY_BY_SEGMENT: Record<string, string> = {
  venues: 'Venue',
  offers: 'Offer',
  players: 'Player',
  tournaments: 'Tournament',
  bookings: 'Booking',
  addons: 'Addon',
  packs: 'Pack',
  owners: 'Owner',
  me: 'Branding',
  'open-matches': 'OpenMatch',
  'super-admin': 'Platform',
  auth: 'Auth',
};

/**
 * Noisy auth token routes that should never be audited. Password changes are
 * intentionally excluded so they DO get recorded.
 */
const SKIP_AUTH_PATHS = ['/auth/refresh', '/auth/logout', '/auth/login'];

/**
 * Best-effort, fire-and-forget audit logging for management mutations.
 *
 * Records an append-only AuditLog row on SUCCESSFUL mutating requests made by
 * owners/staff/super-admins. Reads and unauthenticated/public routes pass
 * straight through. Writes never throw into or delay the response pipeline.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const method: string = req?.method ?? '';
    const action = ACTION_BY_METHOD[method];

    // Non-mutating method: pass through untouched.
    if (!action) {
      return next.handle();
    }

    const user = req?.user as RequestUser | undefined;

    // Only audit authenticated management actors.
    if (!user || !AUDITED_ROLES.has(user.role)) {
      return next.handle();
    }

    const path: string = req?.route?.path ?? req?.url ?? '';

    // Skip noisy auth token routes (but keep password changes).
    if (this.isSkippedAuthRoute(path)) {
      return next.handle();
    }

    return next.handle().pipe(
      // tap only fires on success; failed/throwing requests are not logged.
      tap((response) => {
        this.record(req, user, action, response);
      }),
    );
  }

  private isSkippedAuthRoute(path: string): boolean {
    if (SKIP_AUTH_PATHS.some((p) => path.includes(p))) {
      return true;
    }
    // Auth OTP routes (request/verify) are noisy token flows; skip them.
    if (path.includes('/auth/otp')) {
      return true;
    }
    return false;
  }

  /**
   * Fire-and-forget audit write. Wrapped so nothing here can throw into or
   * delay the response pipeline.
   */
  private record(
    req: any,
    user: RequestUser,
    action: 'create' | 'update' | 'delete',
    response: unknown,
  ): void {
    try {
      const path: string = req?.route?.path ?? req?.url ?? '';
      const entity = this.deriveEntity(req);
      const entityId =
        req?.params?.id ??
        (response && typeof response === 'object'
          ? ((response as Record<string, unknown>).id as string | undefined)
          : undefined) ??
        null;

      const metadata = { method: req?.method, path };

      // Append-only log; bypass RLS so SUPER_ADMIN (no ownerId) can also write.
      void this.prisma
        .withTenantBypass((tx) =>
          tx.auditLog.create({
            data: {
              ownerId: user.ownerId ?? null,
              actorId: user.id,
              actorRole: user.role,
              action,
              entity,
              entityId,
              metadata,
            },
          }),
        )
        .catch(() => {
          /* best-effort: never surface audit failures */
        });
    } catch {
      /* best-effort: never surface audit failures */
    }
  }

  /** Derive a singular PascalCase entity label from the route's first segment. */
  private deriveEntity(req: any): string {
    const raw: string = req?.route?.path ?? req?.url ?? '';
    // Strip query string + leading slash, then take the first meaningful path
    // segment — skipping the global `api` prefix (routes are mounted under it).
    const pathOnly = raw.split('?')[0];
    const segments = pathOnly
      .replace(/^\/+/, '')
      .split('/')
      .filter(Boolean);
    if (segments[0] === 'api') segments.shift();
    const segment = segments[0] ?? '';

    if (!segment) {
      return 'Unknown';
    }
    if (ENTITY_BY_SEGMENT[segment]) {
      return ENTITY_BY_SEGMENT[segment];
    }
    // Fallback: capitalise the segment (handle kebab-case -> PascalCase).
    return segment
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }
}
