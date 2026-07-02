import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  sum,
} from 'drizzle-orm';
import {
  BookingQuoteResponse,
  BookingResponse,
  BookingStatus,
  LedgerTxnType,
  OwnerBooking,
  PayMode,
  PaymentStatus,
  UserRole,
} from '@sportsbooking/shared';
import { DateTime } from 'luxon';
import { VENUE_TZ } from '../../common/time';
import { DbService } from '../../db/db.service';
import type { DbTx } from '../../db';
import { customerSegments } from '../../db/segments';
import { Decimal, dec, money, splitDeposit } from '../../db/money';
import {
  addons as addonsTable,
  bookableUnits,
  bookingAddons,
  bookings,
  ledgerTxns,
  offerRedemptions,
  offers,
  ownerCustomers,
  playerProfiles,
  slots,
  users,
  venues,
  venueSettings,
} from '../../db/schema';
import { LedgerService } from '../ledger/ledger.service';
import { LoyaltyService, pointsLane } from '../loyalty/loyalty.service';
import { MembershipsService } from '../memberships/memberships.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationFeedService } from '../notification-feed/notification-feed.module';
import { PaymentService } from '../payments/payment.service';
import { PaymentLedgerService } from '../payments/payment-ledger.service';
import { PricingService } from '../pricing/pricing.service';
import { ReferralService } from '../referral/referral.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import {
  CartSlotDto,
  CreateBookingDto,
  ListBookingsQueryDto,
  QuoteBookingDto,
  findIntraRequestOverlap,
  parseClockToMinutes,
  validateSlotOnGrid,
  type IntervalSlot,
} from './dto';

/** Postgres unique-violation SQLSTATE (23505) — a concurrent EXACT-start slot
 *  insert. And exclusion-violation (23P01) — a concurrent OVERLAPPING slot insert
 *  caught by the slots_unit_no_overlap GiST EXCLUDE constraint. Both mean another
 *  transaction just took the time; surface a 409 rather than a 500. */
const UNIQUE_VIOLATION = '23505';
const EXCLUSION_VIOLATION = '23P01';

/** Cash lane: a positive balance is money returned to the customer (refunds). */
const CASH_LANE = 'cash';
/** Dues lane: a positive balance is money the customer OWES (e.g. no-show fee). */
const DUES_LANE = 'dues';

/** True if a thrown error is a Postgres unique- or exclusion-violation — i.e. a
 *  concurrent transaction took an overlapping slot (the DB double-booking guard). */
function isSlotConflictViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) return false;
  const code = (err as { code?: unknown }).code;
  return code === UNIQUE_VIOLATION || code === EXCLUSION_VIOLATION;
}

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

/**
 * The full price breakdown for a cart — the SINGLE source of truth shared by
 * the booking-create path (createOccurrence) and the dry-run preview endpoint
 * (POST /bookings/quote). Computing it in one place guarantees the discount the
 * customer previews is exactly the discount they are charged. All money fields
 * are Decimal (callers convert to plain numbers only at the response boundary).
 */
