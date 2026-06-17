import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BookingResponse,
  LedgerTxnType,
  PayMode,
  PaymentStatus,
} from '@sportsbooking/shared';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationService } from '../notifications/notification.service';
import { PaymentService } from '../payments/payment.service';
import { PricingService } from '../pricing/pricing.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { CreateBookingDto } from './dto';

const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Create a booking for one or more slots (PRD §6.1). Slot locking (PRD §7):
   * each slot row carries a UNIQUE(unitId, startsAt) constraint, and the whole
   * reservation runs in one transaction — a concurrent booking of the same slot
   * fails with a unique violation, which we surface as 409. Idempotency keys
   * make confirmation retry-safe.
   */
  async create(
    dto: CreateBookingDto,
    user: RequestUser | undefined,
  ): Promise<BookingResponse> {
    // Resolve the venue's owner so we can scope the whole operation.
    const venue = await this.prisma.withTenantBypass((tx) =>
      tx.venue.findUnique({ where: { id: dto.venueId } }),
    );
    if (!venue) throw new NotFoundException('Venue not found');
    const ownerId = venue.ownerId;

    return this.prisma.withTenantId(ownerId, async (tx) => {
      // Idempotency: return the existing booking on retry.
      if (dto.idempotencyKey) {
        const existing = await tx.booking.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
          include: { slots: true },
        });
        if (existing) return this.toResponse(existing, []);
      }

      const customerId = await this.resolveCustomer(tx, ownerId, dto, user);

      // 1. Price + lock each slot.
      let subtotal = new Prisma.Decimal(0);
      const slotRows: { unitId: string; startsAt: Date; endsAt: Date }[] = [];
      for (const s of dto.slots) {
        const start = DateTime.fromISO(s.start).toJSDate();
        const end = DateTime.fromISO(s.end).toJSDate();
        const durationMin = Math.round(
          (end.getTime() - start.getTime()) / 60000,
        );
        const resolved = await this.pricing.resolve(
          s.unitId,
          start,
          durationMin,
          tx,
        );
        subtotal = subtotal.add(resolved.price);
        slotRows.push({ unitId: s.unitId, startsAt: start, endsAt: end });
      }

      // 2. Add-ons as line items.
      const addons = dto.addonIds?.length
        ? await tx.addon.findMany({ where: { id: { in: dto.addonIds } } })
        : [];
      for (const a of addons) subtotal = subtotal.add(a.price);

      // 3. Apply pack/offer (minimal v1 wiring).
      let discount = new Prisma.Decimal(0);
      let packId: string | undefined;
      if (dto.packId) {
        packId = dto.packId;
        // debit one session per slot from the pack ledger lane
        await this.ledger.post(tx, {
          ownerId,
          customerId,
          type: LedgerTxnType.PACK_DEBIT,
          amount: -dto.slots.length,
          lane: `pack:${dto.packId}`,
          refType: 'booking',
          note: 'Pack sessions debited',
        });
      }
      let offerId: string | undefined;
      if (dto.offerCode) {
        const offer = await tx.offer.findFirst({
          where: { code: dto.offerCode, active: true },
        });
        if (offer) {
          offerId = offer.id;
          discount =
            offer.type === 'percent'
              ? subtotal.mul(offer.value).div(100)
              : offer.value;
        }
      }

      const total = Prisma.Decimal.max(subtotal.sub(discount), new Prisma.Decimal(0));

      // 4. Create booking + occupying slot rows (the lock).
      const booking = await tx.booking.create({
        data: {
          ownerId,
          venueId: dto.venueId,
          customerId,
          payMode: dto.payMode,
          paymentStatus:
            dto.payMode === PayMode.PREPAY
              ? PaymentStatus.PENDING
              : PaymentStatus.AWAITING_VENUE_SETTLEMENT,
          subtotal,
          discount,
          total,
          packId,
          offerId,
          idempotencyKey: dto.idempotencyKey,
        },
      });

      try {
        for (const r of slotRows) {
          await tx.slot.create({
            data: {
              unitId: r.unitId,
              ownerId,
              startsAt: r.startsAt,
              endsAt: r.endsAt,
              status: 'booked',
              bookingId: booking.id,
            },
          });
        }
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === UNIQUE_VIOLATION
        ) {
          throw new ConflictException(
            'One or more selected slots were just booked. Please pick another.',
          );
        }
        throw err;
      }

      // 5. Player capture into owner CRM (PRD §4.9).
      await this.capturePlayer(tx, ownerId, customerId);

      // 6. Payment order for prepay.
      let razorpayOrderId: string | undefined;
      if (dto.payMode === PayMode.PREPAY && total.greaterThan(0)) {
        const order = await this.payments.createOrder(
          Number(total),
          booking.id,
        );
        razorpayOrderId = order.id;
        await tx.booking.update({
          where: { id: booking.id },
          data: { razorpayOrderId },
        });
      }

      const lineItems = [
        { label: `${dto.slots.length} slot(s)`, amount: Number(subtotal.sub(
            addons.reduce((acc, a) => acc.add(a.price), new Prisma.Decimal(0)),
          )) },
        ...addons.map((a) => ({ label: a.name, amount: Number(a.price) })),
      ];
      if (discount.greaterThan(0)) {
        lineItems.push({ label: 'Discount', amount: -Number(discount) });
      }

      await this.notifications.sendWhatsApp(
        venue.contactPhone ?? '',
        `Booking ${booking.id} confirmed for ${dto.slots.length} slot(s).`,
      );

      return { ...this.toResponse(booking, lineItems), razorpayOrderId };
    });
  }

  private async resolveCustomer(
    tx: Prisma.TransactionClient,
    ownerId: string,
    dto: CreateBookingDto,
    user: RequestUser | undefined,
  ): Promise<string> {
    if (user?.role === 'customer') return user.id;
    if (dto.customer) {
      // walk-in / capture by mobile (PRD §4.3 manual bookings, §4.9)
      const existing = await tx.user.findUnique({
        where: { mobile: dto.customer.mobile },
      });
      if (existing) return existing.id;
      const created = await tx.user.create({
        data: {
          role: 'customer',
          name: dto.customer.name,
          mobile: dto.customer.mobile,
        },
      });
      return created.id;
    }
    throw new NotFoundException('No customer context for booking');
  }

  private async capturePlayer(
    tx: Prisma.TransactionClient,
    ownerId: string,
    customerId: string,
  ): Promise<void> {
    const user = await tx.user.findUnique({ where: { id: customerId } });
    if (!user) return;
    await tx.ownerCustomer.upsert({
      where: { ownerId_customerId: { ownerId, customerId } },
      create: {
        ownerId,
        customerId,
        bookingCount: 1,
        lastVisitAt: new Date(),
      },
      update: {
        bookingCount: { increment: 1 },
        lastVisitAt: new Date(),
      },
    });
    await tx.playerProfile.upsert({
      where: { ownerId_customerId: { ownerId, customerId } },
      create: {
        ownerId,
        customerId,
        name: user.name,
        mobile: user.mobile ?? '',
      },
      update: {},
    });
  }

  private toResponse(
    booking: {
      id: string;
      status: string;
      payMode: string;
      paymentStatus: string;
      total: Prisma.Decimal;
    },
    lineItems: { label: string; amount: number }[],
  ): BookingResponse {
    return {
      id: booking.id,
      status: booking.status,
      payMode: booking.payMode as PayMode,
      paymentStatus: booking.paymentStatus as PaymentStatus,
      total: Number(booking.total),
      lineItems,
    };
  }
}
