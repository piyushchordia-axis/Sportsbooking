import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt, randomUUID } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import type { DbTx } from '../../db';
import { otpCodes, otpRequests, otpVerifyAttempts } from '../../db/schema';
import { NotificationService } from '../notifications/notification.service';

// Per-mobile request throttling (rolling window).
const REQUEST_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS_PER_WINDOW = 5;
// Max wrong verify attempts before the current code is invalidated.
const MAX_VERIFY_ATTEMPTS = 5;
// Cumulative verify lockout (security H2) — counts wrong guesses across code
// re-issues so an attacker cannot reset their budget by requesting a new code.
const LOCKOUT_THRESHOLD = 10; // failed verifies within the window
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // lock for 15 minutes once tripped

/**
 * OTP issue/verify for customer mobile login (PRD §2.1).
 *
 * Backed by Postgres (otp_codes + otp_requests + otp_verify_attempts) rather
 * than in-memory Maps so issued codes, the rolling request-throttle and the
 * cumulative verify-lockout survive a restart and are shared across instances.
 * These are global (no tenant scope), so all access runs under withTenantBypass.
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
        ? String(randomInt(100000, 1000000)) // CSPRNG (not Math.random)
        : '123456'; // deterministic in dev/test
    const expiresAt = new Date(Date.now() + this.ttlMs);

    // One active code per mobile: upsert so a re-issue replaces the prior code
    // and resets the PER-CODE attempt counter. NOTE: this deliberately does NOT
    // touch otp_verify_attempts — the cumulative lockout must survive re-issue.
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
      const now = Date.now();

      // Cumulative lockout gate (survives re-issue).
      const lock = (
        await tx
          .select()
          .from(otpVerifyAttempts)
          .where(eq(otpVerifyAttempts.mobile, mobile))
          .limit(1)
      )[0];
      if (lock?.lockedUntil && lock.lockedUntil.getTime() > now) {
        throw new BadRequestException(
          'Too many incorrect attempts. Please try again later.',
        );
      }

      const entry = (
        await tx
          .select()
          .from(otpCodes)
          .where(eq(otpCodes.mobile, mobile))
          .limit(1)
      )[0];
      if (!entry) {
        await this.registerFailure(tx, mobile, lock, now);
        return false;
      }

      if (entry.expiresAt.getTime() < now) {
        // Expired code is not a wrong guess — don't penalise the cumulative
        // counter, just clear the dead code.
        await tx.delete(otpCodes).where(eq(otpCodes.mobile, mobile));
        return false;
      }

      if (entry.code !== code) {
        const attempts = entry.attempts + 1;
        // Invalidate the current code after too many wrong attempts on it.
        if (attempts >= MAX_VERIFY_ATTEMPTS) {
          await tx.delete(otpCodes).where(eq(otpCodes.mobile, mobile));
        } else {
          await tx
            .update(otpCodes)
            .set({ attempts })
            .where(eq(otpCodes.mobile, mobile));
        }
        await this.registerFailure(tx, mobile, lock, now);
        return false;
      }

      // Single-use: consume on success and clear the lockout counter.
      await tx.delete(otpCodes).where(eq(otpCodes.mobile, mobile));
      await tx
        .delete(otpVerifyAttempts)
        .where(eq(otpVerifyAttempts.mobile, mobile));
      return true;
    });
  }

  /**
   * Record one failed verify against the per-mobile cumulative counter. Within a
   * rolling window, failures accumulate across code re-issues; once they reach
   * LOCKOUT_THRESHOLD the mobile is locked for LOCKOUT_DURATION_MS. A window/lock
   * that has fully elapsed starts a fresh window.
   */
  private async registerFailure(
    tx: DbTx,
    mobile: string,
    lock:
      | {
          failedCount: number;
          windowStartedAt: Date;
          lockedUntil: Date | null;
        }
      | undefined,
    now: number,
  ): Promise<void> {
    const lockElapsed = !!lock?.lockedUntil && lock.lockedUntil.getTime() <= now;
    const windowActive =
      !!lock &&
      !lockElapsed &&
      now - lock.windowStartedAt.getTime() < LOCKOUT_WINDOW_MS;

    const failedCount = windowActive ? lock!.failedCount + 1 : 1;
    const windowStartedAt = windowActive
      ? lock!.windowStartedAt
      : new Date(now);
    const lockedUntil =
      failedCount >= LOCKOUT_THRESHOLD
        ? new Date(now + LOCKOUT_DURATION_MS)
        : null;

    await tx
      .insert(otpVerifyAttempts)
      .values({ mobile, failedCount, windowStartedAt, lockedUntil })
      .onConflictDoUpdate({
        target: otpVerifyAttempts.mobile,
        set: { failedCount, windowStartedAt, lockedUntil },
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
