import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { otpCodes, otpRequests } from '../../db/schema';
import { NotificationService } from '../notifications/notification.service';

// Per-mobile request throttling (rolling window).
const REQUEST_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS_PER_WINDOW = 5;
// Max wrong verify attempts before the code is invalidated.
const MAX_VERIFY_ATTEMPTS = 5;

/**
 * OTP issue/verify for customer mobile login (PRD §2.1).
 *
 * Backed by Postgres (otp_codes + otp_requests) rather than an in-memory Map so
 * issued codes and the rolling request-throttle survive a restart and are shared
 * across instances. The tables are global (no tenant scope), so all access runs
 * under withTenantBypass.
 */
@Injectable()
export class OtpService {
  private readonly ttlMs: number;

  constructor(
    config: ConfigService,
    private readonly db: DbService,
    private readonly notifications: NotificationService,
  ) {
    this.ttlMs = Number(config.get('OTP_TTL_SECONDS', 300)) * 1000;
  }

  async issue(mobile: string): Promise<void> {
    await this.enforceRequestThrottle(mobile);

    const code =
      process.env.NODE_ENV === 'production'
        ? String(Math.floor(100000 + Math.random() * 900000))
        : '123456'; // deterministic in dev/test
    const expiresAt = new Date(Date.now() + this.ttlMs);

    // One active code per mobile: upsert so a re-issue replaces the prior code
    // and resets the attempt counter (mirrors Map.set()).
    await this.db.withTenantBypass((tx) =>
      tx
        .insert(otpCodes)
        .values({ mobile, code, expiresAt, attempts: 0 })
        .onConflictDoUpdate({
          target: otpCodes.mobile,
          set: { code, expiresAt, attempts: 0, createdAt: new Date() },
        }),
    );

    await this.notifications.sendSms(
      mobile,
      `Your sports booking OTP is ${code}. Valid for 5 minutes.`,
    );
  }

  async verify(mobile: string, code: string): Promise<boolean> {
    return this.db.withTenantBypass(async (tx) => {
      const entry = (
        await tx
          .select()
          .from(otpCodes)
          .where(eq(otpCodes.mobile, mobile))
          .limit(1)
      )[0];
      if (!entry) return false;

      if (entry.expiresAt.getTime() < Date.now()) {
        await tx.delete(otpCodes).where(eq(otpCodes.mobile, mobile));
        return false;
      }

      if (entry.code !== code) {
        const attempts = entry.attempts + 1;
        // Invalidate the code after too many wrong attempts.
        if (attempts >= MAX_VERIFY_ATTEMPTS) {
          await tx.delete(otpCodes).where(eq(otpCodes.mobile, mobile));
        } else {
          await tx
            .update(otpCodes)
            .set({ attempts })
            .where(eq(otpCodes.mobile, mobile));
        }
        return false;
      }

      // Single-use: consume on success.
      await tx.delete(otpCodes).where(eq(otpCodes.mobile, mobile));
      return true;
    });
  }

  /**
   * Throttle OTP requests per mobile: max MAX_REQUESTS_PER_WINDOW within a
   * rolling REQUEST_WINDOW_MS. Throws BadRequestException when exceeded. Each
   * request is one row in otp_requests; stale rows are pruned per mobile.
   */
  private async enforceRequestThrottle(mobile: string): Promise<void> {
    const now = Date.now();
    const cutoff = new Date(now - REQUEST_WINDOW_MS);
    await this.db.withTenantBypass(async (tx) => {
      // Prune this mobile's expired window entries first.
      await tx
        .delete(otpRequests)
        .where(
          and(eq(otpRequests.mobile, mobile), lt(otpRequests.createdAt, cutoff)),
        );
      const recent = await tx
        .select({ id: otpRequests.id })
        .from(otpRequests)
        .where(
          and(eq(otpRequests.mobile, mobile), gt(otpRequests.createdAt, cutoff)),
        );
      if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
        throw new BadRequestException(
          'Too many requests. Please try again later.',
        );
      }
      await tx
        .insert(otpRequests)
        .values({ id: randomUUID(), mobile, createdAt: new Date() });
    });
  }
}
