import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from '../notifications/notification.service';

interface OtpEntry {
  code: string;
  expiresAt: number;
}

/**
 * OTP issue/verify for customer mobile login (PRD §2.1).
 * In-memory store for dev; swap for Redis in prod (keyed by mobile).
 */
@Injectable()
export class OtpService {
  private readonly store = new Map<string, OtpEntry>();
  private readonly ttlMs: number;

  constructor(
    config: ConfigService,
    private readonly notifications: NotificationService,
  ) {
    this.ttlMs = Number(config.get('OTP_TTL_SECONDS', 300)) * 1000;
  }

  async issue(mobile: string): Promise<void> {
    const code = process.env.NODE_ENV === 'production'
      ? String(Math.floor(100000 + Math.random() * 900000))
      : '123456'; // deterministic in dev/test
    this.store.set(mobile, { code, expiresAt: Date.now() + this.ttlMs });
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
    if (entry.code !== code) return false;
    this.store.delete(mobile);
    return true;
  }
}
