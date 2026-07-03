import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  LedgerTxnType,
  type OwnedPack,
  PackExpiryMode,
  PackPricingMode,
} from '@sportsbooking/shared';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentService } from '../payments/payment.service';
import { DbService } from '../../db/db.service';
import type { DbTx } from '../../db';
import { Decimal, dec, money } from '../../db/money';
import {
  ledgerTxns,
  membershipPacks,
  ownerCustomers,
  playerProfiles,
  users,
} from '../../db/schema';
import { CreatePackDto, UpdatePackDto } from './dto';

export function packLane(packId: string): string {
  return `pack:${packId}`;
}

/**
 * Pure expiry-mode decision (PRD §4.4). Given a pack's expiry mode, its
 * validity window and the purchase timestamp, decide whether sessions on that
 * pack lane are time-expired as of `now`.
 *
 * - NONE / ROLLOVER: sessions never time-expire (validityDays ignored).
 * - FORFEIT: sessions are expired once `now` is at/after purchasedAt +
 *   validityDays. A null validityDays means "no window" → never expires.
 */
export function isPackExpired(
  expiryMode: PackExpiryMode | string,
  validityDays: number | null | undefined,
  purchasedAt: Date,
  now: Date = new Date(),
): boolean {
  if (expiryMode !== PackExpiryMode.FORFEIT) return false;
  if (validityDays == null) return false;
  const expiresAt = new Date(purchasedAt);
  expiresAt.setDate(expiresAt.getDate() + validityDays);
  return expiresAt.getTime() <= now.getTime();
}

