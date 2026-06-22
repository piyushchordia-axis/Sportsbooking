import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LedgerTxnType,
  PackExpiryMode,
  PackPricingMode,
} from '@sportsbooking/shared';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentService } from '../payments/payment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePackDto, UpdatePackDto } from './dto';

export function packLane(packId: string): string {
  return `pack:${packId}`;
}

export interface PackApplication {
  /** rupee value the pack covers/discounts on the slot subtotal */
  discount: Prisma.Decimal;
  /** sessions to debit (one per slot) */
  sessions: number;
}

/**
 * Membership session packs (PRD §4.4). Packs load sessions into the customer's
 * append-only ledger and are debited per booking. Pricing per pack is either
 * flat-rate (pack fully covers the slot, dynamic price ignored) or a % discount
 * on the dynamic price.
 */
@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    // Resolved by Nest DI (PaymentsModule is @Global). Optional only so unit
    // tests can construct the service without a payments stub; production always
    // receives a real instance.
    private readonly payments?: PaymentService,
  ) {}

  // ---- Owner: pack catalogue ----
  createPack(user: RequestUser, dto: CreatePackDto) {
    const ownerId = user.ownerId!;
    if (dto.pricingMode === PackPricingMode.DISCOUNT && dto.discountPct == null) {
      throw new BadRequestException('discountPct required for discount packs');
    }
    return this.prisma.withTenant((tx) =>
      tx.membershipPack.create({
        data: {
          ownerId,
          name: dto.name,
          sessions: dto.sessions,
          price: new Prisma.Decimal(dto.price),
          validityDays: dto.validityDays,
          expiryMode: dto.expiryMode,
          pricingMode: dto.pricingMode,
          discountPct:
            dto.discountPct != null ? new Prisma.Decimal(dto.discountPct) : null,
          flatRate:
            dto.flatRate != null ? new Prisma.Decimal(dto.flatRate) : null,
          venueIds: dto.venueIds ?? [],
          unitIds: dto.unitIds ?? [],
        },
      }),
    );
  }

  /**
   * Update a pack definition (owner/staff, tenant-scoped). Only mutable
   * catalogue fields change — purchased ledger sessions reference the pack by
   * id and stay intact. Validates pricing-mode invariants on the merged result.
   */
  updatePack(user: RequestUser, packId: string, dto: UpdatePackDto) {
    const ownerId = user.ownerId!;
    return this.prisma.withTenant(async (tx) => {
      // Explicit owner scoping (defense-in-depth): the dev DATABASE_URL connects
      // as a superuser that BYPASSES RLS, so a findUnique({ id }) here would let
      // an owner mutate another tenant's pack. MembershipPack carries a
      // denormalised ownerId — scope on it and 404 if not owned.
      const pack = await tx.membershipPack.findFirst({
        where: { id: packId, ownerId },
      });
      if (!pack) throw new NotFoundException('Pack not found');

      const pricingMode = dto.pricingMode ?? pack.pricingMode;
      const discountPct =
        dto.discountPct !== undefined
          ? dto.discountPct
          : pack.discountPct != null
            ? Number(pack.discountPct)
            : null;
      if (pricingMode === PackPricingMode.DISCOUNT && discountPct == null) {
        throw new BadRequestException('discountPct required for discount packs');
      }

      const data: Prisma.MembershipPackUpdateInput = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.sessions !== undefined) data.sessions = dto.sessions;
      if (dto.price !== undefined) data.price = new Prisma.Decimal(dto.price);
      if (dto.validityDays !== undefined) data.validityDays = dto.validityDays;
      if (dto.expiryMode !== undefined) data.expiryMode = dto.expiryMode;
      if (dto.pricingMode !== undefined) data.pricingMode = dto.pricingMode;
      if (dto.discountPct !== undefined) {
        data.discountPct =
          dto.discountPct != null ? new Prisma.Decimal(dto.discountPct) : null;
      }
      if (dto.flatRate !== undefined) {
        data.flatRate =
          dto.flatRate != null ? new Prisma.Decimal(dto.flatRate) : null;
      }
      if (dto.venueIds !== undefined) data.venueIds = dto.venueIds;
      if (dto.unitIds !== undefined) data.unitIds = dto.unitIds;

      return tx.membershipPack.update({ where: { id: packId }, data });
    });
  }

  /**
   * Soft-deactivate a pack (owner/staff, tenant-scoped). Packs are referenced
   * by purchased ledger sessions, so we NEVER hard-delete — flipping `active`
   * hides it from the owner purchase list while keeping existing balances and
   * booking redemptions valid.
   */
  deactivatePack(user: RequestUser, packId: string) {
    const ownerId = user.ownerId!;
    return this.prisma.withTenant(async (tx) => {
      // Explicit owner scoping (defense-in-depth): superuser dev connection
      // bypasses RLS, so scope the lookup on the denormalised ownerId and 404
      // if the pack belongs to another tenant before soft-deactivating.
      const pack = await tx.membershipPack.findFirst({
        where: { id: packId, ownerId },
      });
      if (!pack) throw new NotFoundException('Pack not found');
      return tx.membershipPack.update({
        where: { id: packId },
        data: { active: false },
      });
    });
  }

  listPacks(user: RequestUser) {
    return this.prisma.withTenant((tx) =>
      tx.membershipPack.findMany({ where: { active: true } }),
    );
  }

  /** Customer-facing: active packs offered by a given owner. */
  listPacksForOwner(ownerId: string) {
    return this.prisma.withTenantId(ownerId, (tx) =>
      tx.membershipPack.findMany({ where: { active: true } }),
    );
  }

  /**
   * Customer buys a pack → pay the pack PRICE via Razorpay, then credit the
   * ledger with sessions (PRD §6.3, §7). Crediting is gated behind a verified
   * payment: in production a real verified Razorpay handshake is required; in
   * dev/test the mock order self-verifies so flows stay exercisable.
   */
  async purchase(
    ownerId: string,
    customerId: string,
    packId: string,
    payment?: {
      razorpayOrderId?: string;
      razorpayPaymentId?: string;
      razorpaySignature?: string;
    },
  ) {
    const isProduction = process.env.NODE_ENV === 'production';
    const payments = this.payments;
    if (!payments) {
      // PaymentService must be wired for paid pack purchases.
      throw new BadRequestException('Payment service unavailable');
    }

    return this.prisma.withTenantId(ownerId, async (tx) => {
      // Owner scoping (defense-in-depth, mirrors SEC-4 in evaluatePack): the dev
      // DB connects as a superuser that BYPASSES RLS, and `ownerId` here comes
      // from a customer-supplied URL param, so a findUnique({ id }) would let a
      // customer buy another tenant's pack into a mismatched tenant context.
      // MembershipPack carries a denormalised ownerId — scope on it.
      const pack = await tx.membershipPack.findFirst({
        where: { id: packId, ownerId },
      });
      if (!pack || !pack.active) throw new NotFoundException('Pack not found');

      // 1) Create (or reuse) a Razorpay order for the pack PRICE.
      const receipt = `pack_${packId}_${customerId}`;
      const order = await payments.createOrder(Number(pack.price), receipt);
      const orderId = payment?.razorpayOrderId ?? order.id;

      // 2) Verify the payment BEFORE crediting any sessions. Track the effective
      // gateway payment id that was verified — real handshake in production, the
      // deterministic mock id in dev/test — so we can dedupe replays on it.
      let verified = false;
      let gatewayPaymentId: string | undefined;
      if (payment?.razorpayPaymentId && payment?.razorpaySignature) {
        verified = payments.verifyPaymentSignature(
          orderId,
          payment.razorpayPaymentId,
          payment.razorpaySignature,
        );
        gatewayPaymentId = payment.razorpayPaymentId;
      } else if (!isProduction) {
        // Dev/test: the deterministic mock order is treated as paid so existing
        // flows (no real handshake) keep working without network.
        const mockPaymentId = `pay_mock_${packId}`;
        verified = payments.verifyPaymentSignature(order.id, mockPaymentId, '');
        gatewayPaymentId = mockPaymentId;
      }

      if (!verified) {
        throw new BadRequestException(
          'Pack payment not verified; cannot credit sessions',
        );
      }

      // 3) Idempotency (SEC-1): replaying the same valid handshake must NOT
      // double-credit. Without a schema migration we have no dedicated payment-id
      // column, so we record the gateway payment id in the PACK_BUY ledger row's
      // `refId` (the packId it previously held is redundant — the lane already
      // encodes it as `pack:<packId>`) and query it back here. If a PACK_BUY for
      // this customer on this pack lane already recorded this payment id, short-
      // circuit and return the EXISTING balance instead of crediting again.
      //
      // Residual risk for the schema batch: dedupe is best-effort on a reused
      // `refId` field rather than a unique constraint, so it is not enforced at
      // the DB level and a synthetic dev mock id (`pay_mock_<packId>`) is
      // constant per pack — meaning a second dev purchase of the same pack is
      // (correctly) treated as a replay. A dedicated `gatewayPaymentId` column
      // with a unique index should replace this once migrations are in scope.
      if (gatewayPaymentId) {
        const existing = await tx.ledgerTxn.findFirst({
          where: {
            customerId,
            lane: packLane(packId),
            type: LedgerTxnType.PACK_BUY,
            refId: gatewayPaymentId,
          },
          orderBy: { createdAt: 'desc' },
        });
        if (existing) {
          const balance = await this.ledger.balance(
            tx,
            customerId,
            packLane(packId),
          );
          return {
            packId,
            sessionsAdded: 0,
            balance: Number(balance),
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
          };
        }
      }

      // 4) Payment verified and not a replay → credit the sessions. Store the
      // gateway payment id in `refId` so subsequent replays are deduped above.
      const balanceAfter = await this.ledger.post(tx, {
        ownerId,
        customerId,
        type: LedgerTxnType.PACK_BUY,
        amount: pack.sessions,
        lane: packLane(packId),
        refType: 'pack',
        refId: gatewayPaymentId ?? packId,
        note: `Bought ${pack.name} (${pack.sessions} sessions)`,
      });
      return {
        packId,
        sessionsAdded: pack.sessions,
        balance: Number(balanceAfter),
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
      };
    });
  }

  /**
   * Compute how a pack applies to a slot subtotal and validate scope/balance.
   * Called inside the booking transaction. Does NOT debit — the caller debits
   * once the booking is committed (so cancellation can refund).
   */
  async evaluatePack(
    ownerId: string,
    customerId: string,
    packId: string,
    tx: Prisma.TransactionClient,
    venueId: string,
    unitIds: string[],
    slotCount: number,
    slotSubtotal: Prisma.Decimal,
  ): Promise<PackApplication> {
    // Tenant scoping (SEC-4): the dev DB connects as a superuser that BYPASSES
    // RLS, so a findUnique({ id }) here would let another tenant's pack fund a
    // booking. MembershipPack carries a denormalised ownerId — scope on it and
    // 404 if the pack belongs to another owner.
    const pack = await tx.membershipPack.findFirst({
      where: { id: packId, ownerId },
    });
    if (!pack || !pack.active) throw new NotFoundException('Pack not found');

    // scope check (PRD §4.4): empty arrays = all venues/units
    if (pack.venueIds.length && !pack.venueIds.includes(venueId)) {
      throw new BadRequestException('Pack not valid at this venue');
    }
    if (pack.unitIds.length && !unitIds.every((u) => pack.unitIds.includes(u))) {
      throw new BadRequestException('Pack not valid for these courts');
    }

    // Expiry enforcement (PRD §4.4): packs with a validity window forfeit
    // sessions once expired. ROLLOVER / NONE never time-expire.
    if (
      pack.validityDays != null &&
      pack.expiryMode === PackExpiryMode.FORFEIT
    ) {
      const lastBuy = await tx.ledgerTxn.findFirst({
        where: {
          customerId,
          lane: packLane(packId),
          type: LedgerTxnType.PACK_BUY,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (lastBuy) {
        const expiresAt = new Date(lastBuy.createdAt);
        expiresAt.setDate(expiresAt.getDate() + pack.validityDays);
        if (expiresAt.getTime() <= Date.now()) {
          throw new BadRequestException('Pack sessions have expired');
        }
      }
    }

    const balance = await this.ledger.balance(tx, customerId, packLane(packId));
    if (balance.lessThan(slotCount)) {
      throw new BadRequestException('Not enough pack sessions');
    }

    let discount: Prisma.Decimal;
    if (pack.pricingMode === PackPricingMode.FLAT) {
      // Flat-rate pack covers the configured flatRate per session, capped at the
      // actual slot subtotal. A null flatRate keeps the legacy "covers all"
      // behaviour so dynamic price is fully absorbed.
      if (pack.flatRate != null) {
        const covered = pack.flatRate.mul(slotCount);
        discount = covered.lessThan(slotSubtotal) ? covered : slotSubtotal;
      } else {
        discount = slotSubtotal;
      }
    } else {
      const pct = pack.discountPct ?? new Prisma.Decimal(0);
      // Round the percent-discount intermediate to 2dp (currency precision) so
      // the rupee discount matches the @db.Decimal(12,2) ledger/amount columns.
      discount = slotSubtotal
        .mul(pct)
        .div(100)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    }
    return { discount, sessions: slotCount };
  }

  /** Debit pack sessions for a committed booking. */
  debitSessions(
    tx: Prisma.TransactionClient,
    ownerId: string,
    customerId: string,
    packId: string,
    sessions: number,
    bookingId: string,
  ) {
    return this.ledger.post(tx, {
      ownerId,
      customerId,
      type: LedgerTxnType.PACK_DEBIT,
      amount: -sessions,
      lane: packLane(packId),
      refType: 'booking',
      refId: bookingId,
      note: `Debited ${sessions} session(s)`,
    });
  }

  /** Cancellation returns the session credit, not cash (PRD §4.4, §6.3). */
  refundSessions(
    tx: Prisma.TransactionClient,
    ownerId: string,
    customerId: string,
    packId: string,
    sessions: number,
    bookingId: string,
  ) {
    return this.ledger.post(tx, {
      ownerId,
      customerId,
      type: LedgerTxnType.PACK_REFUND,
      amount: sessions,
      lane: packLane(packId),
      refType: 'booking',
      refId: bookingId,
      note: `Refunded ${sessions} session(s) on cancellation`,
    });
  }
}
