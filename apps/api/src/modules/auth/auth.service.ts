import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  AuthTokens,
  LoginResponse,
  OwnerStatus,
  UserRole,
} from '@sportsbooking/shared';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { owners, users } from '../../db/schema';
import { NotificationService } from '../notifications/notification.service';
import { JwtPayload } from './jwt.strategy';
import { OtpService } from './otp.service';
import { StaffLoginDto, VerifyOtpDto } from './dto';

/** Roles permitted to use password-based auth (customers are OTP-only). */
const PASSWORD_ROLES: readonly UserRole[] = [
  UserRole.OWNER,
  UserRole.STAFF,
  UserRole.SUPER_ADMIN,
];

/** Shape of a refresh-token JWT payload (distinct from access tokens). */
interface RefreshTokenPayload {
  sub: string;
  jti: string;
  type: 'refresh';
  exp?: number;
}

interface ResetEntry {
  userId: string;
  expiresAt: number;
}

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

@Injectable()
export class AuthService {
  /**
   * Denylist of revoked refresh-token ids (jti → token expiry epoch ms).
   * In-memory for dev; swap for Redis in prod (TTL = token expiry) so revocation
   * survives restarts and is shared across instances. Swept lazily on access.
   */
  private readonly revokedRefreshJtis = new Map<string, number>();

