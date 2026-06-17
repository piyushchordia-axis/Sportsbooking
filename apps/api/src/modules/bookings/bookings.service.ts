import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BookingResponse,
  BookingStatus,
  PayMode,
  PaymentStatus,
} from '@sportsbooking/shared';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { MembershipsService } from '../memberships/memberships.service';
import { NotificationService } from '../notifications/notification.service';
import { PaymentService } from '../payments/payment.service';
import { PricingService } from '../pricing/pricing.service';
import { ReferralService } from '../referral/referral.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { CreateBookingDto } from './dto';

const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly memberships: MembershipsService,
    private readonly loyalty: LoyaltyService,
    private readonly referral: ReferralService,
    private readonly payments: PaymentService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Create a booking for one or more slots (PRD §6.1). Slot locking (PRD §7):
   * each slot row carries a UNIQUE(unitId, startsAt) constraint and the whole
   * reservation runs in one transaction — a concurrent booking of the same slot
   * fails with a unique violation surfaced as 409. Pack/points/offer are
   * applied to the total; ledger debits happen only after the lock succeeds.
   */
  async create(
    dto: CreateBookingDto,
    user: RequestUser | undefined,
  ): Promise<BookingResponse> {
    const venue = await this.prisma.withTenantBypass((tx) =>
      tx.venue.findUnique({ where: { id: dto.venueId } }),
    );
    if (!venue) throw new NotFoundException('Venue not found');
    const ownerId = venue.ownerId;

    return this.prisma.withTenantId(ownerId, async (tx) => {
      if (dto.idempotencyKey) {
        const existing = await tx.booking.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existing) return this.toResponse(existing, []);
      }

      const customerId = await this.resolveCustomer(tx, dto, user);

      // 1. Price each slot (resolved per-court dynamic price).
      let slotSubtotal = new Prisma.Decimal(0);
      const slotRows: { unitId: string; startsAt: Date; endsAt: Date }[] = [];
      const unitIds = new Set<string>();
      for (const s of dto.slots) {
        const start = DateTime.fromISO(s.start).toJSDate();
        const end = DateTime.fromISO(s.end).toJSDate();
        const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);
        const resolved = await this.pricing.resolve(s.unitId, start, durationMin, tx);
        slotSubtotal = slotSubtotal.add(resolved.price);
        slotRows.push({ unitId: s.unitId, startsAt: start, endsAt: end });
        unitIds.add(s.unitId);
      }

      // 2. Add-ons.
      const addons = dto.addonIds?.length
        ? await tx.addon.findMany({ where: { id: { in: dto.addonIds } } })
        : [];
      const addonSubtotal = addons.reduce(
        (acc, a) => acc.add(a.price),
        new Prisma.Decimal(0),
      );

      // 3. Pack (evaluate only; debit after the lock).
      let packDiscount = new Prisma.Decimal(0);
      let packSessions = 0;
      if (dto.packId) {
        const app = await this.memberships.evaluatePack(
          tx,
          dto.packId,
          customerId,
          dto.venueId,
          [...unitIds],
          dto.slots.length,
          slotSubtotal,
        );
        packDiscount = app.discount;
        packSessions = app.sessions;
      }

      // 4. Offer (applied to the post-pack slot + addon amount).
      let offerId: string | undefined;
      let offerDiscount = new Prisma.Decimal(0);
      if (dto.offerCode) {
        const now = new Date();
        const offer = await tx.offer.findFirst({
          where: {
            code: dto.offerCode,
            active: true,
            AND: [
              { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
              { OR: [{ validTo: null }, { validTo: { gte: now } }] },
              { OR: [{ venueIds: { isEmpty: true } }, { venueIds: { has: dto.venueId } }] },
            ],
          },
        });
        if (offer) {
          offerId = offer.id;
          const base = slotSubtotal.sub(packDiscount).add(addonSubtotal);
          offerDiscount =
            offer.type === 'percent'
              ? base.mul(offer.value).div(100)
              : Prisma.Decimal.min(offer.value, base);
        }
      }

      // 5. Loyalty points redemption (capped to remaining + balance).
      let pointsRedeemed = 0;
      let pointsValue = new Prisma.Decimal(0);
      if (dto.pointsToRedeem && dto.pointsToRedeem > 0) {
        const owner = await tx.owner.findUnique({ where: { id: ownerId } });
        const redeemValue = Number(owner?.loyaltyRedeemValue ?? 1);
        const balance = Number(await this.loyalty.pointsBalance(tx, customerId));
        const remaining = Number(
          slotSubtotal.sub(packDiscount).add(addonSubtotal).sub(offerDiscount),
        );
        const maxByCash = redeemValue > 0 ? Math.floor(remaining / redeemValue) : 0;
        pointsRedeemed = Math.min(dto.pointsToRedeem, balance, maxByCash);
        pointsValue = new Prisma.Decimal(pointsRedeemed).mul(redeemValue);
      }

      const total = Prisma.Decimal.max(
        slotSubtotal
          .sub(packDiscount)
          .add(addonSubtotal)
          .sub(offerDiscount)
          .sub(pointsValue),
        new Prisma.Decimal(0),
      );

      // 6. Create booking + occupying slot rows (the lock).
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
          subtotal: slotSubtotal.add(addonSubtotal),
          discount: packDiscount.add(offerDiscount),
          total,
          packId: dto.packId,
          offerId,
          pointsRedeemed: pointsValue,
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

      // 7. Ledger debits (only after the lock held).
      if (dto.packId && packSessions > 0) {
        await this.memberships.debitSessions(
          tx,
          ownerId,
          customerId,
          dto.packId,
          packSessions,
          booking.id,
        );
      }
      if (pointsRedeemed > 0) {
        await this.loyalty.redeem(tx, ownerId, customerId, pointsRedeemed, booking.id);
      }

      // 8. Player capture into owner CRM (PRD §4.9).
      await this.capturePlayer(tx, ownerId, customerId);

      // 9. Decrement add-on stock where tracked.
      for (const a of addons) {
        if (a.stock != null) {
          await tx.addon.update({
            where: { id: a.id },
            data: { stock: { decrement: 1 } },
          });
        }
      }

      // 10. Razorpay order for prepay.
      let razorpayOrderId: string | undefined;
      if (dto.payMode === PayMode.PREPAY && total.greaterThan(0)) {
        const order = await this.payments.createOrder(Number(total), booking.id);
        razorpayOrderId = order.id;
        await tx.booking.update({
          where: { id: booking.id },
          data: { razorpayOrderId },
        });
      }

      await this.notifications.sendWhatsApp(
        venue.contactPhone ?? '',
        `Booking ${booking.id} confirmed for ${dto.slots.length} slot(s).`,
      );

      const lineItems = [
        { label: `${dto.slots.length} slot(s)`, amount: Number(slotSubtotal) },
        ...addons.map((a) => ({ label: a.name, amount: Number(a.price) })),
      ];
      if (packDiscount.greaterThan(0))
        lineItems.push({ label: 'Pack', amount: -Number(packDiscount) });
      if (offerDiscount.greaterThan(0))
        lineItems.push({ label: 'Offer', amount: -Number(offerDiscount) });
      if (pointsValue.greaterThan(0))
        lineItems.push({ label: 'Points', amount: -Number(pointsValue) });

      return { ...this.toResponse(booking, lineItems), razorpayOrderId };
    });
  }

  /**
   * Mark a booking paid/settled → earn loyalty and release any referral reward
   * (PRD §4.5). Idempotent: a second call after the booking is already paid is
   * a no-op. Used by prepay confirmation and pay-at-venue settlement.
   */
  async markPaid(bookingId: string): Promise<{ paid: true }> {
    const booking = await this.prisma.withTenantBypass((tx) =>
      tx.booking.findUnique({ where: { id: bookingId } }),
    );
    if (!booking) throw new NotFoundException('Booking not found');

    return this.prisma.withTenantId(booking.ownerId, async (tx) => {
      const fresh = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!fresh) throw new NotFoundException('Booking not found');
      if (
        fresh.paymentStatus === PaymentStatus.PAID ||
        fresh.paymentStatus === PaymentStatus.SETTLED_AT_VENUE
      ) {
        return { paid: true as const };
      }

      await tx.booking.update({
        where: { id: bookingId },
        data: {
          paymentStatus:
            fresh.payMode === PayMode.PREPAY
              ? PaymentStatus.PAID
              : PaymentStatus.SETTLED_AT_VENUE,
        },
      });

      await this.loyalty.earn(
        tx,
        fresh.ownerId,
        fresh.customerId,
        fresh.total,
        bookingId,
      );
      await this.referral.releaseOnFirstPaid(tx, fresh.ownerId, fresh.customerId);
      return { paid: true as const };
    });
  }

  /**
   * Cancel a booking: free the slots and return pack sessions / redeemed points
   * to the ledger (PRD §4.4 — cancellation returns session credit, not cash).
   */
  async cancel(bookingId: string): Promise<{ cancelled: true }> {
    const booking = await this.prisma.withTenantBypass((tx) =>
      tx.booking.findUnique({ where: { id: bookingId }, include: { slots: true } }),
    );
    if (!booking) throw new NotFoundException('Booking not found');

    return this.prisma.withTenantId(booking.ownerId, async (tx) => {
      const fresh = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { slots: true },
      });
      if (!fresh || fresh.status === BookingStatus.CANCELLED) {
        return { cancelled: true as const };
      }

      await tx.slot.deleteMany({ where: { bookingId } });
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.CANCELLED },
      });

      if (fresh.packId) {
        await this.memberships.refundSessions(
          tx,
          fresh.ownerId,
          fresh.customerId,
          fresh.packId,
          fresh.slots.length,
          bookingId,
        );
      }
      if (fresh.pointsRedeemed.greaterThan(0)) {
        await this.loyalty.creditRefund(
          tx,
          fresh.ownerId,
          fresh.customerId,
          fresh.pointsRedeemed,
          bookingId,
        );
      }
      return { cancelled: true as const };
    });
  }

  private async resolveCustomer(
    tx: Prisma.TransactionClient,
    dto: CreateBookingDto,
    user: RequestUser | undefined,
  ): Promise<string> {
    if (user?.role === 'customer') return user.id;
    if (dto.customer) {
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
      create: { ownerId, customerId, bookingCount: 1, lastVisitAt: new Date() },
      update: { bookingCount: { increment: 1 }, lastVisitAt: new Date() },
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
