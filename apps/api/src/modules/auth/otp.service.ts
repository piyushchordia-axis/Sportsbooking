import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from '../notifications/notification.service';

interface OtpEntry {
  code: string;
  expiresAt: number;
  attempts: number;
}

// Per-mobile request throttling (rolling window).
const REQUEST_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS_PER_WINDOW = 5;
// Max wrong verify attempts before the code is invalidated.
const MAX_VERIFY_ATTEMPTS = 5;

/**
 * OTP issue/verify for customer mobile login (PRD §2.1).
 * In-memory store for dev; swap for Redis in prod (keyed by mobile).
 */
@Injectable()
export class OtpService {
  private readonly store = new Map<string, OtpEntry>();
  /** Per-mobile request timestamps for rolling-window throttling. */
  private readonly requestLog = new Map<string, number[]>();
  private readonly ttlMs: number;

  constructor(
    config: ConfigService,
    private readonly notifications: NotificationService,
  ) {
    this.ttlMs = Number(config.get('OTP_TTL_SECONDS', 300)) * 1000;
  }

  async issue(mobile: string): Promise<void> {
    this.enforceRequestThrottle(mobile);

    const code = process.env.NODE_ENV === 'production'
      ? String(Math.floor(100000 + Math.random() * 900000))
      : '123456'; // deterministic in dev/test
    this.store.set(mobile, {
      code,
      expiresAt: Date.now() + this.ttlMs,
      attempts: 0,
    });
    await this.notifications.sendSms(
      mobile,
      `Your sports booking OTP is ${code}. Valid for 5 minutes.`,
    );
  }

  verify(mobile: string, code: string): boolean {
    const entry = this.store.get(mobile);
    if (!entry) return false;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(mobile);
      return false;
    }
    if (entry.code !== code) {
      entry.attempts += 1;
      // Invalidate the code after too many wrong attempts.
      if (entry.attempts >= MAX_VERIFY_ATTEMPTS) {
        this.store.delete(mobile);
      }
      return false;
    }
    this.store.delete(mobile);
    return true;
  }

  /**
   * Throttle OTP requests per mobile: max MAX_REQUESTS_PER_WINDOW within a
   * rolling REQUEST_WINDOW_MS. Throws BadRequestException when exceeded.
   */
  private enforceRequestThrottle(mobile: string): void {
    const now = Date.now();
    const cutoff = now - REQUEST_WINDOW_MS;
    const recent = (this.requestLog.get(mobile) ?? []).filter(
      (ts) => ts > cutoff,
    );
    if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
      this.requestLog.set(mobile, recent);
      throw new BadRequestException(
        'Too many requests. Please try again later.',
      );
    }
    recent.push(now);
    this.requestLog.set(mobile, recent);
  }
}
