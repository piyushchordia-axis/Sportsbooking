import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LedgerTxnType } from '@sportsbooking/shared';
import { eq } from 'drizzle-orm';
import type { DbTx } from '../../db';
import { Decimal, dec } from '../../db/money';
import { owners, venueSettings } from '../../db/schema';
import { LedgerService } from '../ledger/ledger.service';

/**
 * Lane name PREFIXES for the points and credit ledger lanes. The actual lane
 * stored on each row is namespaced PER OWNER (SEC-5): `points:<ownerId>` and
 * `credit:<ownerId>`. The bare prefixes are exported so other modules (and the
 * wallet aggregation) can detect/derive these lanes via `startsWith`.
 */
export const POINTS_LANE = 'points';
export const CREDIT_LANE = 'credit';

/** Per-owner points lane (SEC-5): keeps each owner's points balance separate. */
export function pointsLane(ownerId: string): string {
  return `${POINTS_LANE}:${ownerId}`;
}

/** Per-owner credit lane (SEC-5): keeps each owner's credit balance separate. */
export function creditLane(ownerId: string): string {
  return `${CREDIT_LANE}:${ownerId}`;
}

/**
 * Loyalty points (PRD §4.5): earned per spend, redeemable as booking credit
 * from the same append-only ledger. Earn rate & redeem value start from a
 * platform default and are owner-overridable (and venue-overridable).
 *
 * SEC-5: points and credit balances are namespaced PER OWNER so a customer
 * cannot earn at owner A and spend at owner B.
 */
@Injectable()
export class LoyaltyService {
  private readonly defaultEarnRate: number;
  private readonly defaultRedeemValue: number;

  constructor(
    config: ConfigService,
    private readonly ledger: LedgerService,
  ) {
    this.defaultEarnRate = Number(config.get('DEFAULT_LOYALTY_EARN_RATE', 0.05));
    this.defaultRedeemValue = Number(config.get('DEFAULT_LOYALTY_REDEEM_VALUE', 1));
  }

  /** Points balance for a customer ON A GIVEN OWNER (per-owner lane). */
  pointsBalance(tx: DbTx, ownerId: string, customerId: string) {
    return this.ledger.balance(tx, customerId, pointsLane(ownerId));
  }

  /** Credit balance for a customer ON A GIVEN OWNER (per-owner lane). */
  creditBalance(tx: DbTx, ownerId: string, customerId: string) {
    return this.ledger.balance(tx, customerId, creditLane(ownerId));
  }

  /**
   * Resolve the effective earn rate for a (owner, venue): the per-venue
   * VenueSettings override wins, then the owner-level rate, then the platform
   * default. `venueId` is optional so legacy callers keep working.
   */
  private async resolveEarnRate(
    tx: DbTx,
    ownerId: string,
    venueId?: string,
  ): Promise<number> {
    if (venueId) {
      const settings = await tx.query.venueSettings.findFirst({
        where: eq(venueSettings.venueId, venueId),
      });
      if (settings?.loyaltyEarnRate != null) {
        return Number(settings.loyaltyEarnRate);
      }
    }
    const owner = await tx.query.owners.findFirst({
      where: eq(owners.id, ownerId),
    });
    return owner?.loyaltyEarnRate
      ? Number(owner.loyaltyEarnRate)
      : this.defaultEarnRate;
  }

  /**
   * Resolve the effective redeem value for a (owner, venue) with the same
   * precedence as the earn rate.
   */
  private async resolveRedeemValue(
    tx: DbTx,
    ownerId: string,
    venueId?: string,
  ): Promise<number> {
    if (venueId) {
      const settings = await tx.query.venueSettings.findFirst({
        where: eq(venueSettings.venueId, venueId),
      });
      if (settings?.loyaltyRedeemValue != null) {
        return Number(settings.loyaltyRedeemValue);
      }
    }
    const owner = await tx.query.owners.findFirst({
      where: eq(owners.id, ownerId),
    });
    return owner?.loyaltyRedeemValue
      ? Number(owner.loyaltyRedeemValue)
      : this.defaultRedeemValue;
  }

  /**
   * Effective redeem value (rupees per point) for a (owner, venue), honouring
   * the per-venue override. Used by the checkout quote to cap points-to-cash.
   */
  redeemValueFor(
    tx: DbTx,
    ownerId: string,
    venueId?: string,
  ): Promise<number> {
    return this.resolveRedeemValue(tx, ownerId, venueId);
  }

  /** Earn points on a settled cash spend (called when a booking is paid). */
  async earn(
    tx: DbTx,
    ownerId: string,
    customerId: string,
    cashSpend: Decimal,
    bookingId: string,
    venueId?: string,
  ): Promise<void> {
    const rate = await this.resolveEarnRate(tx, ownerId, venueId);
    const points = Math.floor(Number(cashSpend) * rate);
    if (points <= 0) return;
    await this.ledger.post(tx, {
      ownerId,
      customerId,
      type: LedgerTxnType.POINTS_EARN,
      amount: points,
      lane: pointsLane(ownerId),
      refType: 'booking',
      refId: bookingId,
      note: `Earned ${points} pts on ₹${cashSpend}`,
    });
  }

  /**
   * Redeem points into a cash discount (debits points at booking time).
   * Returns the rupee value applied. Caller caps `points` to what's needed.
   */
  async redeem(
    tx: DbTx,
    ownerId: string,
    customerId: string,
    points: number,
    bookingId: string,
    venueId?: string,
  ): Promise<Decimal> {
    if (points <= 0) return dec(0);
    const redeemValue = await this.resolveRedeemValue(tx, ownerId, venueId);
    await this.ledger.post(tx, {
      ownerId,
      customerId,
      type: LedgerTxnType.POINTS_REDEEM,
      amount: -points, // throws on overdraft via LedgerService
      lane: pointsLane(ownerId),
      refType: 'booking',
      refId: bookingId,
      note: `Redeemed ${points} pts`,
    });
    return dec(points).mul(redeemValue);
  }

  /**
   * Return a rupee amount to the customer's redeemable credit lane (e.g. on
   * cancellation of a booking that had redeemed points). Not cash (PRD §4.4).
   */
  async creditRefund(
    tx: DbTx,
    ownerId: string,
    customerId: string,
    amount: Decimal,
    bookingId: string,
  ): Promise<void> {
    if (!amount.greaterThan(0)) return;
    await this.ledger.post(tx, {
      ownerId,
      customerId,
      type: LedgerTxnType.CASH_REFUND,
      amount,
      lane: creditLane(ownerId),
      refType: 'booking',
      refId: bookingId,
      note: 'Refund to credit on cancellation',
    });
  }
}