  /**
   * Single-use password-reset tokens (opaque token → user id + expiry).
   * In-memory for dev; use Redis with a 15-min TTL in prod.
   */
  private readonly resetTokens = new Map<string, ResetEntry>();

  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly otp: OtpService,
    private readonly notifications: NotificationService,
  ) {}

  async requestOtp(mobile: string): Promise<{ sent: true }> {
    await this.otp.issue(mobile);
    return { sent: true };
  }

  /** Customer OTP verification — find-or-create the global customer user. */
  async verifyOtp(dto: VerifyOtpDto): Promise<LoginResponse> {
    if (!this.otp.verify(dto.mobile, dto.code)) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    // Customers are global; super admin bypasses RLS to upsert by mobile.
    const user = await this.db.withTenantBypass(async (tx) => {
      const existing = await tx.query.users.findFirst({
        where: eq(users.mobile, dto.mobile),
      });
      if (existing) return existing;
      return (
        await tx
          .insert(users)
          .values({
            id: randomUUID(),
            role: UserRole.CUSTOMER,
            name: dto.name ?? 'Player',
            mobile: dto.mobile,
          })
          .returning()
      )[0];
    });

    return this.issueTokens({
      sub: user.id,
      role: user.role as UserRole,
      ownerId: user.ownerId,
      assignedVenueIds: user.assignedVenueIds ?? undefined,
    }, user.name);
  }

  /** Owner/staff email + password login (PRD §2.1). */
  async staffLogin(dto: StaffLoginDto): Promise<LoginResponse> {
    const user = await this.db.withTenantBypass((tx) =>
      tx.query.users.findFirst({ where: eq(users.email, dto.email) }),
    );
    if (!user || !user.passwordHash || !user.active) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    // Suspended owners (and their staff) are denied access even with valid creds.
    await this.assertOwnerNotSuspended(user.ownerId);

    return this.issueTokens({
      sub: user.id,
      role: user.role as UserRole,
      ownerId: user.ownerId,
      assignedVenueIds: user.assignedVenueIds ?? undefined,
    }, user.name);
  }

  /**
   * Rotate a refresh token: verify it, ensure it is not revoked, then issue a
   * fresh access token and a new refresh token. The presented token is revoked
   * so it cannot be reused (rotation). (PRD §2.1 auth lifecycle.)
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Reject access tokens presented as refresh tokens.
    if (payload.type !== 'refresh' || !payload.jti || !payload.sub) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (this.isRefreshRevoked(payload.jti)) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    const user = await this.db.withTenantBypass((tx) =>
      tx.query.users.findFirst({ where: eq(users.id, payload.sub) }),
    );
    if (!user || !user.active) {
      throw new UnauthorizedException('User is no longer active');
    }

    // Re-check owner status on every refresh so suspension takes effect within
    // one access-token lifetime even for already-issued sessions.
    await this.assertOwnerNotSuspended(user.ownerId);

    // Rotate: revoke the presented token so it cannot be replayed.
    this.revokeRefresh(payload.jti, payload.exp);

    return this.mintTokens({
      sub: user.id,
      role: user.role as UserRole,
      ownerId: user.ownerId,
      assignedVenueIds: user.assignedVenueIds ?? undefined,
    });
  }

  /** Revoke a refresh token (logout). Idempotent and never leaks token state. */
  async logout(refreshToken: string): Promise<{ revoked: true }> {
    try {
      const payload =
        await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken);
      if (payload.type === 'refresh' && payload.jti) {
        this.revokeRefresh(payload.jti, payload.exp);
      }
    } catch {
      // Already-invalid/expired tokens need no revocation; treat as success.
    }
    return { revoked: true };
  }

  /**
   * Change the password of an authenticated owner/staff/admin user.
   * Verifies the current password before persisting the new hash.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ updated: true }> {
    const user = await this.db.withTenantBypass((tx) =>
      tx.query.users.findFirst({ where: eq(users.id, userId) }),
    );
    if (!user || !user.passwordHash || !PASSWORD_ROLES.includes(user.role as UserRole)) {
      // Customers (OTP-only) and users without a password cannot use this.
      throw new BadRequestException('Password change is not available for this account');
    }

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.db.withTenantBypass((tx) =>
      tx.update(users).set({ passwordHash }).where(eq(users.id, user.id)),
    );
    return { updated: true };
  }

  /**
   * Forgot-password step 1: if an owner/staff/admin user matches the email,
   * mint a single-use reset token and deliver it. Always returns { sent: true }
   * so callers cannot probe which emails exist.
   */
  async requestPasswordReset(email: string): Promise<{ sent: true }> {
    const user = await this.db.withTenantBypass((tx) =>
      tx.query.users.findFirst({ where: eq(users.email, email) }),
    );

    if (
      user &&
      user.active &&
      user.passwordHash &&
      PASSWORD_ROLES.includes(user.role as UserRole)
    ) {
      this.sweepResetTokens();
      const token = randomBytes(32).toString('hex');
      this.resetTokens.set(token, {
        userId: user.id,
        expiresAt: Date.now() + RESET_TOKEN_TTL_MS,
      });
      // Dev: NotificationService 'log' driver just logs this. For prod, an email
      // provider is needed (SMS is not appropriate for staff password resets).
      await this.notifications.sendSms(
        user.mobile ?? email,
        `Your password reset code is ${token}. It expires in 15 minutes.`,
      );
    }

    return { sent: true };
  }

  /**
   * Forgot-password step 2: validate the reset token, set the new password,
   * and invalidate the token (single-use).
   */
  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ updated: true }> {
    this.sweepResetTokens();
    const entry = this.resetTokens.get(token);
    if (!entry || entry.expiresAt < Date.now()) {
      this.resetTokens.delete(token);
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.db.withTenantBypass((tx) =>
      tx.update(users).set({ passwordHash }).where(eq(users.id, entry.userId)),
    );
    this.resetTokens.delete(token);
    return { updated: true };
  }

  /**
   * Reject owner/staff whose owner account has been suspended (e.g. by AMC).
   * Customers (no ownerId) and super-admin (no ownerId) are unaffected. Loaded
   * via tenant bypass since RLS would otherwise scope the lookup to the caller.
   */
  private async assertOwnerNotSuspended(ownerId: string | null): Promise<void> {
    if (!ownerId) return;
    const owner = await this.db.withTenantBypass((tx) =>
      tx.query.owners.findFirst({
        where: eq(owners.id, ownerId),
        columns: { status: true },
      }),
    );
    if (owner?.status === OwnerStatus.SUSPENDED) {
      throw new UnauthorizedException('Account suspended');
    }
  }

  private issueTokens(payload: JwtPayload, name: string): LoginResponse {
    const tokens = this.mintTokens(payload);
    return {
      ...tokens,
      user: {
        id: payload.sub,
        role: payload.role,
        ownerId: payload.ownerId,
        name,
        assignedVenueIds: payload.assignedVenueIds,
      },
    };
  }

  /** Mint an access token (full claims) + a rotated refresh token (jti+type). */
  private mintTokens(payload: JwtPayload): AuthTokens {
    const accessToken = this.jwt.sign(payload, {
      expiresIn: Number(this.config.get('JWT_ACCESS_TTL', 900)),
    });
    const refreshToken = this.jwt.sign(
      { sub: payload.sub, jti: randomUUID(), type: 'refresh' },
      { expiresIn: Number(this.config.get('JWT_REFRESH_TTL', 2592000)) },
    );
    return { accessToken, refreshToken };
  }

  private revokeRefresh(jti: string, exp?: number): void {
    // Keep the entry only until the token would expire anyway, then it is moot.
    const expiresAtMs = exp ? exp * 1000 : Date.now() + RESET_TOKEN_TTL_MS;
    this.revokedRefreshJtis.set(jti, expiresAtMs);
  }

  private isRefreshRevoked(jti: string): boolean {
    this.sweepRevoked();
    return this.revokedRefreshJtis.has(jti);
  }

  /** Drop denylist entries whose underlying token has already expired. */
  private sweepRevoked(): void {
    const now = Date.now();
    for (const [jti, expiresAt] of this.revokedRefreshJtis) {
      if (expiresAt <= now) this.revokedRefreshJtis.delete(jti);
    }
  }

  private sweepResetTokens(): void {
    const now = Date.now();
    for (const [token, entry] of this.resetTokens) {
      if (entry.expiresAt <= now) this.resetTokens.delete(token);
    }
  }
}
