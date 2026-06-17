import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Abstraction over WhatsApp + SMS providers (PRD §7 notifications).
 * Driver "log" prints to console in dev; "live" would call the configured
 * WhatsApp Business API / SMS gateway. DPDP opt-out is enforced by callers
 * before reaching marketing sends.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly driver: string;

  constructor(config: ConfigService) {
    this.driver = config.get<string>('NOTIFICATION_DRIVER', 'log');
  }

  async sendSms(to: string, message: string): Promise<void> {
    if (this.driver === 'log') {
      this.logger.log(`[SMS → ${to}] ${message}`);
      return;
    }
    // TODO(stage-live): call SMS gateway HTTP API.
    this.logger.warn('Live SMS driver not configured; message dropped');
  }

  async sendWhatsApp(to: string, message: string): Promise<void> {
    if (this.driver === 'log') {
      this.logger.log(`[WhatsApp → ${to}] ${message}`);
      return;
    }
    // TODO(stage-live): call WhatsApp Business API.
    this.logger.warn('Live WhatsApp driver not configured; message dropped');
  }
}
