import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Logger,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { UserRole } from '@sportsbooking/shared';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DbService } from '../../db/db.service';
import { bookings as bookingsTable } from '../../db/schema';
import { BookingsService } from '../bookings/bookings.service';
import { PaymentService } from './payment.service';
import { PaymentLedgerService } from './payment-ledger.service';

/**
 * Server-to-server Razorpay webhook (PRD §7). Razorpay POSTs payment events and
 * signs the raw body with RAZORPAY_WEBHOOK_SECRET; we verify that HMAC before
 * acting. On a valid `payment.captured` event the matching booking is settled
 * idempotently — webhooks may be retried, so a second delivery is a no-op.
 */
@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly payments: PaymentService,
    private readonly paymentLedger: PaymentLedgerService,
    private readonly db: DbService,
    // BookingsService isn't exported by its module; resolve it lazily from the
    // app container so the webhook can reuse the idempotent confirm logic
    // without creating a module-level circular import.
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Owner/staff gateway transaction history (captures + refunds), optionally
   * scoped to one booking or tournament participant. Tenant-isolated by an
   * explicit ownerId filter derived from the authenticated user.
   */
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('refType') refType?: string,
    @Query('refId') refId?: string,
  ) {
    return this.paymentLedger.list({ ownerId: user.ownerId!, refType, refId });
  }

  @Public()
  @Post('webhook')
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    const rawBody = req.rawBody;
    if (!rawBody || !signature) {
      throw new BadRequestException('Missing webhook body or signature');
    }

    const raw = rawBody.toString('utf8');
    if (!this.payments.verifyWebhookSignature(raw, signature)) {
      throw new BadRequestException('Invalid webhook signature');
    }

    let event: WebhookEvent;
    try {
      event = JSON.parse(raw) as WebhookEvent;
    } catch {
      throw new BadRequestException('Malformed webhook payload');
    }

    if (event.event === 'payment.captured') {
      const entity = event.payload?.payment?.entity;
      const orderId = entity?.order_id;
      const paymentId = entity?.id;
      if (!orderId) {
        this.logger.warn('payment.captured without order_id; ignoring');
        return { received: true as const };
      }

      const booking = await this.db.withTenantBypass((tx) =>
        tx.query.bookings.findFirst({
          where: eq(bookingsTable.razorpayOrderId, orderId),
        }),
      );
      if (!booking) {
        this.logger.warn(`No booking for order ${orderId}; ignoring`);
        return { received: true as const };
      }

      // markPaid is idempotent: a redelivered webhook won't re-credit anything.
      const bookings = this.moduleRef.get(BookingsService, { strict: false });
      // Persist the gateway payment id so a later cancel can issue a refund;
      // without it webhook-settled prepay bookings store razorpayPaymentId=null
      // and become non-refundable.
      await bookings.markPaid(booking.id, undefined, paymentId);
    }

    return { received: true as const };
  }
}

interface WebhookEvent {
  event: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
      };
    };
  };
}
