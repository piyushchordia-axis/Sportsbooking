import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
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

  /** Create a Razorpay order (amount in rupees → paise). */
  async createOrder(amountRupees: number, receipt: string): Promise<RazorpayOrder> {
    const amount = Math.round(amountRupees * 100);
    if (!this.live) {
      // Mock for dev/test; uses test keys signature locally.
      return { id: `order_mock_${receipt}`, amount, currency: 'INR' };
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Razorpay = require('razorpay');
    const client = new Razorpay({ key_id: this.keyId, key_secret: this.keySecret });
    const order = await client.orders.create({ amount, currency: 'INR', receipt });
    return { id: order.id, amount: order.amount, currency: order.currency };
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
    if (!this.keySecret) return orderId.startsWith('order_mock_'); // dev mock
    const expected = crypto
      .createHmac('sha256', this.keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    return expected === signature;
  }
}
