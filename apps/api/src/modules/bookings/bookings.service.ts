import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  BookingResponse,
  BookingStatus,
  LedgerTxnType,
  OwnerBooking,
  PayMode,
  PaymentStatus,
  UserRole,
} from '@sportsbooking/shared';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { LoyaltyService, pointsLane } from '../loyalty/loyalty.service';
import { MembershipsService } from '../memberships/memberships.service';
import { NotificationService } from '../notifications/notification.service';
import { PaymentService } from '../payments/payment.service';
import { PricingService } from '../pricing/pricing.service';
import { ReferralService } from '../referral/referral.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { CartSlotDto, CreateBookingDto, ListBookingsQueryDto } from './dto';

const UNIQUE_VIOLATION = 'P2002';

/** Cash lane: a positive balance is money returned to the customer (refunds). */
const CASH_LANE = 'cash';
/** Dues lane: a positive balance is money the customer OWES (e.g. no-show fee). */
const DUES_LANE = 'dues';

/**
 * Owner cancellation policy templates (VenueSettings.cancellationTemplate).
 * Each template defines a free-cancellation window (hours before the first
 * slot) and a penalty (% of the amount paid) charged inside that window.
 * Unknown/absent template → full refund, no fee (legacy behaviour).
 */
const CANCELLATION_TEMPLATES: Record<
  string,
  { freeWindowHours: number; penaltyPct: number }
> = {
  flexible: { freeWindowHours: 4, penaltyPct: 50 },
  moderate: { freeWindowHours: 12, penaltyPct: 50 },
  strict: { freeWindowHours: 24, penaltyPct: 100 },
};

/**
 * A booking as seen by the owning customer in their history (PRD BOOK-12):
 * venue/court names, slot time(s), amount and status.
 */
