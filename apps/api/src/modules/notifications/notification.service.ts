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

  constructor(private readonly config: ConfigService) {
    this.driver = config.get<string>('NOTIFICATION_DRIVER', 'log');
  }

  async sendSms(to: string, message: string): Promise<void> {
    if (this.driver === 'log') {
      this.logger.log(`[SMS → ${to}] ${message}`);
      return;
    }

    const url = this.config.get<string>('SMS_API_URL');
    if (!url) {
      this.logger.error(
        `SMS_API_URL not configured; cannot deliver live SMS to ${to}`,
      );
      return;
    }

    const apiKey = this.config.get<string>('SMS_API_KEY');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = apiKey;
    }

    await this.post('SMS', url, headers, { to, message });
  }

  async sendWhatsApp(to: string, message: string): Promise<void> {
    if (this.driver === 'log') {
      this.logger.log(`[WhatsApp → ${to}] ${message}`);
      return;
    }

    const url = this.config.get<string>('WHATSAPP_API_URL');
    if (!url) {
      this.logger.error(
        `WHATSAPP_API_URL not configured; cannot deliver live WhatsApp to ${to}`,
      );
      return;
    }

    const token = this.config.get<string>('WHATSAPP_API_TOKEN');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    await this.post('WhatsApp', url, headers, { to, message });
  }

  /**
   * POST a JSON payload to a gateway. Network failures and non-2xx responses
   * are logged (never thrown) so a delivery failure does not break callers.
   */
  private async post(
    channel: string,
    url: string,
    headers: Record<string, string>,
    payload: { to: string; message: string },
  ): Promise<void> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(
          `${channel} gateway responded ${res.status} for ${payload.to}: ${body}`,
        );
        return;
      }
      this.logger.log(`[${channel} → ${payload.to}] delivered via gateway`);
    } catch (err) {
      this.logger.error(
        `${channel} gateway request failed for ${payload.to}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