export interface PackApplication {
  /** rupee value the pack covers/discounts on the slot subtotal */
  discount: Decimal;
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
    private readonly db: DbService,
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
    return this.db.withTenant(
      async (tx) =>
        (
          await tx
            .insert(membershipPacks)
            .values({
              id: randomUUID(),
              ownerId,
              name: dto.name,
              sessions: dto.sessions,
              price: money(dec(dto.price)),
              validityDays: dto.validityDays,
              expiryMode: dto.expiryMode,
              pricingMode: dto.pricingMode,
              discountPct:
                dto.discountPct != null ? money(dec(dto.discountPct)) : null,
              flatRate:
                dto.flatRate != null ? money(dec(dto.flatRate)) : null,
              venueIds: dto.venueIds ?? [],
              unitIds: dto.unitIds ?? [],
              // Omit when undefined so the schema default (true) applies.
              ...(dto.active !== undefined ? { active: dto.active } : {}),
            })
            .returning()
        )[0],
    );
  }

  /**
   * Update a pack definition (owner/staff, tenant-scoped). Only mutable
   * catalogue fields change — purchased ledger sessions reference the pack by
   * id and stay intact. Validates pricing-mode invariants on the merged result.
   */
  updatePack(user: RequestUser, packId: string, dto: UpdatePackDto) {
    const ownerId = user.ownerId!;
    return this.db.withTenant(async (tx) => {
      // Explicit owner scoping (defense-in-depth): the dev DATABASE_URL connects
      // as a superuser that BYPASSES RLS, so a findUnique({ id }) here would let
      // an owner mutate another tenant's pack. MembershipPack carries a
      // denormalised ownerId — scope on it and 404 if not owned.
      const pack = await tx.query.membershipPacks.findFirst({
        where: and(
          eq(membershipPacks.id, packId),
          eq(membershipPacks.ownerId, ownerId),
        ),
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

      const data: Partial<typeof membershipPacks.$inferInsert> = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.sessions !== undefined) data.sessions = dto.sessions;
      if (dto.price !== undefined) data.price = money(dec(dto.price));
      if (dto.validityDays !== undefined) data.validityDays = dto.validityDays;
      if (dto.expiryMode !== undefined) data.expiryMode = dto.expiryMode;
      if (dto.pricingMode !== undefined) data.pricingMode = dto.pricingMode;
      if (dto.discountPct !== undefined) {
        data.discountPct =
          dto.discountPct != null ? money(dec(dto.discountPct)) : null;
      }
      if (dto.flatRate !== undefined) {
        data.flatRate =
          dto.flatRate != null ? money(dec(dto.flatRate)) : null;
      }
      if (dto.venueIds !== undefined) data.venueIds = dto.venueIds;
      if (dto.unitIds !== undefined) data.unitIds = dto.unitIds;
      if (dto.active !== undefined) data.active = dto.active;

      return (
        await tx
          .update(membershipPacks)
          .set(data)
          .where(eq(membershipPacks.id, packId))
          .returning()
      )[0];
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
    return this.db.withTenant(async (tx) => {
      // Explicit owner scoping (defense-in-depth): superuser dev connection
      // bypasses RLS, so scope the lookup on the denormalised ownerId and 404
      // if the pack belongs to another tenant before soft-deactivating.
      const pack = await tx.query.membershipPacks.findFirst({
        where: and(
          eq(membershipPacks.id, packId),
          eq(membershipPacks.ownerId, ownerId),
        ),
      });
      if (!pack) throw new NotFoundException('Pack not found');
      return (
        await tx
          .update(membershipPacks)
          .set({ active: false })
          .where(eq(membershipPacks.id, packId))
          .returning()
      )[0];
    });
  }

  /**
   * Owner-facing management list: returns ALL packs (active AND inactive). The
   * owner must see deactivated packs to re-activate them — `deletePack` only
   * flips `active=false` (packs are never hard-deleted because customers may
   * hold session balances), so filtering by active here would strand them with
   * no way back. Active packs sort first, newest within each group. The
   * customer-facing purchase lists (listPacksForOwner / wallet) stay active-only.
   */
  listPacks(user: RequestUser) {
    return this.db.withTenant((tx) =>
      tx.query.membershipPacks.findMany({
        orderBy: [desc(membershipPacks.active), desc(membershipPacks.createdAt)],
      }),
    );
  }

  /** Customer-facing: active packs offered by a given owner. */
  listPacksForOwner(ownerId: string) {
    return this.db.withTenantId(ownerId, (tx) =>
      tx.query.membershipPacks.findMany({
        where: eq(membershipPacks.active, true),
      }),
    );
  }

  /**
   * Customer-facing: the packs THIS customer actually OWNS with an owner — the
   * active packs they still hold a positive, non-expired session balance on,
   * with the scope metadata the booking UI needs. Drives the "Use pack" picker
   * so customers only ever see packs they can actually redeem (the previous UI
   * listed the whole sale catalogue). Lazily forfeits expired FORFEIT packs —
   * same read-path model as evaluatePack — so a pack past its window never
   * shows as usable.
   */
  async listOwnedPacks(
    ownerId: string,
    customerId: string,
  ): Promise<OwnedPack[]> {
    return this.db.withTenantId(ownerId, async (tx) => {
      const packs = await tx.query.membershipPacks.findMany({
        where: and(
          eq(membershipPacks.ownerId, ownerId),
          eq(membershipPacks.active, true),
        ),
      });
      const owned: OwnedPack[] = [];
      for (const pack of packs) {
        // Realise expiry before reading the spendable balance so forfeited
        // sessions don't surface as owned.
        const expired = await this.resolvePackExpiry(
          tx,
          ownerId,
          customerId,
          pack,
        );
        if (expired) continue;
        const balance = await this.ledger.balance(
          tx,
          customerId,
          packLane(pack.id),
        );
        if (!balance.greaterThan(0)) continue;
        owned.push({
          id: pack.id,
          name: pack.name,
          sessions: pack.sessions,
          balance: balance.toNumber(),
          pricingMode: pack.pricingMode,
          discountPct: pack.discountPct != null ? Number(pack.discountPct) : null,
          venueIds: pack.venueIds ?? [],
          unitIds: pack.unitIds ?? [],
        });
      }
      return owned;
    });
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

    // 1) Resolve the Razorpay order (network call) BEFORE the tx so the gateway
    // call doesn't hold the DB connection open (PERF, mirrors cancel()'s
    // refund-before-tx pattern). We need the pack PRICE for the order amount, so
    // do an RLS-bypass read here for that value only — the in-tx scoped fetch
    // below remains the authoritative owner-scope/active check before crediting.
    const packForOrder = await this.db.withTenantBypass((tx) =>
      tx.query.membershipPacks.findFirst({
        where: and(
          eq(membershipPacks.id, packId),
          eq(membershipPacks.ownerId, ownerId),
        ),
      }),
    );
    if (!packForOrder || !packForOrder.active)
      throw new NotFoundException('Pack not found');
    const receipt = `pack_${packId}_${customerId}`;
    const order = await payments.createOrder(Number(packForOrder.price), receipt);

    return this.db.withTenantId(ownerId, async (tx) => {
      // Serialize concurrent confirms for this customer + pack lane BEFORE the
      // dedup SELECT below (SEC-1 / TOCTOU fix). The advisory lock inside
      // ledger.post() only fires AFTER the dedup read, so without this two
      // concurrent confirms with the same gatewayPaymentId would both pass the
      // dedup check and both credit sessions (double credit). Taking the lock
      // here — same key convention as ledger.service.ts — makes the second
      // confirm wait for the first to commit, so it sees the first's PACK_BUY
      // and dedups. The lock is xact-scoped and released on commit/rollback.
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtext(${customerId} || ':' || ${packLane(packId)})
        )
      `);

      // Owner scoping (defense-in-depth, mirrors SEC-4 in evaluatePack): the dev
      // DB connects as a superuser that BYPASSES RLS, and `ownerId` here comes
      // from a customer-supplied URL param, so a findUnique({ id }) would let a
      // customer buy another tenant's pack into a mismatched tenant context.
      // MembershipPack carries a denormalised ownerId — scope on it.
      const pack = await tx.query.membershipPacks.findFirst({
        where: and(
          eq(membershipPacks.id, packId),
          eq(membershipPacks.ownerId, ownerId),
        ),
      });
      if (!pack || !pack.active) throw new NotFoundException('Pack not found');

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
        const existing = await tx.query.ledgerTxns.findFirst({
          where: and(
            eq(ledgerTxns.customerId, customerId),
            eq(ledgerTxns.lane, packLane(packId)),
            eq(ledgerTxns.type, LedgerTxnType.PACK_BUY),
            eq(ledgerTxns.refId, gatewayPaymentId),
          ),
          orderBy: desc(ledgerTxns.createdAt),
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

      // 4) Roll-forward / expiry settlement on the existing lane balance before
      // the new credit lands (PRD §4.4):
      //  - ROLLOVER: unused sessions are NEVER forfeited; re-buying the same
      //    scope simply carries the prior balance forward (the ledger is
      //    additive on the lane) and resets the validity clock to this PACK_BUY.
      //  - FORFEIT: settle any already-expired prior window first, so stale
      //    sessions are forfeited (and ledger-recorded) rather than silently
      //    riding on top of the fresh credit.
      //  - NONE: nothing to settle.
      // resolvePackExpiry is a no-op for ROLLOVER/NONE and idempotent for
      // FORFEIT, so calling it unconditionally is safe.
      await this.resolvePackExpiry(tx, ownerId, customerId, pack);

      // 5) Payment verified and not a replay → credit the sessions. Store the
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

      // 6) Pack-purchase player capture into the owner CRM (PRD §4.9).
      await this.capturePlayer(tx, ownerId, customerId);
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
    tx: DbTx,
    venueId: string,
    unitIds: string[],
    slotCount: number,
    slotSubtotal: Decimal,
  ): Promise<PackApplication> {
    // Tenant scoping (SEC-4): the dev DB connects as a superuser that BYPASSES
    // RLS, so a findUnique({ id }) here would let another tenant's pack fund a
    // booking. MembershipPack carries a denormalised ownerId — scope on it and
    // 404 if the pack belongs to another owner.
    const pack = await tx.query.membershipPacks.findFirst({
      where: and(
        eq(membershipPacks.id, packId),
        eq(membershipPacks.ownerId, ownerId),
      ),
    });
    if (!pack || !pack.active) throw new NotFoundException('Pack not found');

    // scope check (PRD §4.4): empty arrays = all venues/units
    const packVenueIds = pack.venueIds ?? [];
    const packUnitIds = pack.unitIds ?? [];
    if (packVenueIds.length && !packVenueIds.includes(venueId)) {
      throw new BadRequestException('Pack not valid at this venue');
    }
    if (packUnitIds.length && !unitIds.every((u) => packUnitIds.includes(u))) {
      throw new BadRequestException('Pack not valid for these courts');
    }

    // Expiry enforcement (PRD §4.4): resolve the pack lane first so FORFEIT
    // packs past their window are forfeited (and ledger-recorded) before we
    // read the spendable balance. ROLLOVER / NONE never time-expire.
    const expired = await this.resolvePackExpiry(
      tx,
      ownerId,
      customerId,
      pack,
    );
    if (expired) {
      throw new BadRequestException('Pack sessions have expired');
    }

    const balance = await this.ledger.balance(tx, customerId, packLane(packId));
    if (balance.lessThan(slotCount)) {
      throw new BadRequestException('Not enough pack sessions');
    }

    let discount: Decimal;
    if (pack.pricingMode === PackPricingMode.FLAT) {
      // Flat-rate pack covers the configured flatRate per session, capped at the
      // actual slot subtotal. A null flatRate keeps the legacy "covers all"
      // behaviour so dynamic price is fully absorbed.
      if (pack.flatRate != null) {
        const covered = dec(pack.flatRate).mul(slotCount);
        discount = covered.lessThan(slotSubtotal) ? covered : slotSubtotal;
      } else {
        discount = slotSubtotal;
      }
    } else {
      const pct = pack.discountPct != null ? dec(pack.discountPct) : dec(0);
      // Round the percent-discount intermediate to 2dp (currency precision) so
      // the rupee discount matches the @db.Decimal(12,2) ledger/amount columns.
      discount = slotSubtotal
        .mul(pct)
        .div(100)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    }
    return { discount, sessions: slotCount };
  }

  /** Debit pack sessions for a committed booking. */
  debitSessions(
    tx: DbTx,
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
    tx: DbTx,
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

  /**
   * Resolve a pack lane's expiry (PRD §4.4) and return whether sessions are
   * currently expired/unusable. For FORFEIT packs past their validity window
   * with a remaining balance, this forfeits the balance by appending a
   * `pack_expire` ledger entry on the lane (append-only; mirrors ledger.post).
   *
   * Idempotent: the forfeiture is keyed (refId) on the funding PACK_BUY row, so
   * a second resolution of the same expired lane finds the existing PACK_EXPIRE
   * row and never double-posts. NONE / ROLLOVER never time-expire.
   */
  private async resolvePackExpiry(
    tx: DbTx,
    ownerId: string,
    customerId: string,
    pack: typeof membershipPacks.$inferSelect,
  ): Promise<boolean> {
    const lane = packLane(pack.id);
    const lastBuy = await tx.query.ledgerTxns.findFirst({
      where: and(
        eq(ledgerTxns.customerId, customerId),
        eq(ledgerTxns.lane, lane),
        eq(ledgerTxns.type, LedgerTxnType.PACK_BUY),
      ),
      orderBy: desc(ledgerTxns.createdAt),
    });
    if (!lastBuy) return false;

    if (
      !isPackExpired(
        pack.expiryMode,
        pack.validityDays,
        new Date(lastBuy.createdAt),
      )
    ) {
      return false;
    }

    // Expired. Forfeit any remaining balance into the ledger exactly once.
    // Idempotency: refId = the funding PACK_BUY id. If a PACK_EXPIRE already
    // exists for this purchase, the forfeiture was already recorded.
    const alreadyForfeited = await tx.query.ledgerTxns.findFirst({
      where: and(
        eq(ledgerTxns.customerId, customerId),
        eq(ledgerTxns.lane, lane),
        eq(ledgerTxns.type, LedgerTxnType.PACK_EXPIRE),
        eq(ledgerTxns.refId, lastBuy.id),
      ),
    });
    if (!alreadyForfeited) {
      const balance = await this.ledger.balance(tx, customerId, lane);
      if (balance.greaterThan(0)) {
        await this.ledger.post(tx, {
          ownerId,
          customerId,
          type: LedgerTxnType.PACK_EXPIRE,
          amount: balance.negated(),
          lane,
          refType: 'pack',
          refId: lastBuy.id,
          note: `Forfeited ${balance} expired session(s)`,
        });
      }
    }
    return true;
  }

  /**
   * Capture a pack purchaser into the owner CRM (PRD §4.9). Mirrors
   * bookings.service.capturePlayer: upsert ownerCustomers (firstSeen kept,
   * lastVisit + bookingCount advanced) and ensure a playerProfiles row exists.
   */
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
}
