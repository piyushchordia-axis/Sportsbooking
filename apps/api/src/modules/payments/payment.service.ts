import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
}

export interface RazorpayRefund {
  id: string;
  status: string;
}

/**
 * Wraps Razorpay (PRD §7 payments). Creates orders for prepay bookings and
 * verifies webhook signatures for idempotent confirmation. When keys are not
 * configured (dev/test), falls back to a deterministic mock order so flows are
 * exercisable without network.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly keyId?: string;
  private readonly keySecret?: string;
  private readonly webhookSecret?: string;

  constructor(config: ConfigService) {
    this.keyId = config.get<string>('RAZORPAY_KEY_ID');
    this.keySecret = config.get<string>('RAZORPAY_KEY_SECRET');
    this.webhookSecret = config.get<string>('RAZORPAY_WEBHOOK_SECRET');
  }

  private get live(): boolean {
    return Boolean(this.keyId && this.keySecret && this.keyId.startsWith('rzp_live'));
  }

  /** Production with real keys configured — the mock path must be disabled. */
  private get enforceReal(): boolean {
    return (
      process.env.NODE_ENV === 'production' &&
      Boolean(this.keyId && this.keySecret)
    );
  }

  /** Create a Razorpay order (amount in rupees → paise). */
  async createOrder(amountRupees: number, receipt: string): Promise<RazorpayOrder> {
    const amount = Math.round(amountRupees * 100);
    // Mock only when NOT enforcing real payments (dev/test, or keys absent).
    if (!this.live && !this.enforceReal) {
      // Mock for dev/test; uses test keys signature locally.
      return { id: `order_mock_${receipt}`, amount, currency: 'INR' };
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Razorpay = require('razorpay');
    const client = new Razorpay({ key_id: this.keyId, key_secret: this.keySecret });
    const order = await client.orders.create({ amount, currency: 'INR', receipt });
    return { id: order.id, amount: order.amount, currency: order.currency };
  }

  /**
   * Refund a captured payment (amount in rupees → paise). Mirrors createOrder()'s
   * live/mock gating: when NOT enforcing real payments (dev/test, or keys absent)
   * a deterministic mock refund is returned and the gateway is never called. With
   * live keys (and prod) the real Razorpay refunds API is used.
   */
  async refund(
    paymentId: string,
    amountRupees: number,
  ): Promise<RazorpayRefund> {
    const amount = Math.round(amountRupees * 100);
    // Mock only when NOT enforcing real payments (dev/test, or keys absent).
    if (!this.live && !this.enforceReal) {
      return { id: `rfnd_mock_${paymentId}`, status: 'processed' };
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Razorpay = require('razorpay');
    const client = new Razorpay({ key_id: this.keyId, key_secret: this.keySecret });
    const refund = await client.payments.refund(paymentId, { amount });
    return { id: refund.id, status: refund.status };
  }

  /** Verify Razorpay webhook signature (HMAC SHA256). */
  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    if (!this.webhookSecret) {
      this.logger.warn('No webhook secret configured; rejecting');
      return false;
    }
    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(signature),
      );
    } catch {
      return false;
    }
  }

  /** Verify the client-side payment handshake signature. */
  verifyPaymentSignature(
    orderId: string,
    paymentId: string,
    signature: string,
  ): boolean {
    // Mock handshake in dev/test — mirror createOrder()'s mock branch (not live &&
    // not enforcing real) so a mock order can be confirmed even when placeholder
    // keys are present (e.g. RAZORPAY_KEY_SECRET=xxx). Never mock in production:
    // keys absent in prod must fail closed.
    if (!this.live && !this.enforceReal) {
      if (process.env.NODE_ENV === 'production') return false;
      return orderId.startsWith('order_mock_');
    }
    if (!this.keySecret) return false;
    const expected = crypto
      .createHmac('sha256', this.keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    return expected === signature;
  }
}