export interface CustomerBooking {
  id: string;
  status: BookingStatus;
  payMode: PayMode;
  paymentStatus: PaymentStatus;
  total: number;
  venueId: string;
  venueName: string;
  slots: {
    unitId: string;
    unitName: string;
    start: string; // ISO
    end: string; // ISO
  }[];
  createdAt: string; // ISO
}

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly memberships: MembershipsService,
    private readonly loyalty: LoyaltyService,
    private readonly referral: ReferralService,
    private readonly payments: PaymentService,
    private readonly notifications: NotificationService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Create a booking for one or more slots (PRD §6.1). Slot locking (PRD §7):
   * each slot row carries a UNIQUE(unitId, startsAt) constraint and the whole
   * reservation runs in one transaction — a concurrent booking of the same slot
   * fails with a unique violation surfaced as 409. Pack/points/offer are
   * applied to the total; ledger debits happen only after the lock succeeds.
   *
   * Optional weekly recurrence (PRD §5.2 v1): when `dto.recurrence` is present
   * the booking is repeated weekly (same court(s), same time-of-day, +7 days
   * each) for `count` occurrences, all sharing one generated `seriesId`. Each
   * occurrence is priced/validated independently INSIDE the same transaction;
   * an occurrence whose slot(s) are already taken/blocked is SKIPPED and
   * reported as a conflict rather than failing the whole series. Recurrence is
   * v1-restricted to AT_VENUE pay mode (PREPAY + recurrence is rejected) so we
   * never juggle multiple Razorpay orders or silently mischarge. The response
   * stays backward-compatible: the FIRST created occurrence is returned exactly
   * as today, with a `series` summary added only when recurrence was requested.
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

    // v1 recurrence is AT_VENUE-only: each occurrence is priced and settled on
    // the ground, so there is no multi-order PREPAY complexity. Reject PREPAY +
    // recurrence outright (rather than silently mixing pay modes) so the caller
    // gets a clear, predictable contract and is never mischarged.
    if (dto.recurrence && dto.payMode === PayMode.PREPAY) {
      throw new BadRequestException(
        'Recurring bookings are only supported for pay-at-venue. Please choose pay-at-venue or book a single slot.',
      );
    }

    return this.prisma.withTenantId(ownerId, async (tx) => {
      if (dto.idempotencyKey) {
        const existing = await tx.booking.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existing) return this.toResponse(existing, []);
      }

      const customerId = await this.resolveCustomer(tx, dto, user);

      // Non-recurring (today's behaviour, response shape unchanged).
      if (!dto.recurrence) {
        return this.createOccurrence(tx, {
          dto,
          venue,
          ownerId,
          customerId,
          slotInputs: dto.slots,
          payMode: dto.payMode,
        });
      }

      // Recurring: generate the series id and create one occurrence per week.
      // Each occurrence reuses the SAME pricing/offer/addon/slot path; a clash
      // is skipped (recorded as a conflict) instead of aborting the series. The
      // idempotency key (if any) is consumed by the FIRST created occurrence
      // only — subsequent occurrences must not collide on the unique key.
      const seriesId = randomUUID();
      const occurrences = this.weeklyOccurrences(dto.slots, dto.recurrence.count);

      let first: BookingResponse | null = null;
      const skipped: { start: string; reason: string }[] = [];
      let created = 0;

      for (let i = 0; i < occurrences.length; i++) {
        const slotInputs = occurrences[i];
        const conflict = await this.findSlotConflict(tx, slotInputs);
        if (conflict) {
          skipped.push({ start: slotInputs[0].start, reason: conflict });
          continue;
        }
        const res = await this.createOccurrence(tx, {
          dto,
          venue,
          ownerId,
          customerId,
          slotInputs,
          payMode: dto.payMode,
          seriesId,
          // only the first occurrence may carry the client idempotency key
          idempotencyKey: created === 0 ? dto.idempotencyKey : undefined,
        });
        created++;
        if (!first) first = res;
      }

      const summary = { seriesId, created, skipped };

      // Every occurrence clashed → nothing created. Surface a clear 409 rather
      // than returning an empty/confusing payload.
      if (!first) {
        throw new ConflictException(
          'None of the requested recurring slots were available.',
        );
      }
      return { ...first, series: summary };
    });
  }

  /**
   * Create a single booking occurrence (the original create() body, factored
   * out so the recurring path reuses the exact same pricing/offer/addon/slot/
   * ledger/payment logic). Runs inside the caller's transaction.
   */
  private async createOccurrence(
    tx: Prisma.TransactionClient,
    args: {
      dto: CreateBookingDto;
      venue: { id: string; ownerId: string; name: string; contactPhone: string | null };
      ownerId: string;
      customerId: string;
      slotInputs: { unitId: string; start: string; end: string }[];
      payMode: PayMode;
      seriesId?: string;
      idempotencyKey?: string;
    },
  ): Promise<BookingResponse> {
    const { dto, venue, ownerId, customerId, slotInputs, payMode } = args;

      // 1. Price each slot (resolved per-court dynamic price).
      let slotSubtotal = new Prisma.Decimal(0);
      const slotRows: { unitId: string; startsAt: Date; endsAt: Date }[] = [];
      const unitIds = new Set<string>();
      for (const s of slotInputs) {
        const start = DateTime.fromISO(s.start).toJSDate();
        const end = DateTime.fromISO(s.end).toJSDate();
        const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);
        const resolved = await this.pricing.resolve(s.unitId, start, durationMin, tx);
        slotSubtotal = slotSubtotal.add(resolved.price);
        slotRows.push({ unitId: s.unitId, startsAt: start, endsAt: end });
        unitIds.add(s.unitId);
      }

      // 2. Add-ons. Scope the lookup to this venue's owner + venue and active
      // add-ons only (defense-in-depth): the dev DB connects as a superuser that
      // BYPASSES RLS, so an unscoped findMany would let a customer reference
      // another venue's add-ons. Reject if any requested id is missing/out-of-scope.
      const addons = dto.addonIds?.length
        ? await tx.addon.findMany({
            where: {
              id: { in: dto.addonIds },
              ownerId: venue.ownerId,
              venueId: dto.venueId,
              active: true,
            },
          })
        : [];
      if (dto.addonIds?.length && addons.length !== dto.addonIds.length) {
        throw new BadRequestException('Invalid add-on for this venue');
      }
      const addonSubtotal = addons.reduce(
        (acc, a) => acc.add(a.price),
        new Prisma.Decimal(0),
      );

      // 3. Pack (evaluate only; debit after the lock).
      let packDiscount = new Prisma.Decimal(0);
      let packSessions = 0;
      if (dto.packId) {
        const app = await this.memberships.evaluatePack(
          venue.ownerId,
          customerId,
          dto.packId,
          tx,
          dto.venueId,
          [...unitIds],
          slotInputs.length,
          slotSubtotal,
        );
        packDiscount = app.discount;
        packSessions = app.sessions;
      }

      // 4. Offer (applied to the post-pack slot + addon amount). When an
      // explicit code is supplied we match by code; otherwise we auto-apply the
      // best valid auto-apply offer. In BOTH paths we honour the offer's
      // validity window, venue scope, game scope and segment targeting.
      const offerBase = slotSubtotal.sub(packDiscount).add(addonSubtotal);
      const bookedGameIds = await this.gameIdsForUnits(tx, [...unitIds]);
      const customerSegments = await this.segmentsForCustomer(
        tx,
        ownerId,
        customerId,
      );
      const offerApp = await this.resolveOffer(tx, {
        ownerId,
        venueId: dto.venueId,
        offerCode: dto.offerCode,
        base: offerBase,
        bookedGameIds,
        customerSegments,
      });
      const offerId = offerApp?.offerId;
      const offerDiscount = offerApp?.discount ?? new Prisma.Decimal(0);

      // 5. Loyalty points redemption (capped to remaining + balance).
      let pointsRedeemed = 0;
      let pointsValue = new Prisma.Decimal(0);
      if (dto.pointsToRedeem && dto.pointsToRedeem > 0) {
        const redeemValue = await this.loyalty.redeemValueFor(
          tx,
          ownerId,
          dto.venueId,
        );
        const balance = Number(
          await this.loyalty.pointsBalance(tx, ownerId, customerId),
        );
        // Cap the points to what the remaining cash can absorb. Keep the
        // computation in Decimal (BUG-13) so we never lose precision through
        // float division before flooring to whole points.
        const remaining = slotSubtotal
          .sub(packDiscount)
          .add(addonSubtotal)
          .sub(offerDiscount);
        const maxByCash =
          redeemValue > 0
            ? remaining
                .div(redeemValue)
                .floor()
                .toNumber()
            : 0;
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
          payMode,
          paymentStatus:
            payMode === PayMode.PREPAY
              ? PaymentStatus.PENDING
              : PaymentStatus.AWAITING_VENUE_SETTLEMENT,
          subtotal: slotSubtotal.add(addonSubtotal),
          discount: packDiscount.add(offerDiscount),
          total,
          packId: dto.packId,
          offerId,
          pointsRedeemed: pointsValue,
          seriesId: args.seriesId,
          idempotencyKey: args.idempotencyKey,
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
        await this.loyalty.redeem(
          tx,
          ownerId,
          customerId,
          pointsRedeemed,
          booking.id,
          dto.venueId,
        );
      }

      // 8. Player capture into owner CRM (PRD §4.9).
      await this.capturePlayer(tx, ownerId, customerId);

      // 9. Persist the selected add-ons (BUG-5) and decrement tracked stock.
      // Without the BookingAddon rows add-on revenue reports are always zero,
      // even though the price is charged and stock is decremented. We record one
      // row per add-on capturing the price charged at booking time (unitPrice)
      // so reports stay correct even if the catalogue price later changes.
      for (const a of addons) {
        await tx.bookingAddon.create({
          data: {
            bookingId: booking.id,
            addonId: a.id,
            unitPrice: a.price,
            quantity: 1,
          },
        });
        if (a.stock != null) {
          await tx.addon.update({
            where: { id: a.id },
            data: { stock: { decrement: 1 } },
          });
        }
      }

      // 10. Razorpay order for prepay — but only when there is money to collect.
      let razorpayOrderId: string | undefined;
      if (payMode === PayMode.PREPAY) {
        if (total.greaterThan(0)) {
          const order = await this.payments.createOrder(Number(total), booking.id);
          razorpayOrderId = order.id;
          await tx.booking.update({
            where: { id: booking.id },
            data: { razorpayOrderId },
          });
        } else {
          // BUG-7: a fully-discounted prepay booking has nothing to charge, so
          // no Razorpay order is created and confirmPayment() can never settle
          // it — it would hang in PENDING forever. Mark it PAID immediately
          // (mirroring markPaid's PREPAY branch) so it never gets stuck. There
          // is no cash spend, so loyalty earn (floor(0 * rate) = 0) is a no-op;
          // we keep markPaid's referral release for parity with a paid booking.
          await tx.booking.update({
            where: { id: booking.id },
            data: { paymentStatus: PaymentStatus.PAID },
          });
          await this.loyalty.earn(
            tx,
            ownerId,
            customerId,
            total,
            booking.id,
            dto.venueId,
          );
          await this.referral.releaseOnFirstPaid(tx, ownerId, customerId);
          // Reflect the settled status in the response payload below.
          booking.paymentStatus = PaymentStatus.PAID as typeof booking.paymentStatus;
        }
      }

      await this.notifications.sendWhatsApp(
        venue.contactPhone ?? '',
        `Booking ${booking.id} confirmed for ${slotInputs.length} slot(s).`,
      );

      // PRD-9: ALSO confirm to the CUSTOMER's mobile (WhatsApp + SMS). The
      // venue-only notification above left the customer in the dark. This is
      // strictly best-effort — a notification failure must never fail or roll
      // back the booking, so it is fired-and-forgotten with its own guard.
      void this.notifyCustomerBookingConfirmed(
        customerId,
        venue.name,
        slotInputs.length,
      );

      const lineItems = [
        { label: `${slotInputs.length} slot(s)`, amount: Number(slotSubtotal) },
        ...addons.map((a) => ({ label: a.name, amount: Number(a.price) })),
      ];
      if (packDiscount.greaterThan(0))
        lineItems.push({ label: 'Pack', amount: -Number(packDiscount) });
      if (offerDiscount.greaterThan(0))
        lineItems.push({ label: 'Offer', amount: -Number(offerDiscount) });
      if (pointsValue.greaterThan(0))
        lineItems.push({ label: 'Points', amount: -Number(pointsValue) });

      return { ...this.toResponse(booking, lineItems), razorpayOrderId };
  }

  /**
   * Expand a single occurrence's slots into `count` weekly occurrences: the
   * first is the original, each subsequent one shifts every slot's start/end by
   * +7 days, preserving the time-of-day. Done in luxon so DST shifts keep the
   * wall-clock time consistent.
   */
  private weeklyOccurrences(
    slots: { unitId: string; start: string; end: string }[],
    count: number,
  ): { unitId: string; start: string; end: string }[][] {
    const occurrences: { unitId: string; start: string; end: string }[][] = [];
    for (let week = 0; week < count; week++) {
      occurrences.push(
        slots.map((s) => ({
          unitId: s.unitId,
          start: DateTime.fromISO(s.start).plus({ weeks: week }).toISO()!,
          end: DateTime.fromISO(s.end).plus({ weeks: week }).toISO()!,
        })),
      );
    }
    return occurrences;
  }

  /**
   * Pre-check whether any of an occurrence's slots is already taken/blocked
   * (a Slot row exists for that unit+start). Used by the recurring path to SKIP
   * a clashing occurrence instead of letting the slot insert throw a unique
   * violation — which in Postgres would abort the whole series transaction.
   * Returns a human-readable reason for the first clash, or null if all free.
   */
  private async findSlotConflict(
    tx: Prisma.TransactionClient,
    slots: { unitId: string; start: string; end: string }[],
  ): Promise<string | null> {
    const existing = await tx.slot.findFirst({
      where: {
        OR: slots.map((s) => ({
          unitId: s.unitId,
          startsAt: DateTime.fromISO(s.start).toJSDate(),
        })),
      },
    });
    if (!existing) return null;
    return existing.status === 'blocked'
      ? 'Slot is blocked for this time.'
      : 'Slot is already booked for this time.';
  }

  /**
   * Mark a booking paid/settled → earn loyalty and release any referral reward
   * (PRD §4.5). Idempotent: a second call after the booking is already paid is
   * a no-op. Used by prepay confirmation and pay-at-venue settlement.
   */
  async markPaid(
    bookingId: string,
    user?: RequestUser,
    razorpayPaymentId?: string,
  ): Promise<{ paid: true }> {
    const booking = await this.prisma.withTenantBypass((tx) =>
      tx.booking.findUnique({ where: { id: bookingId } }),
    );
    if (!booking) throw new NotFoundException('Booking not found');

    // Owner/staff settlement must stay within the caller's own tenant. The
    // public prepay confirmation path calls this without a user (verified by
    // payment signature), so the check only applies when a user is present.
    if (user && user.ownerId !== booking.ownerId) {
      throw new ForbiddenException('Booking belongs to another tenant');
    }
    // Staff settling on the ground are limited to their assigned venues.
    if (
      user &&
      user.role === UserRole.STAFF &&
      !(user.assignedVenueIds ?? []).includes(booking.venueId)
    ) {
      throw new ForbiddenException('Booking is outside your assigned venues');
    }

    return this.prisma.withTenantId(booking.ownerId, async (tx) => {
      const fresh = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!fresh) throw new NotFoundException('Booking not found');
      if (fresh.status === BookingStatus.CANCELLED) {
        throw new BadRequestException(
          'Cannot record payment for a cancelled booking.',
        );
      }
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
          // Persist the captured gateway payment id so a later cancellation can
          // issue a refund against it. Only set on the prepay handshake.
          ...(razorpayPaymentId ? { razorpayPaymentId } : {}),
        },
      });

      await this.loyalty.earn(
        tx,
        fresh.ownerId,
        fresh.customerId,
        fresh.total,
        bookingId,
        fresh.venueId,
      );
      await this.referral.releaseOnFirstPaid(tx, fresh.ownerId, fresh.customerId);
      return { paid: true as const };
    });
  }

  /**
   * Confirm a Razorpay prepay handshake and settle the booking (PRD §7).
   * Safe & idempotent:
   *  - the supplied razorpayOrderId must match the order stored on the booking,
   *  - the signature is verified via PaymentService,
   *  - if the booking is already paid, this returns without re-crediting.
   * Used by the client confirmation route and the server-side webhook.
   *
   * SEC-12: when a `user` is supplied (the authenticated confirm-payment route)
   * the caller must own the booking — the owning customer, or the booking's
   * tenant owner/staff (staff limited to their assigned venues). This is the
   * key win even under the dev mock-signature path: a valid token for an
   * unrelated account can no longer settle someone else's PREPAY booking.
   * Internal callers (e.g. a server-side webhook) omit `user`.
   */
  async confirmPayment(
    bookingId: string,
    payment: {
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
    },
    user?: RequestUser,
  ): Promise<{ paid: true }> {
    const booking = await this.prisma.withTenantBypass((tx) =>
      tx.booking.findUnique({ where: { id: bookingId } }),
    );
    if (!booking) throw new NotFoundException('Booking not found');

    // SEC-12: enforce ownership. Customers are global (no ownerId) and may only
    // confirm their own booking; owners/staff carry ownerId in the JWT and may
    // confirm bookings in their own tenant (staff within assigned venues).
    if (user) {
      const isOwningCustomer =
        user.role === UserRole.CUSTOMER && booking.customerId === user.id;
      const isTenantOwner =
        (user.role === UserRole.OWNER || user.role === UserRole.STAFF) &&
        user.ownerId === booking.ownerId &&
        (user.role !== UserRole.STAFF ||
          (user.assignedVenueIds ?? []).includes(booking.venueId));
      if (!isOwningCustomer && !isTenantOwner) {
        throw new ForbiddenException('You cannot confirm payment for this booking');
      }
    }

    // The order presented must be the one we created for this booking. This
    // stops a valid signature for some other order from settling this booking.
    if (
      !booking.razorpayOrderId ||
      booking.razorpayOrderId !== payment.razorpayOrderId
    ) {
      throw new BadRequestException('Payment order does not match this booking');
    }

    // Already settled → no-op (idempotent; never re-credit loyalty/referral).
    if (
      booking.paymentStatus === PaymentStatus.PAID ||
      booking.paymentStatus === PaymentStatus.SETTLED_AT_VENUE
    ) {
      return { paid: true as const };
    }

    const ok = this.payments.verifyPaymentSignature(
      payment.razorpayOrderId,
      payment.razorpayPaymentId,
      payment.razorpaySignature,
    );
    if (!ok) throw new BadRequestException('Invalid payment signature');

    return this.markPaid(bookingId, undefined, payment.razorpayPaymentId);
  }

  /**
   * Cancel a booking per the owner's cancellation policy (PRD §4.4, §5.4):
   *  - Frees the occupying slots.
   *  - Pack-funded bookings always return the session credit (not cash).
   *  - Redeemed points are returned to redeemable credit.
   *  - PREPAY/PAID bookings get a GATEWAY REFUND of (amount paid − fee), where
   *    the fee is derived from the venue's cancellation template: free inside
   *    the free window, a percentage penalty otherwise. The refund is recorded
   *    on the append-only cash ledger and paymentStatus → REFUNDED.
   *  - If the venue has no recognised template, falls back to a full refund
   *    with no fee (legacy behaviour).
   * Idempotent: an already-cancelled booking is a no-op (never double-refunds).
   *
   * Authorization: when a `user` is supplied (the public/customer-facing route)
   * the caller must be the owning customer or the booking's tenant owner/staff
   * (staff limited to their assigned venues), and a customer may only cancel a
   * still-cancellable booking (CONFIRMED with its first slot in the future).
   * Internal callers (owner status update, already authorized) omit `user`.
   */
  async cancel(
    bookingId: string,
    user?: RequestUser,
  ): Promise<{ cancelled: true }> {
    const booking = await this.prisma.withTenantBypass((tx) =>
      tx.booking.findUnique({ where: { id: bookingId }, include: { slots: true } }),
    );
    if (!booking) throw new NotFoundException('Booking not found');

    if (user) {
      const isOwningCustomer =
        user.role === UserRole.CUSTOMER && booking.customerId === user.id;
      const isTenantOwner =
        (user.role === UserRole.OWNER || user.role === UserRole.STAFF) &&
        user.ownerId === booking.ownerId &&
        (user.role !== UserRole.STAFF ||
          (user.assignedVenueIds ?? []).includes(booking.venueId));
      if (!isOwningCustomer && !isTenantOwner) {
        throw new ForbiddenException('You cannot cancel this booking');
      }
      // Customers may only cancel a still-cancellable booking; owners/staff can
      // cancel (and trigger refunds) regardless of timing.
      if (isOwningCustomer) {
        const firstSlotStart = booking.slots
          .map((s) => s.startsAt.getTime())
          .sort((a, b) => a - b)[0];
        const cancellable =
          booking.status === BookingStatus.CONFIRMED &&
          firstSlotStart != null &&
          firstSlotStart > Date.now();
        if (!cancellable) {
          throw new BadRequestException('This booking can no longer be cancelled.');
        }
      }
    }

    // Resolve the gateway refund (network call) BEFORE the tx so the
    // transaction stays short. We re-check status inside the tx for idempotency.
    let refund: { amount: Prisma.Decimal; gatewayId: string; fee: Prisma.Decimal } | null =
      null;
    const isPaid =
      booking.status !== BookingStatus.CANCELLED &&
      booking.payMode === PayMode.PREPAY &&
      booking.paymentStatus === PaymentStatus.PAID &&
      booking.razorpayPaymentId != null &&
      booking.total.greaterThan(0);
    if (isPaid) {
      const fee = await this.cancellationFee(booking);
      const refundable = Prisma.Decimal.max(
        booking.total.sub(fee),
        new Prisma.Decimal(0),
      );
      if (refundable.greaterThan(0)) {
        const res = await this.payments.refund(
          booking.razorpayPaymentId as string,
          Number(refundable),
        );
        refund = { amount: refundable, gatewayId: res.id, fee };
      } else {
        refund = { amount: new Prisma.Decimal(0), gatewayId: '', fee };
      }
    }

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
        data: {
          status: BookingStatus.CANCELLED,
          ...(refund && refund.amount.greaterThan(0)
            ? { paymentStatus: PaymentStatus.REFUNDED }
            : {}),
        },
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

      // BUG-8: points EARNED when the booking was paid/settled must be clawed
      // back on cancellation, otherwise a customer can farm points by booking,
      // paying and cancelling for a refund. markPaid() posts a single
      // POINTS_EARN row tagged with this booking; we reverse exactly that amount
      // (a negative POINTS_EARN on the points lane, mirroring loyalty.earn) so
      // the net earned points for a refunded booking is zero. We read the actual
      // posted amount rather than recomputing the rate so the reversal stays
      // correct even if the earn rate changed after the booking was paid.
      const wasPaid =
        fresh.paymentStatus === PaymentStatus.PAID ||
        fresh.paymentStatus === PaymentStatus.SETTLED_AT_VENUE;
      if (wasPaid) {
        const earned = await tx.ledgerTxn.findFirst({
          where: {
            customerId: fresh.customerId,
            lane: pointsLane(fresh.ownerId),
            type: LedgerTxnType.POINTS_EARN,
            refType: 'booking',
            refId: bookingId,
            amount: { gt: 0 },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (earned && earned.amount.greaterThan(0)) {
          // Clamp the claw-back to the current points balance: if the customer
          // already spent some of these points, the ledger's overdraft guard
          // would reject a full reversal and abort the cancellation. We reverse
          // as much as is available so the cancellation always succeeds while
          // still removing every earned point we can.
          const balance = await this.loyalty.pointsBalance(
            tx,
            fresh.ownerId,
            fresh.customerId,
          );
          const reversal = Prisma.Decimal.min(earned.amount, balance);
          if (reversal.greaterThan(0)) {
            await this.ledger.post(tx, {
              ownerId: fresh.ownerId,
              customerId: fresh.customerId,
              type: LedgerTxnType.POINTS_EARN,
              amount: reversal.negated(),
              lane: pointsLane(fresh.ownerId),
              refType: 'booking',
              refId: bookingId,
              note: `Reversed ${reversal} pts earned on cancelled booking`,
            });
          }
        }
      }

      // Record the gateway refund on the append-only cash ledger.
      if (refund && refund.amount.greaterThan(0)) {
        await this.ledger.post(tx, {
          ownerId: fresh.ownerId,
          customerId: fresh.customerId,
          type: LedgerTxnType.CASH_REFUND,
          amount: refund.amount,
          lane: CASH_LANE,
          refType: 'booking',
          refId: bookingId,
          note: refund.fee.greaterThan(0)
            ? `Gateway refund ${refund.gatewayId} (₹${refund.amount} after ₹${refund.fee} cancellation fee)`
            : `Gateway refund ${refund.gatewayId}`,
        });
      }
      return { cancelled: true as const };
    });
  }

  /**
   * Cancellation fee for a paid booking, derived from the venue's cancellation
   * template (VenueSettings.cancellationTemplate). Free inside the template's
   * free window before the first slot; otherwise a percentage of the amount
   * paid. No recognised template (or no settings) → no fee (full refund).
   */
  private async cancellationFee(booking: {
    venueId: string;
    total: Prisma.Decimal;
    slots: { startsAt: Date }[];
  }): Promise<Prisma.Decimal> {
    const zero = new Prisma.Decimal(0);
    const settings = await this.prisma.withTenantBypass((tx) =>
      tx.venueSettings.findUnique({ where: { venueId: booking.venueId } }),
    );
    const template = settings
      ? CANCELLATION_TEMPLATES[settings.cancellationTemplate]
      : undefined;
    if (!template) return zero;

    const firstSlotStart = booking.slots
      .map((s) => s.startsAt.getTime())
      .sort((a, b) => a - b)[0];
    // No slots (shouldn't happen) → treat as outside the free window.
    const hoursUntilStart =
      firstSlotStart != null
        ? (firstSlotStart - Date.now()) / 3_600_000
        : -Infinity;
    if (hoursUntilStart >= template.freeWindowHours) return zero;

    // BUG-11: round the cancellation fee to 2dp HALF_UP so the refund
    // (total − fee) is an exact currency amount sent to the gateway.
    return booking.total
      .mul(template.penaltyPct)
      .div(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  /**
   * Owner/staff bookings directory (PRD §4.3). Tenant-scoped via RLS; staff are
   * further limited to their assigned venues. Date/court filters match the
   * occupying slots; customer name/mobile search is applied after enrichment.
   */
  async listForOwner(
    user: RequestUser,
    filters: ListBookingsQueryDto,
  ): Promise<OwnerBooking[]> {
    if (!user.ownerId) throw new BadRequestException('No tenant context');
    const ownerId = user.ownerId;

    return this.prisma.withTenantId(ownerId, async (tx) => {
      const where: Prisma.BookingWhereInput = {};
      if (filters.status) where.status = filters.status;
      if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;

      // Staff can only see bookings for the venues assigned to them.
      const staffVenues =
        user.role === UserRole.STAFF ? user.assignedVenueIds ?? [] : null;
      if (filters.venueId) {
        if (staffVenues && !staffVenues.includes(filters.venueId)) return [];
        where.venueId = filters.venueId;
      } else if (staffVenues) {
        if (staffVenues.length === 0) return [];
        where.venueId = { in: staffVenues };
      }

      // Date-range and court filters apply to the occupying slot rows.
      const slotWhere: Prisma.SlotWhereInput = {};
      if (filters.unitId) slotWhere.unitId = filters.unitId;
      if (filters.from || filters.to) {
        const startsAt: Prisma.DateTimeFilter = {};
        if (filters.from)
          startsAt.gte = DateTime.fromISO(filters.from).startOf('day').toJSDate();
        if (filters.to)
          startsAt.lte = DateTime.fromISO(filters.to).endOf('day').toJSDate();
        slotWhere.startsAt = startsAt;
      }
      if (Object.keys(slotWhere).length > 0) where.slots = { some: slotWhere };

      const bookings = await tx.booking.findMany({
        where,
        include: { slots: true, customer: true },
        orderBy: { createdAt: 'desc' },
      });

      // Enrich with venue + court names and the per-owner customer profile.
      const venueIds = [...new Set(bookings.map((b) => b.venueId))];
      const unitIds = [
        ...new Set(bookings.flatMap((b) => b.slots.map((s) => s.unitId))),
      ];
      const customerIds = [...new Set(bookings.map((b) => b.customerId))];
      const [venues, units, profiles] = await Promise.all([
        tx.venue.findMany({ where: { id: { in: venueIds } } }),
        tx.bookableUnit.findMany({ where: { id: { in: unitIds } } }),
        tx.playerProfile.findMany({
          where: { customerId: { in: customerIds } },
        }),
      ]);
      const venueName = new Map(venues.map((v) => [v.id, v.name]));
      const unitName = new Map(units.map((u) => [u.id, u.name]));
      const profileByCustomer = new Map(profiles.map((p) => [p.customerId, p]));

      const items: OwnerBooking[] = bookings.map((b) => {
        const profile = profileByCustomer.get(b.customerId);
        return {
          id: b.id,
          status: b.status as BookingStatus,
          payMode: b.payMode as PayMode,
          paymentStatus: b.paymentStatus as PaymentStatus,
          total: Number(b.total),
          venueId: b.venueId,
          venueName: venueName.get(b.venueId) ?? '—',
          customerId: b.customerId,
          customerName: profile?.name ?? b.customer?.name ?? null,
          customerMobile: profile?.mobile ?? b.customer?.mobile ?? null,
          slots: b.slots
            .slice()
            .sort((a, c) => a.startsAt.getTime() - c.startsAt.getTime())
            .map((s) => ({
              unitId: s.unitId,
              unitName: unitName.get(s.unitId) ?? '—',
              start: s.startsAt.toISOString(),
              end: s.endsAt.toISOString(),
            })),
          createdAt: b.createdAt.toISOString(),
        };
      });

      const q = filters.q?.trim().toLowerCase();
      if (!q) return items;
      return items.filter(
        (i) =>
          (i.customerName?.toLowerCase().includes(q) ?? false) ||
          (i.customerMobile?.toLowerCase().includes(q) ?? false),
      );
    });
  }

  /**
   * Customer's own booking history (PRD BOOK-12): the caller's bookings,
   * upcoming + past, newest first, enriched with venue/court names, slot
   * time(s), amount and status. Scoped strictly by customerId = user.id, so a
   * customer can only ever see their own bookings regardless of tenant.
   */
  async listForCustomer(user: RequestUser): Promise<CustomerBooking[]> {
    const bookings = await this.prisma.withTenantBypass((tx) =>
      tx.booking.findMany({
        where: { customerId: user.id },
        include: { slots: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
    if (bookings.length === 0) return [];

    const venueIds = [...new Set(bookings.map((b) => b.venueId))];
    const unitIds = [
      ...new Set(bookings.flatMap((b) => b.slots.map((s) => s.unitId))),
    ];
    const [venues, units] = await this.prisma.withTenantBypass((tx) =>
      Promise.all([
        tx.venue.findMany({ where: { id: { in: venueIds } } }),
        tx.bookableUnit.findMany({ where: { id: { in: unitIds } } }),
      ]),
    );
    const venueName = new Map(venues.map((v) => [v.id, v.name]));
    const unitName = new Map(units.map((u) => [u.id, u.name]));

    return bookings.map((b) => this.toCustomerBooking(b, venueName, unitName));
  }

  /**
   * Fetch a single booking that the caller is entitled to see: the owner/staff
   * of the booking's tenant (staff limited to their assigned venues) or the
   * owning customer. Enriched the same way as the relevant list view.
   */
  async getOne(bookingId: string, user: RequestUser): Promise<CustomerBooking> {
    const booking = await this.prisma.withTenantBypass((tx) =>
      tx.booking.findUnique({
        where: { id: bookingId },
        include: { slots: true },
      }),
    );
    if (!booking) throw new NotFoundException('Booking not found');

    const isOwningCustomer =
      user.role === UserRole.CUSTOMER && booking.customerId === user.id;
    const isTenantOwner =
      (user.role === UserRole.OWNER || user.role === UserRole.STAFF) &&
      user.ownerId === booking.ownerId &&
      (user.role !== UserRole.STAFF ||
        (user.assignedVenueIds ?? []).includes(booking.venueId));
    if (!isOwningCustomer && !isTenantOwner) {
      throw new ForbiddenException('You cannot view this booking');
    }

    const [venues, units] = await this.prisma.withTenantBypass((tx) =>
      Promise.all([
        tx.venue.findMany({ where: { id: booking.venueId } }),
        tx.bookableUnit.findMany({
          where: { id: { in: booking.slots.map((s) => s.unitId) } },
        }),
      ]),
    );
    const venueName = new Map(venues.map((v) => [v.id, v.name]));
    const unitName = new Map(units.map((u) => [u.id, u.name]));
    return this.toCustomerBooking(booking, venueName, unitName);
  }

  private toCustomerBooking(
    b: {
      id: string;
      status: string;
      payMode: string;
      paymentStatus: string;
      total: Prisma.Decimal;
      venueId: string;
      createdAt: Date;
      slots: { unitId: string; startsAt: Date; endsAt: Date }[];
    },
    venueName: Map<string, string>,
    unitName: Map<string, string>,
  ): CustomerBooking {
    return {
      id: b.id,
      status: b.status as BookingStatus,
      payMode: b.payMode as PayMode,
      paymentStatus: b.paymentStatus as PaymentStatus,
      total: Number(b.total),
      venueId: b.venueId,
      venueName: venueName.get(b.venueId) ?? '—',
      slots: b.slots
        .slice()
        .sort((a, c) => a.startsAt.getTime() - c.startsAt.getTime())
        .map((s) => ({
          unitId: s.unitId,
          unitName: unitName.get(s.unitId) ?? '—',
          start: s.startsAt.toISOString(),
          end: s.endsAt.toISOString(),
        })),
      createdAt: b.createdAt.toISOString(),
    };
  }

  /**
   * Load a booking and assert the caller owns it (and, for staff, that it is in
   * one of their assigned venues). Returns the row (with slots) for follow-up
   * mutations.
   */
  private async loadOwnedBooking(bookingId: string, user: RequestUser) {
    const booking = await this.prisma.withTenantBypass((tx) =>
      tx.booking.findUnique({
        where: { id: bookingId },
        include: { slots: true },
      }),
    );
    if (!booking) throw new NotFoundException('Booking not found');
    if (!user.ownerId || user.ownerId !== booking.ownerId) {
      throw new ForbiddenException('Booking belongs to another tenant');
    }
    if (
      user.role === UserRole.STAFF &&
      !(user.assignedVenueIds ?? []).includes(booking.venueId)
    ) {
      throw new ForbiddenException('Booking is outside your assigned venues');
    }
    return booking;
  }

  /** Owner/staff: mark a booking completed / no-show / cancelled. */
  async updateStatus(
    bookingId: string,
    user: RequestUser,
    status: BookingStatus,
  ): Promise<{ status: BookingStatus }> {
    const booking = await this.loadOwnedBooking(bookingId, user);

    if (status === BookingStatus.CANCELLED) {
      await this.cancel(bookingId);
      return { status: BookingStatus.CANCELLED };
    }

    if (booking.status === BookingStatus.CANCELLED) {
      throw new BadRequestException(
        'This booking is cancelled — reinstating it is not supported.',
      );
    }

    if (status === BookingStatus.NO_SHOW) {
      await this.markNoShow(booking);
      return { status };
    }

    await this.prisma.withTenantId(booking.ownerId, (tx) =>
      tx.booking.update({ where: { id: bookingId }, data: { status } }),
    );
    return { status };
  }

  /**
   * Mark a booking as no-show and apply the venue's flat no-show fee as a
   * ledger DUE against the customer (PRD: tracked as ledger dues, no
   * card-on-file). Idempotent via Booking.noShowFeeApplied so re-marking never
   * double-charges; a zero fee just flips the status.
   */
  private async markNoShow(booking: {
    id: string;
    ownerId: string;
    venueId: string;
    customerId: string;
    status: string;
    noShowFeeApplied: boolean;
  }): Promise<void> {
    const settings = await this.prisma.withTenantBypass((tx) =>
      tx.venueSettings.findUnique({ where: { venueId: booking.venueId } }),
    );
    const fee = settings?.noShowFee ?? new Prisma.Decimal(0);

    await this.prisma.withTenantId(booking.ownerId, async (tx) => {
      const fresh = await tx.booking.findUnique({ where: { id: booking.id } });
      if (!fresh) throw new NotFoundException('Booking not found');

      const applyFee = fee.greaterThan(0) && !fresh.noShowFeeApplied;
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.NO_SHOW,
          ...(applyFee ? { noShowFeeApplied: true } : {}),
        },
      });

      if (applyFee) {
        await this.ledger.post(tx, {
          ownerId: fresh.ownerId,
          customerId: fresh.customerId,
          type: LedgerTxnType.NO_SHOW_FEE,
          amount: fee, // positive = amount owed on the dues lane
          lane: DUES_LANE,
          refType: 'booking',
          refId: booking.id,
          note: `No-show fee ₹${fee}`,
        });
      }
    });
  }

  /**
   * Owner/staff: move a booking to new slot(s). Frees the old slot rows and
   * locks the new ones in a single transaction, re-pricing the moved slots and
   * adjusting the booking total by the price delta (existing discounts/points
   * are preserved). A clashing slot surfaces as a 409.
   */
  async reschedule(
    bookingId: string,
    user: RequestUser,
    newSlots: CartSlotDto[],
  ): Promise<{ rescheduled: true }> {
    const booking = await this.loadOwnedBooking(bookingId, user);
    if (booking.status === BookingStatus.CANCELLED) {
      throw new BadRequestException('Cannot reschedule a cancelled booking.');
    }
    if (newSlots.length === 0) {
      throw new BadRequestException('Pick at least one new slot.');
    }

    return this.prisma.withTenantId(booking.ownerId, async (tx) => {
      // The new courts must belong to the booking's own venue. This keeps the
      // booking's venueId consistent and (since staff are already scoped to the
      // booking's venue) holds staff within their assigned venues.
      const newUnitIds = [...new Set(newSlots.map((s) => s.unitId))];
      const units = await tx.bookableUnit.findMany({
        where: { id: { in: newUnitIds } },
      });
      const unitVenue = new Map(units.map((u) => [u.id, u.venueId]));
      for (const id of newUnitIds) {
        const venueId = unitVenue.get(id);
        if (!venueId) throw new BadRequestException('Unknown court selected.');
        if (venueId !== booking.venueId) {
          throw new BadRequestException(
            'A booking can only be moved to a court in the same venue.',
          );
        }
      }

      // Re-price the current slots (at today's rates) to anchor the delta.
      let oldSlotSubtotal = new Prisma.Decimal(0);
      for (const s of booking.slots) {
        const durationMin = Math.round(
          (s.endsAt.getTime() - s.startsAt.getTime()) / 60000,
        );
        const resolved = await this.pricing.resolve(
          s.unitId,
          s.startsAt,
          durationMin,
          tx,
        );
        oldSlotSubtotal = oldSlotSubtotal.add(resolved.price);
      }

      // Price + validate the requested slots.
      let newSlotSubtotal = new Prisma.Decimal(0);
      const rows: { unitId: string; startsAt: Date; endsAt: Date }[] = [];
      for (const s of newSlots) {
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
        newSlotSubtotal = newSlotSubtotal.add(resolved.price);
        rows.push({ unitId: s.unitId, startsAt: start, endsAt: end });
      }

      // Swap the slot rows — free the old, lock the new.
      await tx.slot.deleteMany({ where: { bookingId } });
      try {
        for (const r of rows) {
          await tx.slot.create({
            data: {
              unitId: r.unitId,
              ownerId: booking.ownerId,
              startsAt: r.startsAt,
              endsAt: r.endsAt,
              status: 'booked',
              bookingId,
            },
          });
        }
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === UNIQUE_VIOLATION
        ) {
          throw new ConflictException(
            'One or more of the new slots are already booked. Please pick another.',
          );
        }
        throw err;
      }

      const delta = newSlotSubtotal.sub(oldSlotSubtotal);
      const zero = new Prisma.Decimal(0);
      const newTotal = Prisma.Decimal.max(booking.total.add(delta), zero);
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          subtotal: Prisma.Decimal.max(booking.subtotal.add(delta), zero),
          total: newTotal,
        },
      });

      // BUG-6: reconcile the money for a PAID prepay booking. Previously the
      // total moved with the price delta but the gateway/ledger were never
      // touched, so cash silently drifted (a cheaper reschedule kept the
      // customer's extra payment; a pricier one was never collected).
      //
      // Approach (documented):
      //  - We reconcile against the ACTUAL change in the booking total
      //    (newTotal − oldTotal), so the zero-floor clamp can't refund more than
      //    was paid.
      //  - Cheaper move (actualDelta < 0): refund the difference to the customer
      //    via the gateway and record it on the append-only CASH lane, exactly
      //    like cancel(). paymentStatus stays PAID (the booking is still paid in
      //    full at its new, lower price).
      //  - Pricier move (actualDelta > 0): we cannot reliably auto-charge the
      //    stored card here, so we record the shortfall as a DUE on the dues
      //    lane (collected on the ground / next settlement). This keeps the
      //    ledger balanced — no silent discrepancy.
      // NOTE for the schema batch: a dedicated RESCHEDULE_ADJUSTMENT ledger
      // type would read better than reusing CASH_REFUND/NO_SHOW_FEE here; left
      // as-is to avoid an enum/migration change in this batch.
      const isPaidPrepay =
        booking.payMode === PayMode.PREPAY &&
        booking.paymentStatus === PaymentStatus.PAID;
      if (isPaidPrepay) {
        const actualDelta = newTotal.sub(booking.total);
        if (actualDelta.lessThan(0)) {
          // Price drop on a paid booking → return the difference. When we have a
          // captured gateway payment id we refund to the card; otherwise (a
          // prepay booking settled without a gateway id, e.g. owner markPaid)
          // we still must reconcile — record it on the cash lane so the money is
          // never silently lost (BUG-6: no silent discrepancy in either path).
          const refundable = actualDelta.negated();
          let note: string;
          if (booking.razorpayPaymentId) {
            const res = await this.payments.refund(
              booking.razorpayPaymentId,
              Number(refundable),
            );
            note = `Reschedule refund ${res.id} (₹${refundable} price drop)`;
          } else {
            note = `Reschedule credit ₹${refundable} (price drop, no gateway payment on file)`;
          }
          await this.ledger.post(tx, {
            ownerId: booking.ownerId,
            customerId: booking.customerId,
            type: LedgerTxnType.CASH_REFUND,
            amount: refundable,
            lane: CASH_LANE,
            refType: 'booking',
            refId: bookingId,
            note,
          });
        } else if (actualDelta.greaterThan(0)) {
          await this.ledger.post(tx, {
            ownerId: booking.ownerId,
            customerId: booking.customerId,
            type: LedgerTxnType.NO_SHOW_FEE,
            amount: actualDelta, // positive = amount owed on the dues lane
            lane: DUES_LANE,
            refType: 'booking',
            refId: bookingId,
            note: `Reschedule top-up due ₹${actualDelta} (price increase)`,
          });
        }
      }
      return { rescheduled: true as const };
    });
  }

  /**
   * Owner/staff: edit the customer name/mobile shown on a booking. Writes the
   * per-owner player profile only — never another tenant's data or the shared
   * user record.
   */
  async updateCustomer(
    bookingId: string,
    user: RequestUser,
    data: { name: string; mobile: string },
  ): Promise<{ name: string; mobile: string }> {
    const booking = await this.loadOwnedBooking(bookingId, user);
    const name = data.name.trim();
    const mobile = data.mobile.trim();
    if (!name || !mobile) {
      throw new BadRequestException('Name and mobile are required.');
    }

    return this.prisma.withTenantId(booking.ownerId, async (tx) => {
      await tx.playerProfile.upsert({
        where: {
          ownerId_customerId: {
            ownerId: booking.ownerId,
            customerId: booking.customerId,
          },
        },
        create: {
          ownerId: booking.ownerId,
          customerId: booking.customerId,
          name,
          mobile,
        },
        update: { name, mobile },
      });
      return { name, mobile };
    });
  }

  /** Distinct game ids for the given bookable units (for offer game scoping). */
  private async gameIdsForUnits(
    tx: Prisma.TransactionClient,
    unitIds: string[],
  ): Promise<string[]> {
    if (unitIds.length === 0) return [];
    const units = await tx.bookableUnit.findMany({
      where: { id: { in: unitIds } },
      select: { gameId: true },
    });
    return [...new Set(units.map((u) => u.gameId))];
  }

  /**
   * The marketing segments a customer falls into for this owner. Mirrors the
   * CRM segmentation (PRD §4.9): "lapsed" (no visit in 60 days) and "regulars"
   * (5+ bookings). Returns an empty list if there's no CRM link yet.
   */
  private async segmentsForCustomer(
    tx: Prisma.TransactionClient,
    ownerId: string,
    customerId: string,
  ): Promise<string[]> {
    const link = await tx.ownerCustomer.findUnique({
      where: { ownerId_customerId: { ownerId, customerId } },
    });
    if (!link) return [];
    const segments: string[] = [];
    const cutoff = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    if (link.lastVisitAt < cutoff) segments.push('lapsed');
    if (link.bookingCount >= 5) segments.push('regulars');
    return segments;
  }

  /** True if an offer's scope matches the current booking context. */
  private offerInScope(
    offer: {
      venueIds: string[];
      gameIds: string[];
      segment: string | null;
    },
    ctx: { venueId: string; bookedGameIds: string[]; customerSegments: string[] },
  ): boolean {
    if (offer.venueIds.length > 0 && !offer.venueIds.includes(ctx.venueId)) {
      return false;
    }
    if (
      offer.gameIds.length > 0 &&
      !ctx.bookedGameIds.some((g) => offer.gameIds.includes(g))
    ) {
      return false;
    }
    if (offer.segment && !ctx.customerSegments.includes(offer.segment)) {
      return false;
    }
    return true;
  }

  /**
   * Resolve the offer to apply at checkout. With an explicit `offerCode` we
   * match by code; otherwise we pick the best valid auto-apply offer. In both
   * paths the validity window (DB) plus venue/game/segment scope (in code) are
   * honoured. Returns the chosen offer id and the computed discount (capped to
   * the discountable base), or null if nothing applies.
   */
  private async resolveOffer(
    tx: Prisma.TransactionClient,
    args: {
      ownerId: string;
      venueId: string;
      offerCode?: string;
      base: Prisma.Decimal;
      bookedGameIds: string[];
      customerSegments: string[];
    },
  ): Promise<{ offerId: string; discount: Prisma.Decimal } | null> {
    const now = new Date();
    const validWindow: Prisma.OfferWhereInput = {
      active: true,
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validTo: null }, { validTo: { gte: now } }] },
      ],
    };

    const scopeCtx = {
      venueId: args.venueId,
      bookedGameIds: args.bookedGameIds,
      customerSegments: args.customerSegments,
    };
    const discountFor = (offer: {
      type: string;
      value: Prisma.Decimal;
    }): Prisma.Decimal =>
      offer.type === 'percent'
        ? // BUG-11: round the percent discount to 2dp HALF_UP so the discount is
          // a clean currency amount and the derived total stays consistent.
          args.base
            .mul(offer.value)
            .div(100)
            .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
        : Prisma.Decimal.min(offer.value, args.base);

    // Owner-scope every offer lookup (defense-in-depth): the dev DB connects as
    // a superuser that BYPASSES RLS, so without an explicit ownerId filter a
    // customer could redeem another owner's promo code or auto-apply another
    // owner's offer. Offers carry a denormalised ownerId.
    if (args.offerCode) {
      const offer = await tx.offer.findFirst({
        where: { code: args.offerCode, ownerId: args.ownerId, ...validWindow },
      });
      if (!offer || !this.offerInScope(offer, scopeCtx)) return null;
      return { offerId: offer.id, discount: discountFor(offer) };
    }

    // Auto-apply: pick whichever valid, in-scope auto-apply offer gives the
    // largest discount for this booking.
    const candidates = await tx.offer.findMany({
      where: { autoApply: true, ownerId: args.ownerId, ...validWindow },
    });
    let best: { offerId: string; discount: Prisma.Decimal } | null = null;
    for (const offer of candidates) {
      if (!this.offerInScope(offer, scopeCtx)) continue;
      const discount = discountFor(offer);
      if (!discount.greaterThan(0)) continue;
      if (!best || discount.greaterThan(best.discount)) {
        best = { offerId: offer.id, discount };
      }
    }
    return best;
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

  /**
   * PRD-9: best-effort booking confirmation to the customer's own mobile via
   * WhatsApp + SMS, in addition to the venue notification. Never throws — any
   * lookup or delivery failure is swallowed and logged so a notification
   * problem can never block or fail the booking. Resolves the mobile from the
   * shared user record (the canonical contact number for the customer).
   */
  private async notifyCustomerBookingConfirmed(
    customerId: string,
    venueName: string,
    slotCount: number,
  ): Promise<void> {
    try {
      const customer = await this.prisma.withTenantBypass((tx) =>
        tx.user.findUnique({
          where: { id: customerId },
          select: { mobile: true },
        }),
      );
      const mobile = customer?.mobile?.trim();
      if (!mobile) return; // no number on file → nothing to send (no spam)

      const message =
        `Your booking at ${venueName} is confirmed for ${slotCount} slot(s). ` +
        `See you on the court!`;
      // Both channels are independently best-effort (NotificationService itself
      // never throws on gateway failure; we still guard the whole block).
      await this.notifications.sendWhatsApp(mobile, message);
      await this.notifications.sendSms(mobile, message);
    } catch (err) {
      this.logger.warn(
        `Customer booking confirmation failed for ${customerId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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
