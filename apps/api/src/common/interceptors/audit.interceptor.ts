import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { UserRole } from '@sportsbooking/shared';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { DbService } from '../../db/db.service';
import { auditLogs } from '../../db/schema';
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

/** Request-body keys whose values must never be persisted to the audit log. */
const SENSITIVE_KEY = /pass|secret|token|otp|signature|\bpin\b|cvv|card|auth/i;

/**
 * Shallow, redacted snapshot of the submitted fields for an audited mutation —
 * the "what changed" payload (NOT a full before/after diff). Sensitive keys are
 * redacted; long strings truncated; arrays/objects summarised. Returns undefined
 * when there's nothing useful to record.
 */
function sanitizeBody(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (v === undefined) continue;
    if (SENSITIVE_KEY.test(k)) {
      out[k] = '[redacted]';
    } else if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
      out[k] =
        typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}…` : v;
    } else if (Array.isArray(v)) {
      out[k] = `[${v.length} item(s)]`;
    } else {
      out[k] = '[object]';
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Best-effort, fire-and-forget audit logging for management mutations.
 *
 * Records an append-only AuditLog row on SUCCESSFUL mutating requests made by
 * owners/staff/super-admins. Reads and unauthenticated/public routes pass
 * straight through. Writes never throw into or delay the response pipeline.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly db: DbService) {}

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

      const changes = sanitizeBody(req?.body);
      const metadata = {
        method: req?.method,
        path,
        ...(changes ? { changes } : {}),
      };

      // Append-only log; bypass RLS so SUPER_ADMIN (no ownerId) can also write.
      void this.db
        .withTenantBypass((tx) =>
          tx.insert(auditLogs).values({
            id: randomUUID(),
            ownerId: user.ownerId ?? null,
            actorId: user.id,
            actorRole: user.role,
            action,
            entity,
            entityId,
            metadata,
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
