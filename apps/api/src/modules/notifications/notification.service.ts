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
  private readonly isProd: boolean;

  constructor(private readonly config: ConfigService) {
    this.driver = config.get<string>('NOTIFICATION_DRIVER', 'log');
    this.isProd = config.get<string>('NODE_ENV') === 'production';

    // Fail fast at boot: in production the 'log' driver SILENTLY drops every
    // message — including the login OTP — so real players could never sign in,
    // while the API still answers `{ sent: true }`. Likewise a live driver with
    // no SMS_API_URL drops sends. Refuse to start unless SMS is really wired,
    // or the operator explicitly opts out for a console-only/demo deploy.
    const allowNoSms = config.get<string>('ALLOW_NO_SMS') === 'true';
    if (this.isProd && !allowNoSms) {
      const smsUrl = config.get<string>('SMS_API_URL');
      if (this.driver === 'log' || !smsUrl) {
        throw new Error(
          'Notifications misconfigured for production: the login OTP would never reach players. ' +
            'Set NOTIFICATION_DRIVER=live and SMS_API_URL (+ SMS_API_KEY), or set ALLOW_NO_SMS=true ' +
            'to run console-only (owner/admin password login still works; player OTP login will not).',
        );
      }
    }
  }

  /**
   * The dev 'log' driver echoes the message — but messages can contain secrets
   * (OTP codes, password-reset tokens). In production we never write the body to
   * logs; if someone left NOTIFICATION_DRIVER=log in prod we warn instead, since
   * a real provider is required (and the message is NOT actually delivered).
   */
  private logViaLogDriver(channel: string, to: string, message: string): void {
    if (this.isProd) {
      this.logger.warn(
        `[${channel} → ${to}] message suppressed: NOTIFICATION_DRIVER=log in production — configure a real provider to deliver (and avoid logging secrets).`,
      );
      return;
    }
    this.logger.log(`[${channel} → ${to}] ${message}`);
  }

  async sendSms(to: string, message: string): Promise<void> {
    if (this.driver === 'log') {
      this.logViaLogDriver('SMS', to, message);
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
      this.logViaLogDriver('WhatsApp', to, message);
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