interface PriceBreakdown {
  /** parsed slot rows ready for insertion (reused by the booking path). */
  slotRows: { unitId: string; startsAt: Date; endsAt: Date }[];
  /** validated, in-scope add-on rows with their requested quantity (reused for
   *  persistence, stock decrement and per-line revenue). */
  addons: { row: typeof addonsTable.$inferSelect; quantity: number }[];
  slotSubtotal: Decimal;
  addonSubtotal: Decimal;
  packDiscount: Decimal;
  packSessions: number;
  offerId?: string;
  offerDiscount: Decimal;
  /** customer's current points balance (for the redeem slider). */
  pointsBalance: number;
  /** rupee value of one point for this owner/venue. */
  redeemValue: number;
  /** most points the cart can absorb = min(balance, remaining cash / value). */
  maxRedeemablePoints: number;
  /** points actually applied = min(requested, maxRedeemablePoints). */
  pointsRedeemed: number;
  pointsValue: Decimal;
  total: Decimal;
  /** the venue's configured deposit percentage (0 when null/unset). */
  depositPct: Decimal;
  /** deposit preview — populated whenever depositPct>0 (decision #10). */
  depositAmount?: Decimal;
  balanceDueAtVenue?: Decimal;
}

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly db: DbService,
    private readonly pricing: PricingService,
    private readonly memberships: MembershipsService,
    private readonly loyalty: LoyaltyService,
    private readonly referral: ReferralService,
    private readonly payments: PaymentService,
    private readonly paymentLedger: PaymentLedgerService,
    private readonly notifications: NotificationService,
    private readonly ledger: LedgerService,
    private readonly feed: NotificationFeedService,
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
    const venue = await this.db.withTenantBypass((tx) =>
      tx.query.venues.findFirst({ where: eq(venues.id, dto.venueId) }),
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

    // Deposit guards (decision #9). A deposit plan only makes sense for a prepay
    // booking against a venue that has configured a deposit percentage, and (like
    // prepay) it is incompatible with recurrence. Reject up front with a clear
    // 400 rather than silently falling back to full prepay.
    if (dto.paymentPlan === 'deposit') {
      if (dto.recurrence) {
        throw new BadRequestException(
          'Deposit bookings are not supported for recurring series. Please book a single slot or pay the full amount.',
        );
      }
      const settings = await this.db.withTenantBypass((tx) =>
        tx.query.venueSettings.findFirst({
          where: eq(venueSettings.venueId, dto.venueId),
        }),
      );
      const depositPct = settings?.depositPct ? dec(settings.depositPct) : dec(0);
      if (!depositPct.greaterThan(0)) {
        throw new BadRequestException(
          'This venue does not offer deposit bookings. Please pay the full amount.',
        );
      }
    }

    return this.db.withTenantId(ownerId, async (tx) => {
      if (dto.idempotencyKey) {
        const existing = await tx.query.bookings.findFirst({
          where: eq(bookings.idempotencyKey, dto.idempotencyKey),
        });
        // BOOK-2: carry the Razorpay order id on the idempotent retry too. The
        // success path returns it (so the client can open checkout); without it
        // a retried PREPAY booking looks 'confirmed' but unpaid — Razorpay can
        // never be reopened and the slots stay held against an uncollected total.
        if (existing)
          return {
            ...this.toResponse(existing, []),
            razorpayOrderId: existing.razorpayOrderId ?? undefined,
          };
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
          // BOOK-1: persist the client idempotency key on the single-booking
          // path too, so a dropped-response retry hits the short-circuit above
          // (returns the existing booking) instead of 409-ing on slot conflict.
          idempotencyKey: dto.idempotencyKey,
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
   * Dry-run pricing for the consumer booking flow: the full discount breakdown
   * (pack / offer / points) for a cart WITHOUT creating anything. Lets the UI
   * preview the total, show the applied promo, and drive the redeem-points
   * slider with the real max-redeemable. Auth: a logged-in customer (packs,
   * points and offers are per-customer inputs). Mirrors create()'s venue
   * resolution but runs read-only with grid-only slot validation.
   */
  async quote(
    dto: QuoteBookingDto,
    user: RequestUser,
  ): Promise<BookingQuoteResponse> {
    const venue = await this.db.withTenantBypass((tx) =>
      tx.query.venues.findFirst({ where: eq(venues.id, dto.venueId) }),
    );
    if (!venue) throw new NotFoundException('Venue not found');
    const ownerId = venue.ownerId;

    return this.db.withTenantId(ownerId, async (tx) => {
      // Grid-only validation: price what was selected without 409-ing if a slot
      // was taken meanwhile (the booking call runs the full overlap check).
      await this.validateRequestedSlots(tx, dto.slots, { checkExisting: false });
      const q = await this.priceQuote(tx, {
        venue,
        ownerId,
        customerId: user.id,
        slotInputs: dto.slots,
        addons: dto.addons,
        addonIds: dto.addonIds,
        packId: dto.packId,
        offerCode: dto.offerCode,
        pointsToRedeem: dto.pointsToRedeem,
      });
      return {
        slotSubtotal: q.slotSubtotal.toNumber(),
        addonSubtotal: q.addonSubtotal.toNumber(),
        packDiscount: q.packDiscount.toNumber(),
        offerId: q.offerId,
        offerApplied: Boolean(q.offerId),
        offerDiscount: q.offerDiscount.toNumber(),
        pointsBalance: q.pointsBalance,
        redeemValue: q.redeemValue,
        maxRedeemablePoints: q.maxRedeemablePoints,
        pointsRedeemed: q.pointsRedeemed,
        pointsValue: q.pointsValue.toNumber(),
        total: q.total.toNumber(),
        // Deposit preview (decision #10): only present when the venue configures
        // a deposit. Serialized as a 2dp string like the other money columns.
        ...(q.depositAmount && q.balanceDueAtVenue
          ? {
              depositAmount: money(q.depositAmount),
              balanceDueAtVenue: money(q.balanceDueAtVenue),
            }
          : {}),
      };
    });
  }

  /**
   * Price a cart WITHOUT mutating anything — the read-only core shared by the
   * booking-create path and the /bookings/quote preview. Assumes the slots have
   * already been validated by the caller (createOccurrence does the full
   * grid+overlap check; quote does grid-only). Mirrors the original inline
   * steps 1–5 exactly so the preview and the charge can never diverge.
   */
  private async priceQuote(
    tx: DbTx,
    args: {
      venue: { id: string; ownerId: string };
      ownerId: string;
      customerId: string;
      slotInputs: { unitId: string; start: string; end: string }[];
      /** new quantity-aware add-on selection (preferred). */
      addons?: { addonId: string; quantity: number }[];
      /** legacy add-on ids (owner offline-booking flow) — each implies qty 1. */
      addonIds?: string[];
      packId?: string;
      offerCode?: string;
      pointsToRedeem?: number;
    },
  ): Promise<PriceBreakdown> {
    const { venue, ownerId, customerId, slotInputs } = args;

    // 1. Price each slot (resolved per-court dynamic price).
    let slotSubtotal = dec(0);
    const slotRows: { unitId: string; startsAt: Date; endsAt: Date }[] = [];
    const unitIds = new Set<string>();
    for (const s of slotInputs) {
      const start = DateTime.fromISO(s.start, { zone: VENUE_TZ }).toJSDate();
      const end = DateTime.fromISO(s.end, { zone: VENUE_TZ }).toJSDate();
      const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);
      const resolved = await this.pricing.resolve(s.unitId, start, durationMin, tx);
      slotSubtotal = slotSubtotal.add(resolved.price);
      slotRows.push({ unitId: s.unitId, startsAt: start, endsAt: end });
      unitIds.add(s.unitId);
    }

    // 2. Add-ons (quantity-aware). Normalise the two input shapes to one
    // {addonId, quantity} list: the new `addons` field (consumer flow, real
    // quantities) or the legacy `addonIds` (owner flow, one each). Scope the
    // lookup to this venue's owner + venue and active add-ons only
    // (defense-in-depth): the dev DB connects as a superuser that BYPASSES RLS,
    // so an unscoped findMany would let a customer reference another venue's
    // add-ons. Reject if any requested id is missing/out-of-scope. Stock is NOT
    // enforced here — that happens at booking time (createOccurrence), so a
    // preview never hard-fails on inventory.
    const addonItems = args.addons?.length
      ? args.addons
      : (args.addonIds ?? []).map((addonId) => ({ addonId, quantity: 1 }));
    const requestedIds = [...new Set(addonItems.map((i) => i.addonId))];
    const addonRows = requestedIds.length
      ? await tx.query.addons.findMany({
          where: and(
            inArray(addonsTable.id, requestedIds),
            eq(addonsTable.ownerId, venue.ownerId),
            eq(addonsTable.venueId, venue.id),
            eq(addonsTable.active, true),
          ),
        })
      : [];
    if (requestedIds.length && addonRows.length !== requestedIds.length) {
      throw new BadRequestException('Invalid add-on for this venue');
    }
    const qtyById = new Map(addonItems.map((i) => [i.addonId, i.quantity]));
    const addons = addonRows.map((row) => ({
      row,
      quantity: qtyById.get(row.id) ?? 1,
    }));
    const addonSubtotal = addons.reduce(
      (acc, a) => acc.add(dec(a.row.price).mul(a.quantity)),
      dec(0),
    );

    // 3. Pack (evaluate only; the booking path debits after the lock).
    let packDiscount = dec(0);
    let packSessions = 0;
    if (args.packId) {
      const app = await this.memberships.evaluatePack(
        venue.ownerId,
        customerId,
        args.packId,
        tx,
        venue.id,
        [...unitIds],
        slotInputs.length,
        slotSubtotal,
      );
      packDiscount = app.discount;
      packSessions = app.sessions;
    }

    // 4. Offer (applied to the post-pack slot + addon amount). Explicit code →
    // match by code; otherwise auto-apply the best valid offer. Both honour the
    // offer's validity window, venue scope, game scope and segment targeting.
    const offerBase = slotSubtotal.sub(packDiscount).add(addonSubtotal);
    const bookedGameIds = await this.gameIdsForUnits(tx, [...unitIds]);
    const customerSegments = await this.segmentsForCustomer(
      tx,
      ownerId,
      customerId,
    );
    const offerApp = await this.resolveOffer(tx, {
      ownerId,
      customerId,
      venueId: venue.id,
      offerCode: args.offerCode,
      base: offerBase,
      bookedGameIds,
      customerSegments,
    });
    const offerId = offerApp?.offerId;
    const offerDiscount = offerApp?.discount ?? dec(0);

    // 5. Loyalty points. Always resolve the balance + redeem value + max so the
    // preview can drive the slider even when nothing is being redeemed yet.
    const redeemValue = await this.loyalty.redeemValueFor(tx, ownerId, venue.id);
    const pointsBalance = Number(
      await this.loyalty.pointsBalance(tx, ownerId, customerId),
    );
    // Cap to what the remaining cash can absorb. Keep the computation in Decimal
    // (BUG-13) so we never lose precision through float division before flooring.
    const remaining = slotSubtotal
      .sub(packDiscount)
      .add(addonSubtotal)
      .sub(offerDiscount);
    const maxByCash =
      redeemValue > 0 ? remaining.div(redeemValue).floor().toNumber() : 0;
    const maxRedeemablePoints = Math.max(
      0,
      Math.min(pointsBalance, maxByCash),
    );
    const requested =
      args.pointsToRedeem && args.pointsToRedeem > 0 ? args.pointsToRedeem : 0;
    const pointsRedeemed = Math.min(requested, maxRedeemablePoints);
    const pointsValue = dec(pointsRedeemed).mul(redeemValue);

    const total = Decimal.max(
      slotSubtotal
        .sub(packDiscount)
        .add(addonSubtotal)
        .sub(offerDiscount)
        .sub(pointsValue),
      dec(0),
    );

    // 6. Deposit preview (decision #10). Split the FINAL total via the venue's
    // depositPct (null/0 → no deposit configured). Computed independently of the
    // chosen payment plan so the UI can show "Pay X now, Y at venue" before the
    // customer picks. depositAmount/balanceDueAtVenue are left undefined when
    // depositPct is 0 so a venue without deposits is unaffected.
    const settings = await tx.query.venueSettings.findFirst({
      where: eq(venueSettings.venueId, venue.id),
    });
    const depositPct = settings?.depositPct ? dec(settings.depositPct) : dec(0);
    let depositAmount: Decimal | undefined;
    let balanceDueAtVenue: Decimal | undefined;
    if (depositPct.greaterThan(0)) {
      const split = splitDeposit(total, depositPct);
      depositAmount = split.deposit;
      balanceDueAtVenue = split.balance;
    }

    return {
      slotRows,
      addons,
      slotSubtotal,
      addonSubtotal,
      packDiscount,
      packSessions,
      offerId,
      offerDiscount,
      pointsBalance,
      redeemValue,
      maxRedeemablePoints,
      pointsRedeemed,
      pointsValue,
      total,
      depositPct,
      depositAmount,
      balanceDueAtVenue,
    };
  }

  /**
   * Create a single booking occurrence (the original create() body, factored
   * out so the recurring path reuses the exact same pricing/offer/addon/slot/
   * ledger/payment logic). Runs inside the caller's transaction.
   */
  private async createOccurrence(
    tx: DbTx,
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

      // 0. Security M1: validate every requested slot server-side BEFORE pricing
      // or locking. Rejects non-grid-aligned / out-of-hours slots (400) and any
      // overlap — within this request or against existing slots — (409). Without
      // this the only collision guard is UNIQUE(unitId, startsAt), so two
      // overlapping-but-differently-anchored slots (10:00-11:00 and 10:30-11:30)
      // on the same court would both succeed.
      await this.validateRequestedSlots(tx, slotInputs);

      // 1–5. Price the cart via the shared, read-only core (the same code the
      // /bookings/quote preview runs, so the charge always matches the preview).
      // The full slot validation already ran above; priceQuote only computes
      // money + returns the slot/addon rows the lock + persistence below reuse.
      const {
        slotRows,
        addons,
        slotSubtotal,
        addonSubtotal,
        packDiscount,
        packSessions,
        offerId,
        offerDiscount,
        pointsRedeemed,
        pointsValue,
        total,
        depositPct,
      } = await this.priceQuote(tx, {
        venue,
        ownerId,
        customerId,
        slotInputs,
        addons: dto.addons,
        addonIds: dto.addonIds,
        packId: dto.packId,
        offerCode: dto.offerCode,
        pointsToRedeem: dto.pointsToRedeem,
      });

      // 5b. Snapshot the online/at-venue money split for ALL pay modes
      // (decision #4). This is the single source of truth for what Razorpay
      // charges and what the venue settles later:
      //   - prepay + 'full'    → pay the whole total online, nothing at venue
      //   - prepay + 'deposit' → pay only the deposit online, balance at venue
      //   - at_venue           → pay nothing online, the whole total at venue
      // The deposit plan is only honoured for prepay against a venue with a
      // configured depositPct (the create() guard already rejected the bad
      // combinations); we re-check depositPct>0 here so a misconfigured venue
      // falls back to full prepay rather than charging a zero deposit.
      const isDeposit =
        payMode === PayMode.PREPAY &&
        dto.paymentPlan === 'deposit' &&
        depositPct.greaterThan(0);
      let amountPaidOnline: Decimal;
      let amountDueAtVenue: Decimal;
      if (payMode === PayMode.PREPAY) {
        if (isDeposit) {
          const { deposit, balance } = splitDeposit(total, depositPct);
          amountPaidOnline = deposit;
          amountDueAtVenue = balance;
        } else {
          amountPaidOnline = total;
          amountDueAtVenue = dec(0);
        }
      } else {
        // pay-at-venue: nothing collected online, whole total settled on ground.
        amountPaidOnline = dec(0);
        amountDueAtVenue = total;
      }

      // 6. Create booking + occupying slot rows (the lock).
      const booking = (
        await tx
          .insert(bookings)
          .values({
            id: randomUUID(),
            ownerId,
            venueId: dto.venueId,
            customerId,
            payMode,
            paymentStatus:
              payMode === PayMode.PREPAY
                ? PaymentStatus.PENDING
                : PaymentStatus.AWAITING_VENUE_SETTLEMENT,
            subtotal: money(slotSubtotal.add(addonSubtotal)),
            discount: money(packDiscount.add(offerDiscount)),
            total: money(total),
            amountPaidOnline: money(amountPaidOnline),
            amountDueAtVenue: money(amountDueAtVenue),
            packId: dto.packId,
            offerId,
            pointsRedeemed: money(pointsValue),
            seriesId: args.seriesId,
            idempotencyKey: args.idempotencyKey,
          })
          .returning()
      )[0];

      // Record the offer redemption — the source of truth for usage caps.
      // Idempotent on bookingId; released (deleted) if the booking is cancelled.
      if (offerId) {
        await tx
          .insert(offerRedemptions)
          .values({
            id: randomUUID(),
            ownerId,
            offerId,
            customerId,
            bookingId: booking.id,
            amount: money(offerDiscount),
          })
          .onConflictDoNothing({ target: offerRedemptions.bookingId });
      }

      try {
        for (const r of slotRows) {
          await tx.insert(slots).values({
            id: randomUUID(),
            unitId: r.unitId,
            ownerId,
            startsAt: r.startsAt,
            endsAt: r.endsAt,
            status: 'booked',
            bookingId: booking.id,
          });
        }
      } catch (err) {
        if (isSlotConflictViolation(err)) {
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

      // 9. Persist the selected add-ons (BUG-5) and decrement tracked stock by
      // the requested quantity. Without the BookingAddon rows add-on revenue
      // reports are always zero, even though the price is charged and stock is
      // decremented. We record one row per add-on capturing the price charged at
      // booking time (unitPrice) and the quantity, so reports stay correct even
      // if the catalogue price later changes. Stock is enforced HERE (not in the
      // preview): reject if a tracked add-on can't cover the requested quantity —
      // the whole booking transaction rolls back, so nothing is half-applied.
      for (const { row: a, quantity } of addons) {
        if (a.stock != null && a.stock < quantity) {
          throw new BadRequestException(
            `Only ${a.stock} of "${a.name}" left — reduce the quantity.`,
          );
        }
        await tx.insert(bookingAddons).values({
          id: randomUUID(),
          bookingId: booking.id,
          addonId: a.id,
          unitPrice: money(dec(a.price)),
          quantity,
        });
        if (a.stock != null) {
          await tx
            .update(addonsTable)
            .set({ stock: a.stock - quantity })
            .where(eq(addonsTable.id, a.id));
        }
      }

      // 10. Razorpay order for prepay — but only when there is money to collect
      // ONLINE. For a deposit booking we charge only amountPaidOnline (the
      // deposit), leaving the balance to be settled at the venue; for full prepay
      // amountPaidOnline equals the total. When amountPaidOnline is 0 (a
      // fully-discounted total) we skip the gateway and mark PAID as before.
      let razorpayOrderId: string | undefined;
      if (payMode === PayMode.PREPAY) {
        if (amountPaidOnline.greaterThan(0)) {
          const order = await this.payments.createOrder(
            Number(amountPaidOnline),
            booking.id,
          );
          razorpayOrderId = order.id;
          await tx
            .update(bookings)
            .set({ razorpayOrderId })
            .where(eq(bookings.id, booking.id));
        } else {
          // BUG-7: a fully-discounted prepay booking has nothing to charge, so
          // no Razorpay order is created and confirmPayment() can never settle
          // it — it would hang in PENDING forever. Mark it PAID immediately
          // (mirroring markPaid's PREPAY branch) so it never gets stuck. There
          // is no cash spend, so loyalty earn (floor(0 * rate) = 0) is a no-op;
          // we keep markPaid's referral release for parity with a paid booking.
          await tx
            .update(bookings)
            .set({ paymentStatus: PaymentStatus.PAID })
            .where(eq(bookings.id, booking.id));
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

      // Owner in-app feed (the "bell"). Best-effort: createForOwner runs in its
      // OWN tenant transaction and never throws, and we fire-and-forget it so a
      // feed write can never roll back or fail the booking.
      void this.notifyOwnerBookingCreated(
        ownerId,
        customerId,
        venue.name,
        slotInputs,
      );

      const lineItems = [
        { label: `${slotInputs.length} slot(s)`, amount: Number(slotSubtotal) },
        ...addons.map(({ row, quantity }) => ({
          label: quantity > 1 ? `${row.name} ×${quantity}` : row.name,
          amount: Number(row.price) * quantity,
        })),
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
   * Security M1: server-side validation of a requested set of slots, run inside
   * the booking transaction BEFORE any pricing/locking. Three checks:
   *  1. Grid alignment (pure): each slot must start on the unit's operating grid
   *     (anchored at the venue openTime, stepped by the game's
   *     slotGranularityMin), be exactly one granularity step long, and fall
   *     within operating hours. A violation is a 400 — the client sent a slot the
   *     availability calendar would never have offered.
   *  2. Intra-request overlap (pure): no two slots in the SAME request may
   *     overlap on the same unit (interval intersection). A violation is a 409.
   *  3. Existing-slot overlap (DB): for each unit, reject if any existing slot
   *     row intersects [start, end) — the interval check the UNIQUE(unitId,
   *     startsAt) constraint cannot express. A violation is a 409, consistent
   *     with the unique-violation handling on the slot insert.
   *
   * Wall-clock comparison mirrors availability.service exactly: slot instants are
   * read in the server's local zone (via luxon) and compared by minute-of-day to
   * the venue's openTime/closeTime, so an already-grid-aligned booking the
   * calendar produced always passes.
   */
  private async validateRequestedSlots(
    tx: DbTx,
    slotInputs: { unitId: string; start: string; end: string }[],
    // The booking path needs the full lock guarantee (existing-slot overlap).
    // The /bookings/quote preview only needs grid alignment — it must price what
    // the customer selected without 409-ing if a slot was taken meanwhile.
    opts: { checkExisting?: boolean } = {},
  ): Promise<void> {
    const checkExisting = opts.checkExisting ?? true;
    if (slotInputs.length === 0) {
      throw new BadRequestException('Pick at least one slot.');
    }

    // Load the operating window + granularity for each referenced unit once.
    const unitIds = [...new Set(slotInputs.map((s) => s.unitId))];
    const units = await tx.query.bookableUnits.findMany({
      where: inArray(bookableUnits.id, unitIds),
      with: { venue: true, gameCatalogue: true },
    });
    const unitById = new Map(units.map((u) => [u.id, u]));

    // 1 + 2: per-slot grid validation and intra-request overlap detection. Both
    // use the pure helpers so they are exercised by the unit tests.
    const intervals: IntervalSlot[] = [];
    for (const s of slotInputs) {
      const unit = unitById.get(s.unitId);
      if (!unit) throw new BadRequestException('Unknown court selected.');

      // Interpret in IST so hour-of-day lines up with the venue's IST
      // openTime/closeTime even when the API runs in UTC (the string already
      // carries an offset; { zone } only governs how hour/minute are read back).
      const start = DateTime.fromISO(s.start, { zone: VENUE_TZ });
      const end = DateTime.fromISO(s.end, { zone: VENUE_TZ });
      if (!start.isValid || !end.isValid) {
        throw new BadRequestException('Slot has an invalid start or end time.');
      }
      const openMin = parseClockToMinutes(unit.venue.openTime);
      const closeMin = parseClockToMinutes(unit.venue.closeTime);
      if (openMin == null || closeMin == null) {
        throw new BadRequestException('Court operating hours are misconfigured.');
      }

      const reason = validateSlotOnGrid(
        { startMin: start.hour * 60 + start.minute, endMin: end.hour * 60 + end.minute },
        {
          openMin,
          closeMin,
          granularityMin: unit.gameCatalogue.slotGranularityMin,
        },
      );
      if (reason) throw new BadRequestException(reason);

      intervals.push({
        unitId: s.unitId,
        startMs: start.toMillis(),
        endMs: end.toMillis(),
      });
    }

    if (findIntraRequestOverlap(intervals) != null) {
      throw new ConflictException(
        'Two of the selected slots overlap on the same court. Please pick non-overlapping times.',
      );
    }

    // 3: existing-slot interval overlap (DB). For each requested slot, a clash
    // exists if some slot row on that unit satisfies startsAt < newEnd AND
    // endsAt > newStart. This catches partial overlaps the UNIQUE(unitId,
    // startsAt) key misses (e.g. 10:00-11:00 vs an existing 10:30-11:30).
    // Skipped for price previews (checkExisting=false).
    if (!checkExisting) return;
    for (const iv of intervals) {
      const clash = await tx.query.slots.findFirst({
        where: and(
          eq(slots.unitId, iv.unitId),
          lt(slots.startsAt, new Date(iv.endMs)),
          gt(slots.endsAt, new Date(iv.startMs)),
        ),
      });
      if (clash) {
        throw new ConflictException(
          clash.status === 'blocked'
            ? 'A selected time is blocked for this court. Please pick another.'
            : 'A selected time overlaps an existing booking. Please pick another.',
        );
      }
    }
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
          // Shift in IST so each weekly occurrence keeps the same wall-clock
          // time (the comment above promises DST-safety; IST has none today,
          // but pinning the zone keeps it correct if that ever changes).
          start: DateTime.fromISO(s.start, { zone: VENUE_TZ })
            .plus({ weeks: week })
            .toISO()!,
          end: DateTime.fromISO(s.end, { zone: VENUE_TZ })
            .plus({ weeks: week })
            .toISO()!,
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
    tx: DbTx,
    slotsArg: { unitId: string; start: string; end: string }[],
  ): Promise<string | null> {
    const existing = await tx.query.slots.findFirst({
      where: or(
        ...slotsArg.map((s) =>
          and(
            eq(slots.unitId, s.unitId),
            eq(slots.startsAt, DateTime.fromISO(s.start, { zone: VENUE_TZ }).toJSDate()),
          ),
        ),
      ),
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
    const booking = await this.db.withTenantBypass((tx) =>
      tx.query.bookings.findFirst({ where: eq(bookings.id, bookingId) }),
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

    return this.db.withTenantId(booking.ownerId, async (tx) => {
      // BOOK-5: lock the booking row before the check-then-act guard below.
      // Under READ COMMITTED the client-confirm and the webhook can otherwise
      // both read paymentStatus='pending', both pass the guard, and both run
      // loyalty.earn + write a capture row (double-credit). SELECT ... FOR UPDATE
      // serializes the two transactions on this row so only the first re-reads
      // the booking as still-unpaid; the second blocks, then sees PAID and
      // early-returns via the already-paid guard.
      await tx.execute(
        sql`SELECT 1 FROM bookings WHERE id = ${bookingId} FOR UPDATE`,
      );
      const fresh = await tx.query.bookings.findFirst({
        where: eq(bookings.id, bookingId),
      });
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

      // DEP-5: a deposit booking (amountDueAtVenue>0) splits the money lifecycle
      // across two markPaid calls. The first (online capture, while pending) only
      // collects the deposit and parks the booking in AWAITING_VENUE_SETTLEMENT —
      // loyalty/referral are deferred to settlement so the customer earns on the
      // FULL total exactly once. The second (the /settle path, from
      // AWAITING_VENUE_SETTLEMENT) records the at-venue balance and earns loyalty,
      // exactly as a pay-at-venue booking does.
      const isDeposit = dec(fresh.amountDueAtVenue).greaterThan(0);
      // A gateway call always carries a razorpayPaymentId; the venue-settlement
      // (/settle) path never does. A re-delivered gateway capture for a deposit
      // already in AWAITING_VENUE_SETTLEMENT must be a no-op — only /settle moves
      // it to SETTLED_AT_VENUE — otherwise a redelivered webhook would settle the
      // balance and double-deferred-earn.
      if (
        fresh.paymentStatus === PaymentStatus.AWAITING_VENUE_SETTLEMENT &&
        razorpayPaymentId
      ) {
        return { paid: true as const };
      }
      const isDepositOnlineCapture =
        isDeposit && fresh.paymentStatus === PaymentStatus.PENDING;

      // Resolve the next status:
      //  - deposit online capture → AWAITING_VENUE_SETTLEMENT (deposit paid,
      //    balance still due at the venue);
      //  - deposit balance settled at the venue (from AWAITING_VENUE_SETTLEMENT)
      //    → SETTLED_AT_VENUE, like a pay-at-venue booking;
      //  - full prepay → PAID; pay-at-venue → SETTLED_AT_VENUE.
      const nextStatus = isDepositOnlineCapture
        ? PaymentStatus.AWAITING_VENUE_SETTLEMENT
        : isDeposit
          ? PaymentStatus.SETTLED_AT_VENUE
          : fresh.payMode === PayMode.PREPAY
            ? PaymentStatus.PAID
            : PaymentStatus.SETTLED_AT_VENUE;

      await tx
        .update(bookings)
        .set({
          paymentStatus: nextStatus,
          // Persist the captured gateway payment id so a later cancellation can
          // issue a refund against it. Only set on the prepay handshake.
          ...(razorpayPaymentId ? { razorpayPaymentId } : {}),
        })
        .where(eq(bookings.id, bookingId));

      // Record the gateway capture (prepay handshake only — pay-at-venue is cash,
      // not a gateway transaction). For a deposit booking we capture only the
      // online portion (amountPaidOnline = the deposit); for full prepay
      // amountPaidOnline equals the total.
      if (razorpayPaymentId && fresh.payMode === PayMode.PREPAY) {
        await this.paymentLedger.record(tx, {
          ownerId: fresh.ownerId,
          customerId: fresh.customerId,
          refType: 'booking',
          refId: bookingId,
          type: 'capture',
          gatewayId: razorpayPaymentId,
          amount: fresh.amountPaidOnline,
          status: 'captured',
        });
      }

      // Defer loyalty/referral for a deposit's online capture; they fire once at
      // settlement (below branch) on the full total.
      if (isDepositOnlineCapture) {
        return { paid: true as const };
      }

      await this.loyalty.earn(
        tx,
        fresh.ownerId,
        fresh.customerId,
        dec(fresh.total),
        bookingId,
        fresh.venueId,
      );
      await this.referral.releaseOnFirstPaid(tx, fresh.ownerId, fresh.customerId);
      return { paid: true as const };
    });
  }

  /**
   * Owner/staff "balance due at venue" summary (DEP): the count and total of
   * money still owed at the venue — deposit bookings that captured their online
   * deposit and are parked in AWAITING_VENUE_SETTLEMENT with a positive balance.
   * Explicitly ownerId-scoped (RLS is the backstop); staff are limited to their
   * assigned venues, matching the bookings list.
   */
  async duesSummary(
    user: RequestUser,
  ): Promise<{ count: number; totalDue: number }> {
    const ownerId = user.ownerId!;
    return this.db.withTenant(async (tx) => {
      const conds = [
        eq(bookings.ownerId, ownerId),
        eq(bookings.paymentStatus, PaymentStatus.AWAITING_VENUE_SETTLEMENT),
        sql`${bookings.amountDueAtVenue} > 0`,
        sql`${bookings.status} <> 'cancelled'`,
      ];
      if (user.role === UserRole.STAFF) {
        const venueIds = user.assignedVenueIds ?? [];
        if (venueIds.length === 0) return { count: 0, totalDue: 0 };
        conds.push(inArray(bookings.venueId, venueIds));
      }
      const [row] = await tx
        .select({ c: count(), total: sum(bookings.amountDueAtVenue) })
        .from(bookings)
        .where(and(...conds));
      return { count: Number(row?.c ?? 0), totalDue: Number(row?.total ?? 0) };
    });
  }

  /**
   * Webhook: a Razorpay `payment.failed` event for a prepay order. Releases the
   * booking immediately instead of waiting for the 15-minute reaper, so a failed
   * payment frees the court right away. Idempotent + conservative: ONLY a still-
   * PENDING, never-captured PREPAY booking is released (slots deleted, status →
   * cancelled, paymentStatus → failed) — mirroring the reaper. A booking that
   * actually captured a payment, is already paid/settled, or already cancelled is
   * left untouched, so a stray failed event for one attempt can never cancel a
   * paid booking. No refund is issued (nothing was captured). Internal: called
   * from the signature-verified webhook, so it runs under the booking's tenant.
   */
  async markPaymentFailed(orderId: string): Promise<{ released: boolean }> {
    const booking = await this.db.withTenantBypass((tx) =>
      tx.query.bookings.findFirst({
        where: eq(bookings.razorpayOrderId, orderId),
      }),
    );
    if (!booking) return { released: false };

    return this.db.withTenantId(booking.ownerId, async (tx) => {
      // Serialize against a concurrent capture (webhook ordering isn't
      // guaranteed): lock the row, then re-read under the lock.
      await tx.execute(
        sql`SELECT 1 FROM bookings WHERE id = ${booking.id} FOR UPDATE`,
      );
      const fresh = await tx.query.bookings.findFirst({
        where: eq(bookings.id, booking.id),
      });
      if (!fresh) return { released: false };
      const uncapturedPending =
        fresh.status !== BookingStatus.CANCELLED &&
        fresh.payMode === PayMode.PREPAY &&
        fresh.paymentStatus === PaymentStatus.PENDING &&
        fresh.razorpayPaymentId == null;
      if (!uncapturedPending) return { released: false };

      await tx.delete(slots).where(eq(slots.bookingId, fresh.id));
      await tx
        .update(bookings)
        .set({
          status: BookingStatus.CANCELLED,
          paymentStatus: PaymentStatus.FAILED,
        })
        .where(eq(bookings.id, fresh.id));
      this.logger.log(
        `payment.failed: released PENDING prepay booking ${fresh.id} (order ${orderId}); slots freed.`,
      );
      return { released: true };
    });
  }

  /**
   * Webhook: a Razorpay `refund.processed` / `refund.created` event. Reconciles a
   * gateway refund back to the booking so refunded money is never invisible.
   * Idempotent: if this refund id is already in the payment ledger (our own
   * cancel() path issued it, or a redelivered webhook), it's a no-op. A refund we
   * have NO record of — one initiated from the Razorpay dashboard, bypassing
   * cancel() — is recorded to the ledger and the booking is marked REFUNDED, with
   * a warning for ops to reconcile the booking state (slots are not auto-freed
   * here to avoid firing clawback side-effects from a webhook). Matched by the
   * captured payment id. Internal: signature-verified webhook → booking's tenant.
   */
  async reconcileRefund(input: {
    paymentId: string;
    refundId: string;
    amountRupees: number;
    status: string;
  }): Promise<{ reconciled: boolean }> {
    const booking = await this.db.withTenantBypass((tx) =>
      tx.query.bookings.findFirst({
        where: eq(bookings.razorpayPaymentId, input.paymentId),
      }),
    );
    if (!booking) return { reconciled: false };

    return this.db.withTenantId(booking.ownerId, async (tx) => {
      if (await this.paymentLedger.existsByGatewayId(tx, input.refundId)) {
        return { reconciled: false };
      }
      await this.paymentLedger.record(tx, {
        ownerId: booking.ownerId,
        customerId: booking.customerId,
        refType: 'booking',
        refId: booking.id,
        type: 'refund',
        gatewayId: input.refundId,
        amount: input.amountRupees.toString(),
        status: input.status,
        note: 'Reconciled from Razorpay refund webhook (gateway-initiated)',
      });
      if (booking.paymentStatus !== PaymentStatus.REFUNDED) {
        await tx
          .update(bookings)
          .set({ paymentStatus: PaymentStatus.REFUNDED })
          .where(eq(bookings.id, booking.id));
      }
      this.logger.warn(
        `Reconciled gateway-initiated refund ${input.refundId} for booking ${booking.id} ` +
          `(payment ${input.paymentId}); marked REFUNDED — review booking/slot state.`,
      );
      return { reconciled: true };
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
    const booking = await this.db.withTenantBypass((tx) =>
      tx.query.bookings.findFirst({ where: eq(bookings.id, bookingId) }),
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
    // AWAITING_VENUE_SETTLEMENT means a deposit booking's online portion is
    // already captured; the at-venue balance is settled via the /settle path,
    // not by re-confirming the gateway handshake, so we stop here too (otherwise
    // a second confirm would wrongly settle the balance and earn loyalty).
    if (
      booking.paymentStatus === PaymentStatus.PAID ||
      booking.paymentStatus === PaymentStatus.SETTLED_AT_VENUE ||
      booking.paymentStatus === PaymentStatus.AWAITING_VENUE_SETTLEMENT
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
    const booking = await this.db.withTenantBypass((tx) =>
      tx.query.bookings.findFirst({
        where: eq(bookings.id, bookingId),
        with: { slots: true },
      }),
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
    let refund: {
      amount: Decimal;
      gatewayId: string;
      fee: Decimal;
      status: string;
    } | null = null;
    // DEP-7: a deposit booking in AWAITING_VENUE_SETTLEMENT has its online
    // deposit captured (amountPaidOnline>0) and is refundable too; full prepay
    // stays PAID as before. We refund only the money actually collected online,
    // net of the standard fee.
    const isPaid =
      booking.status !== BookingStatus.CANCELLED &&
      booking.payMode === PayMode.PREPAY &&
      (booking.paymentStatus === PaymentStatus.PAID ||
        (booking.paymentStatus === PaymentStatus.AWAITING_VENUE_SETTLEMENT &&
          dec(booking.amountPaidOnline).greaterThan(0))) &&
      booking.razorpayPaymentId != null &&
      dec(booking.amountPaidOnline).greaterThan(0);
    if (isPaid) {
      // Fee is computed off the total per the cancellation template; the refund
      // returns only the online portion net of that fee. If the fee meets or
      // exceeds the deposit, refund 0 and create NO ledger DUE for the shortfall
      // (the venue keeps the deposit as the penalty).
      const fee = await this.cancellationFee(booking);
      const refundable = Decimal.max(
        dec(booking.amountPaidOnline).sub(fee),
        dec(0),
      );
      if (refundable.greaterThan(0)) {
        const res = await this.payments.refund(
          booking.razorpayPaymentId as string,
          Number(refundable),
        );
        refund = { amount: refundable, gatewayId: res.id, fee, status: res.status };
      } else {
        refund = { amount: dec(0), gatewayId: '', fee, status: 'skipped' };
      }
    }

    // Venue name for the owner feed notification (best-effort; bypass read).
    const venueRow = await this.db.withTenantBypass((tx) =>
      tx.query.venues.findFirst({
        where: eq(venues.id, booking.venueId),
        columns: { name: true },
      }),
    );
    const venueName = venueRow?.name ?? '';

    return this.db.withTenantId(booking.ownerId, async (tx) => {
      const fresh = await tx.query.bookings.findFirst({
        where: eq(bookings.id, bookingId),
        with: { slots: true },
      });
      if (!fresh || fresh.status === BookingStatus.CANCELLED) {
        return { cancelled: true as const };
      }

      await tx.delete(slots).where(eq(slots.bookingId, bookingId));
      await tx
        .update(bookings)
        .set({
          status: BookingStatus.CANCELLED,
          ...(refund && refund.amount.greaterThan(0)
            ? { paymentStatus: PaymentStatus.REFUNDED }
            : {}),
        })
        .where(eq(bookings.id, bookingId));

      // Release the offer redemption so the use returns to the cap (a cancelled
      // booking shouldn't burn a one-time / limited code).
      await tx
        .delete(offerRedemptions)
        .where(eq(offerRedemptions.bookingId, bookingId));

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
      if (dec(fresh.pointsRedeemed).greaterThan(0)) {
        await this.loyalty.creditRefund(
          tx,
          fresh.ownerId,
          fresh.customerId,
          dec(fresh.pointsRedeemed),
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
        const earned = await tx.query.ledgerTxns.findFirst({
          where: and(
            eq(ledgerTxns.customerId, fresh.customerId),
            eq(ledgerTxns.lane, pointsLane(fresh.ownerId)),
            eq(ledgerTxns.type, LedgerTxnType.POINTS_EARN),
            eq(ledgerTxns.refType, 'booking'),
            eq(ledgerTxns.refId, bookingId),
            gt(ledgerTxns.amount, '0'),
          ),
          orderBy: desc(ledgerTxns.createdAt),
        });
        if (earned && dec(earned.amount).greaterThan(0)) {
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
          const reversal = Decimal.min(dec(earned.amount), balance);
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

      // Record the gateway refund on the append-only cash ledger, and on the
      // payments ledger with the gateway id + status (reconcilable).
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
        await this.paymentLedger.record(tx, {
          ownerId: fresh.ownerId,
          customerId: fresh.customerId,
          refType: 'booking',
          refId: bookingId,
          type: 'refund',
          gatewayId: refund.gatewayId,
          amount: refund.amount.toString(),
          fee: refund.fee.toString(),
          status: refund.status,
        });
      }

      // Owner in-app feed. Best-effort and fire-and-forget so it can never roll
      // back or fail the cancellation; only fired for an actual cancellation
      // (the idempotent already-cancelled path above returns before this).
      void this.notifyOwnerBookingCancelled(
        fresh.ownerId,
        fresh.customerId,
        venueName,
        fresh.slots,
      );
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
    total: string;
    slots: { startsAt: Date }[];
  }): Promise<Decimal> {
    const zero = dec(0);
    const settings = await this.db.withTenantBypass((tx) =>
      tx.query.venueSettings.findFirst({
        where: eq(venueSettings.venueId, booking.venueId),
      }),
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
    return dec(booking.total)
      .mul(template.penaltyPct)
      .div(100)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
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

    return this.db.withTenantId(ownerId, async (tx) => {
      const conds = [];
      if (filters.status) conds.push(eq(bookings.status, filters.status));
      if (filters.paymentStatus)
        conds.push(eq(bookings.paymentStatus, filters.paymentStatus));

      // Staff can only see bookings for the venues assigned to them.
      const staffVenues =
        user.role === UserRole.STAFF ? user.assignedVenueIds ?? [] : null;
      if (filters.venueId) {
        if (staffVenues && !staffVenues.includes(filters.venueId)) return [];
        conds.push(eq(bookings.venueId, filters.venueId));
      } else if (staffVenues) {
        if (staffVenues.length === 0) return [];
        conds.push(inArray(bookings.venueId, staffVenues));
      }

      // Date-range and court filters apply to the occupying slot rows. We
      // resolve the matching bookingIds from the slot rows first, then scope the
      // booking query to them (the relational query builder cannot filter a
      // parent by a related-row predicate directly).
      const slotConds = [];
      if (filters.unitId) slotConds.push(eq(slots.unitId, filters.unitId));
      if (filters.from)
        slotConds.push(
          gte(
            slots.startsAt,
            DateTime.fromISO(filters.from, { zone: VENUE_TZ }).startOf('day').toJSDate(),
          ),
        );
      if (filters.to)
        slotConds.push(
          lte(
            slots.startsAt,
            DateTime.fromISO(filters.to, { zone: VENUE_TZ }).endOf('day').toJSDate(),
          ),
        );
      if (slotConds.length > 0) {
        const matchingSlots = await tx.query.slots.findMany({
          where: and(...slotConds),
          columns: { bookingId: true },
        });
        const bookingIds = [
          ...new Set(
            matchingSlots
              .map((s) => s.bookingId)
              .filter((id): id is string => id != null),
          ),
        ];
        if (bookingIds.length === 0) return [];
        conds.push(inArray(bookings.id, bookingIds));
      }

      const bookingRows = await tx.query.bookings.findMany({
        where: conds.length > 0 ? and(...conds) : undefined,
        with: { slots: true, user: true },
        orderBy: desc(bookings.createdAt),
      });

      // Enrich with venue + court names and the per-owner customer profile.
      const venueIds = [...new Set(bookingRows.map((b) => b.venueId))];
      const unitIds = [
        ...new Set(bookingRows.flatMap((b) => b.slots.map((s) => s.unitId))),
      ];
      const customerIds = [...new Set(bookingRows.map((b) => b.customerId))];
      const [venueRows, unitRows, profiles] = await Promise.all([
        venueIds.length
          ? tx.query.venues.findMany({ where: inArray(venues.id, venueIds) })
          : Promise.resolve([]),
        unitIds.length
          ? tx.query.bookableUnits.findMany({
              where: inArray(bookableUnits.id, unitIds),
            })
          : Promise.resolve([]),
        customerIds.length
          ? tx.query.playerProfiles.findMany({
              where: inArray(playerProfiles.customerId, customerIds),
            })
          : Promise.resolve([]),
      ]);
      const venueName = new Map(venueRows.map((v) => [v.id, v.name]));
      const unitName = new Map(unitRows.map((u) => [u.id, u.name]));
      const profileByCustomer = new Map(profiles.map((p) => [p.customerId, p]));

      const items: OwnerBooking[] = bookingRows.map((b) => {
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
          customerName: profile?.name ?? b.user?.name ?? null,
          customerMobile: profile?.mobile ?? b.user?.mobile ?? null,
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
          checkedInAt: b.checkedInAt ? b.checkedInAt.toISOString() : null,
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
    const bookingRows = await this.db.withTenantBypass((tx) =>
      tx.query.bookings.findMany({
        where: eq(bookings.customerId, user.id),
        with: { slots: true },
        orderBy: desc(bookings.createdAt),
      }),
    );
    if (bookingRows.length === 0) return [];

    const venueIds = [...new Set(bookingRows.map((b) => b.venueId))];
    const unitIds = [
      ...new Set(bookingRows.flatMap((b) => b.slots.map((s) => s.unitId))),
    ];
    const [venueRows, unitRows] = await this.db.withTenantBypass((tx) =>
      Promise.all([
        venueIds.length
          ? tx.query.venues.findMany({ where: inArray(venues.id, venueIds) })
          : Promise.resolve([]),
        unitIds.length
          ? tx.query.bookableUnits.findMany({
              where: inArray(bookableUnits.id, unitIds),
            })
          : Promise.resolve([]),
      ]),
    );
    const venueName = new Map(venueRows.map((v) => [v.id, v.name]));
    const unitName = new Map(unitRows.map((u) => [u.id, u.name]));

    return bookingRows.map((b) => this.toCustomerBooking(b, venueName, unitName));
  }

  /**
   * Fetch a single booking that the caller is entitled to see: the owner/staff
   * of the booking's tenant (staff limited to their assigned venues) or the
   * owning customer. Enriched the same way as the relevant list view.
   */
  async getOne(bookingId: string, user: RequestUser): Promise<CustomerBooking> {
    const booking = await this.db.withTenantBypass((tx) =>
      tx.query.bookings.findFirst({
        where: eq(bookings.id, bookingId),
        with: { slots: true },
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

    const unitIds = booking.slots.map((s) => s.unitId);
    const [venueRows, unitRows] = await this.db.withTenantBypass((tx) =>
      Promise.all([
        tx.query.venues.findMany({ where: eq(venues.id, booking.venueId) }),
        unitIds.length
          ? tx.query.bookableUnits.findMany({
              where: inArray(bookableUnits.id, unitIds),
            })
          : Promise.resolve([]),
      ]),
    );
    const venueName = new Map(venueRows.map((v) => [v.id, v.name]));
    const unitName = new Map(unitRows.map((u) => [u.id, u.name]));
    return this.toCustomerBooking(booking, venueName, unitName);
  }

  private toCustomerBooking(
    b: {
      id: string;
      status: string;
      payMode: string;
      paymentStatus: string;
      total: string;
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
    const booking = await this.db.withTenantBypass((tx) =>
      tx.query.bookings.findFirst({
        where: eq(bookings.id, bookingId),
        with: { slots: true },
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

    await this.db.withTenantId(booking.ownerId, (tx) =>
      tx.update(bookings).set({ status }).where(eq(bookings.id, bookingId)),
    );
    return { status };
  }

  /**
   * Owner/staff: mark the customer as arrived (checked in). Idempotent — a second
   * call keeps the original arrival time. Blocked for cancelled / no-show
   * bookings. checkedInAt is orthogonal to `status` (a confirmed booking can be
   * checked in and later completed/no-show), so this doesn't touch status.
   */
  async checkIn(
    bookingId: string,
    user: RequestUser,
  ): Promise<{ checkedInAt: string }> {
    const booking = await this.loadOwnedBooking(bookingId, user);
    if (booking.status === BookingStatus.CANCELLED) {
      throw new BadRequestException('Cannot check in a cancelled booking.');
    }
    if (booking.status === BookingStatus.NO_SHOW) {
      throw new BadRequestException('Cannot check in a booking marked no-show.');
    }
    if (booking.checkedInAt) {
      return { checkedInAt: booking.checkedInAt.toISOString() };
    }
    const now = new Date();
    await this.db.withTenantId(booking.ownerId, (tx) =>
      tx.update(bookings).set({ checkedInAt: now }).where(eq(bookings.id, bookingId)),
    );
    return { checkedInAt: now.toISOString() };
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
    const settings = await this.db.withTenantBypass((tx) =>
      tx.query.venueSettings.findFirst({
        where: eq(venueSettings.venueId, booking.venueId),
      }),
    );
    const fee = settings ? dec(settings.noShowFee) : dec(0);

    await this.db.withTenantId(booking.ownerId, async (tx) => {
      const fresh = await tx.query.bookings.findFirst({
        where: eq(bookings.id, booking.id),
      });
      if (!fresh) throw new NotFoundException('Booking not found');

      // DEP-8: a deposit booking (amountDueAtVenue>0) already forfeits its
      // online deposit as the no-show penalty, so skip the flat noShowFee — no
      // double charge. Prepay/at_venue no-show behaviour is unchanged.
      const isDeposit = dec(fresh.amountDueAtVenue).greaterThan(0);
      const applyFee =
        !isDeposit && fee.greaterThan(0) && !fresh.noShowFeeApplied;
      await tx
        .update(bookings)
        .set({
          status: BookingStatus.NO_SHOW,
          ...(applyFee ? { noShowFeeApplied: true } : {}),
        })
        .where(eq(bookings.id, booking.id));

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

    return this.db.withTenantId(booking.ownerId, async (tx) => {
      // The new courts must belong to the booking's own venue. This keeps the
      // booking's venueId consistent and (since staff are already scoped to the
      // booking's venue) holds staff within their assigned venues.
      const newUnitIds = [...new Set(newSlots.map((s) => s.unitId))];
      const units = await tx.query.bookableUnits.findMany({
        where: inArray(bookableUnits.id, newUnitIds),
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
      let oldSlotSubtotal = dec(0);
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
      let newSlotSubtotal = dec(0);
      const rows: { unitId: string; startsAt: Date; endsAt: Date }[] = [];
      for (const s of newSlots) {
        const start = DateTime.fromISO(s.start, { zone: VENUE_TZ }).toJSDate();
        const end = DateTime.fromISO(s.end, { zone: VENUE_TZ }).toJSDate();
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
      await tx.delete(slots).where(eq(slots.bookingId, bookingId));
      try {
        for (const r of rows) {
          await tx.insert(slots).values({
            id: randomUUID(),
            unitId: r.unitId,
            ownerId: booking.ownerId,
            startsAt: r.startsAt,
            endsAt: r.endsAt,
            status: 'booked',
            bookingId,
          });
        }
      } catch (err) {
        if (isSlotConflictViolation(err)) {
          throw new ConflictException(
            'One or more of the new slots are already booked. Please pick another.',
          );
        }
        throw err;
      }

      const delta = newSlotSubtotal.sub(oldSlotSubtotal);
      const zero = dec(0);
      const oldTotal = dec(booking.total);
      const newTotal = Decimal.max(oldTotal.add(delta), zero);
      await tx
        .update(bookings)
        .set({
          subtotal: money(Decimal.max(dec(booking.subtotal).add(delta), zero)),
          total: money(newTotal),
        })
        .where(eq(bookings.id, bookingId));

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
        const actualDelta = newTotal.sub(oldTotal);
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

    return this.db.withTenantId(booking.ownerId, async (tx) => {
      await tx
        .insert(playerProfiles)
        .values({
          id: randomUUID(),
          ownerId: booking.ownerId,
          customerId: booking.customerId,
          name,
          mobile,
        })
        .onConflictDoUpdate({
          target: [playerProfiles.ownerId, playerProfiles.customerId],
          set: { name, mobile },
        });
      return { name, mobile };
    });
  }

  /** Distinct game ids for the given bookable units (for offer game scoping). */
  private async gameIdsForUnits(
    tx: DbTx,
    unitIds: string[],
  ): Promise<string[]> {
    if (unitIds.length === 0) return [];
    const units = await tx.query.bookableUnits.findMany({
      where: inArray(bookableUnits.id, unitIds),
      columns: { gameId: true },
    });
    return [...new Set(units.map((u) => u.gameId))];
  }

  /**
   * The marketing segments a customer falls into for this owner — delegates to
   * the shared helper so offer scoping and the customer offers inbox use ONE
   * definition (new / lapsed / regulars / members). See ../../db/segments.
   */
  private segmentsForCustomer(
    tx: DbTx,
    ownerId: string,
    customerId: string,
  ): Promise<string[]> {
    return customerSegments(tx, ownerId, customerId);
  }

  /** True if an offer's scope matches the current booking context. */
  private offerInScope(
    offer: {
      venueIds: string[] | null;
      gameIds: string[] | null;
      segment: string | null;
    },
    ctx: { venueId: string; bookedGameIds: string[]; customerSegments: string[] },
  ): boolean {
    const venueIds = offer.venueIds ?? [];
    const gameIds = offer.gameIds ?? [];
    if (venueIds.length > 0 && !venueIds.includes(ctx.venueId)) {
      return false;
    }
    if (
      gameIds.length > 0 &&
      !ctx.bookedGameIds.some((g) => gameIds.includes(g))
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
    tx: DbTx,
    args: {
      ownerId: string;
      customerId: string;
      venueId: string;
      offerCode?: string;
      base: Decimal;
      bookedGameIds: string[];
      customerSegments: string[];
    },
  ): Promise<{ offerId: string; discount: Decimal } | null> {
    const now = new Date();
    // Validity window: active AND (no validFrom OR validFrom <= now) AND
    // (no validTo OR validTo >= now).
    const validWindow = and(
      eq(offers.active, true),
      or(isNull(offers.validFrom), lte(offers.validFrom, now)),
      or(isNull(offers.validTo), gte(offers.validTo, now)),
    );

    const scopeCtx = {
      venueId: args.venueId,
      bookedGameIds: args.bookedGameIds,
      customerSegments: args.customerSegments,
    };
    const discountFor = (offer: { type: string; value: string }): Decimal =>
      offer.type === 'percent'
        ? // round the percent discount to 2dp HALF_UP so the discount is a clean
          // currency amount and the derived total stays consistent.
          args.base
            .mul(dec(offer.value))
            .div(100)
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        : Decimal.min(dec(offer.value), args.base);

    // Full eligibility for ONE offer: venue/game/segment scope, minimum order
    // value, total + per-customer usage caps, and the maxDiscount-capped amount.
    // Returns the discount to apply, or null if it doesn't qualify. Authoritative
    // — the quote AND the booking both run this, so a client cannot bypass a cap.
    type OfferRow = {
      id: string;
      type: string;
      value: string;
      venueIds: string[] | null;
      gameIds: string[] | null;
      segment: string | null;
      minOrderValue: string | null;
      maxDiscount: string | null;
      usageLimit: number | null;
      perUserLimit: number | null;
    };
    const applicable = async (offer: OfferRow): Promise<Decimal | null> => {
      if (!this.offerInScope(offer, scopeCtx)) return null;
      // Minimum order value, measured on the post-pack discountable base.
      if (
        offer.minOrderValue != null &&
        args.base.lessThan(dec(offer.minOrderValue))
      ) {
        return null;
      }
      // Total redemption cap.
      if (offer.usageLimit != null) {
        const [tot] = await tx
          .select({ c: count() })
          .from(offerRedemptions)
          .where(eq(offerRedemptions.offerId, offer.id));
        if (Number(tot?.c ?? 0) >= offer.usageLimit) return null;
      }
      // Per-customer cap (perUserLimit = 1 ⇒ a one-time-per-player code).
      if (offer.perUserLimit != null) {
        const [mine] = await tx
          .select({ c: count() })
          .from(offerRedemptions)
          .where(
            and(
              eq(offerRedemptions.offerId, offer.id),
              eq(offerRedemptions.customerId, args.customerId),
            ),
          );
        if (Number(mine?.c ?? 0) >= offer.perUserLimit) return null;
      }
      let discount = discountFor(offer);
      // Max-discount cap (chiefly for percent offers — "20% off, up to ₹200").
      if (offer.maxDiscount != null) {
        discount = Decimal.min(discount, dec(offer.maxDiscount));
      }
      return discount.greaterThan(0) ? discount : null;
    };

    // Owner-scope every offer lookup (defense-in-depth): the dev DB connects as
    // a superuser that BYPASSES RLS, so without an explicit ownerId filter a
    // customer could redeem another owner's promo code. Offers carry a
    // denormalised ownerId.
    if (args.offerCode) {
      const offer = await tx.query.offers.findFirst({
        where: and(
          eq(offers.code, args.offerCode),
          eq(offers.ownerId, args.ownerId),
          validWindow,
        ),
      });
      if (!offer) return null;
      const discount = await applicable(offer);
      return discount ? { offerId: offer.id, discount } : null;
    }

    // Auto-apply: pick whichever valid, in-scope, in-budget auto-apply offer
    // gives the largest discount for this booking.
    const candidates = await tx.query.offers.findMany({
      where: and(
        eq(offers.autoApply, true),
        eq(offers.ownerId, args.ownerId),
        validWindow,
      ),
    });
    let best: { offerId: string; discount: Decimal } | null = null;
    for (const offer of candidates) {
      const discount = await applicable(offer);
      if (!discount) continue;
      if (!best || discount.greaterThan(best.discount)) {
        best = { offerId: offer.id, discount };
      }
    }
    return best;
  }

  private async resolveCustomer(
    tx: DbTx,
    dto: CreateBookingDto,
    user: RequestUser | undefined,
  ): Promise<string> {
    if (user?.role === 'customer') return user.id;
    if (dto.customer) {
      const existing = await tx.query.users.findFirst({
        where: eq(users.mobile, dto.customer.mobile),
      });
      if (existing) return existing.id;
      const created = (
        await tx
          .insert(users)
          .values({
            id: randomUUID(),
            role: 'customer',
            name: dto.customer.name,
            mobile: dto.customer.mobile,
          })
          .returning()
      )[0];
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
      const customer = await this.db.withTenantBypass((tx) =>
        tx.query.users.findFirst({
          where: eq(users.id, customerId),
          columns: { mobile: true },
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

  /** Resolve a human-friendly customer label for a notification body. */
  private async customerLabel(customerId: string): Promise<string> {
    try {
      const customer = await this.db.withTenantBypass((tx) =>
        tx.query.users.findFirst({
          where: eq(users.id, customerId),
          columns: { name: true, mobile: true },
        }),
      );
      return customer?.name?.trim() || customer?.mobile?.trim() || 'A customer';
    } catch {
      return 'A customer';
    }
  }

  /** Format an ISO start time (a stored UTC instant) in venue time (IST) for a
   * notification body. Pinned to VENUE_TZ so it reads correctly regardless of the
   * server's timezone. */
  private formatSlotTime(iso: string): string {
    const dt = DateTime.fromISO(iso, { zone: VENUE_TZ });
    return dt.isValid ? dt.toFormat('d LLL, h:mm a') : iso;
  }

  /**
   * Best-effort owner in-app notification for a newly created booking. Never
   * awaited in a way that affects the booking tx (createForOwner swallows its
   * own errors and uses its own tenant transaction).
   */
  private async notifyOwnerBookingCreated(
    ownerId: string,
    customerId: string,
    venueName: string,
    slotInputs: { unitId: string; start: string; end: string }[],
  ): Promise<void> {
    const who = await this.customerLabel(customerId);
    const when = slotInputs.length ? this.formatSlotTime(slotInputs[0].start) : '';
    const slotPart =
      slotInputs.length > 1 ? `${slotInputs.length} slots` : '1 slot';
    const body =
      `${who} booked ${slotPart} at ${venueName}` +
      (when ? ` (${when})` : '') +
      '.';
    await this.feed.createForOwner(ownerId, {
      type: 'booking_created',
      title: 'New booking',
      body,
      link: '/owner/bookings',
    });
  }

  /**
   * Best-effort owner in-app notification for a cancelled booking. Same
   * best-effort contract as {@link notifyOwnerBookingCreated}.
   */
  private async notifyOwnerBookingCancelled(
    ownerId: string,
    customerId: string,
    venueName: string,
    slots: { startsAt: Date }[],
  ): Promise<void> {
    const who = await this.customerLabel(customerId);
    const first = slots
      .map((s) => s.startsAt.getTime())
      .sort((a, b) => a - b)[0];
    const when =
      first != null ? this.formatSlotTime(new Date(first).toISOString()) : '';
    const body =
      `${who}'s booking at ${venueName} was cancelled` +
      (when ? ` (${when})` : '') +
      '.';
    await this.feed.createForOwner(ownerId, {
      type: 'booking_cancelled',
      title: 'Booking cancelled',
      body,
      link: '/owner/bookings',
    });
  }

  private async capturePlayer(
    tx: DbTx,
    ownerId: string,
    customerId: string,
  ): Promise<void> {
    const user = await tx.query.users.findFirst({
      where: eq(users.id, customerId),
    });
    if (!user) return;
    await tx
      .insert(ownerCustomers)
      .values({
        id: randomUUID(),
        ownerId,
        customerId,
        bookingCount: 1,
        lastVisitAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [ownerCustomers.ownerId, ownerCustomers.customerId],
        set: {
          bookingCount: sql`${ownerCustomers.bookingCount} + 1`,
          lastVisitAt: new Date(),
        },
      });
    await tx
      .insert(playerProfiles)
      .values({
        id: randomUUID(),
        ownerId,
        customerId,
        name: user.name,
        mobile: user.mobile ?? '',
      })
      .onConflictDoNothing({
        target: [playerProfiles.ownerId, playerProfiles.customerId],
      });
  }

  private toResponse(
    booking: {
      id: string;
      status: string;
      payMode: string;
      paymentStatus: string;
      total: string;
      amountPaidOnline?: string;
      amountDueAtVenue?: string;
    },
    lineItems: { label: string; amount: number }[],
  ): BookingResponse {
    return {
      id: booking.id,
      status: booking.status,
      payMode: booking.payMode as PayMode,
      paymentStatus: booking.paymentStatus as PaymentStatus,
      total: Number(booking.total),
      // Expose the online/at-venue split (decision #2). Serialized as 2dp
      // strings, matching the columns; undefined-safe for callers that hand us a
      // row without the split (e.g. legacy callers of toResponse).
      ...(booking.amountPaidOnline != null
        ? { amountPaidOnline: booking.amountPaidOnline }
        : {}),
      ...(booking.amountDueAtVenue != null
        ? { amountDueAtVenue: booking.amountDueAtVenue }
        : {}),
      lineItems,
    };
  }
}
