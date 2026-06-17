import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { LedgerTxnType } from '@sportsbooking/shared';
import { LedgerService } from '../ledger/ledger.service';

export const POINTS_LANE = 'points';
export const CREDIT_LANE = 'credit';

/**
 * Loyalty points (PRD §4.5): earned per spend, redeemable as booking credit
 * from the same append-only ledger. Earn rate & redeem value start from a
 * platform default and are owner-overridable (and venue-overridable).
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

  /** Points balance for a customer (single global points lane). */
  pointsBalance(tx: Prisma.TransactionClient, customerId: string) {
    return this.ledger.balance(tx, customerId, POINTS_LANE);
  }

  creditBalance(tx: Prisma.TransactionClient, customerId: string) {
    return this.ledger.balance(tx, customerId, CREDIT_LANE);
  }

  /** Earn points on a settled cash spend (called when a booking is paid). */
  async earn(
    tx: Prisma.TransactionClient,
    ownerId: string,
    customerId: string,
    cashSpend: Prisma.Decimal,
    bookingId: string,
  ): Promise<void> {
    const owner = await tx.owner.findUnique({ where: { id: ownerId } });
    const rate = owner?.loyaltyEarnRate
      ? Number(owner.loyaltyEarnRate)
      : this.defaultEarnRate;
    const points = Math.floor(Number(cashSpend) * rate);
    if (points <= 0) return;
    await this.ledger.post(tx, {
      ownerId,
      customerId,
      type: LedgerTxnType.POINTS_EARN,
      amount: points,
      lane: POINTS_LANE,
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
    tx: Prisma.TransactionClient,
    ownerId: string,
    customerId: string,
    points: number,
    bookingId: string,
  ): Promise<Prisma.Decimal> {
    if (points <= 0) return new Prisma.Decimal(0);
    const owner = await tx.owner.findUnique({ where: { id: ownerId } });
    const redeemValue = owner?.loyaltyRedeemValue
      ? Number(owner.loyaltyRedeemValue)
      : this.defaultRedeemValue;
    await this.ledger.post(tx, {
      ownerId,
      customerId,
      type: LedgerTxnType.POINTS_REDEEM,
      amount: -points, // throws on overdraft via LedgerService
      lane: POINTS_LANE,
      refType: 'booking',
      refId: bookingId,
      note: `Redeemed ${points} pts`,
    });
    return new Prisma.Decimal(points).mul(redeemValue);
  }

  /**
   * Return a rupee amount to the customer's redeemable credit lane (e.g. on
   * cancellation of a booking that had redeemed points). Not cash (PRD §4.4).
   */
  async creditRefund(
    tx: Prisma.TransactionClient,
    ownerId: string,
    customerId: string,
    amount: Prisma.Decimal,
    bookingId: string,
  ): Promise<void> {
    if (!amount.greaterThan(0)) return;
    await this.ledger.post(tx, {
      ownerId,
      customerId,
      type: LedgerTxnType.CASH_REFUND,
      amount,
      lane: CREDIT_LANE,
      refType: 'booking',
      refId: bookingId,
      note: 'Refund to credit on cancellation',
    });
  }
}
