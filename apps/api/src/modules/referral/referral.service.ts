import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  LedgerTxnType,
  PaymentStatus,
  ReferralStatus,
} from '@sportsbooking/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { DbTx } from '../../db';
import { bookings, owners, referrals } from '../../db/schema';
import { dec } from '../../db/money';
import { LedgerService } from '../ledger/ledger.service';
import { creditLane } from '../loyalty/loyalty.service';

/**
 * Referral programme (PRD §4.5). Each player gets a per-owner referral code;
 * the reward credit is released to the referrer only after the referred
 * player's FIRST PAID booking. Reward lands in the referrer's PER-OWNER
 * redeemable credit lane (SEC-5) for this referral's owner.
 */
@Injectable()
export class ReferralService {
  constructor(private readonly ledger: LedgerService) {}

  private generateCode(): string {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  /** Get or create the caller's referral code for a given owner. */
  async myCode(
    tx: DbTx,
    ownerId: string,
    referrerId: string,
  ): Promise<string> {
    const existing = await tx.query.referrals.findFirst({
      where: and(
        eq(referrals.ownerId, ownerId),
        eq(referrals.referrerId, referrerId),
        isNull(referrals.refereeId),
      ),
    });
    if (existing) return existing.code;
    let code = this.generateCode();
    // avoid collision on the (ownerId, code) unique constraint
    while (
      await tx.query.referrals.findFirst({
        where: and(eq(referrals.ownerId, ownerId), eq(referrals.code, code)),
      })
    ) {
      code = this.generateCode();
    }
    await tx.insert(referrals).values({
      id: randomUUID(),
      ownerId,
      referrerId,
      code,
      status: ReferralStatus.PENDING,
    });
    return code;
  }

  /** A new player applies a code → links them as the referee (still pending). */
  async apply(
    tx: DbTx,
    ownerId: string,
    code: string,
    refereeId: string,
  ): Promise<void> {
    const ref = await tx.query.referrals.findFirst({
      where: and(
        eq(referrals.ownerId, ownerId),
        eq(referrals.code, code),
        eq(referrals.status, ReferralStatus.PENDING),
      ),
    });
    if (!ref) throw new NotFoundException('Invalid referral code');
    if (ref.referrerId === refereeId) return; // no self-referral

    // Dedupe on the (ownerId, referrerId, refereeId) triple: if this referee
    // has already been linked to this referrer for this owner, do not create a
    // duplicate row — return the existing link instead. (Tenant-scoped by
    // ownerId.)
    const existing = await tx.query.referrals.findFirst({
      where: and(
        eq(referrals.ownerId, ownerId),
        eq(referrals.referrerId, ref.referrerId),
        eq(referrals.refereeId, refereeId),
      ),
    });
    if (existing) return;

    // Reject if the referee is not actually a new customer: they already have a
    // paid (or settled-at-venue) booking with this owner.
    const paidBooking = await tx.query.bookings.findFirst({
      where: and(
        eq(bookings.ownerId, ownerId),
        eq(bookings.customerId, refereeId),
        inArray(bookings.paymentStatus, [
          PaymentStatus.PAID,
          PaymentStatus.SETTLED_AT_VENUE,
        ]),
      ),
      columns: { id: true },
    });
    if (paidBooking) {
      throw new BadRequestException(
        'Referral cannot be applied: this player is not a new customer',
      );
    }

    // clone into a per-referee pending row so one code can refer many players
    await tx.insert(referrals).values({
      id: randomUUID(),
      ownerId,
      referrerId: ref.referrerId,
      refereeId,
      code,
      status: ReferralStatus.PENDING,
    });
  }

  /**
   * Release the reward if `refereeId` has a pending referral for this owner and
   * this is their first paid booking. Idempotent. Called from booking markPaid.
   */
  async releaseOnFirstPaid(
    tx: DbTx,
    ownerId: string,
    refereeId: string,
  ): Promise<void> {
    const ref = await tx.query.referrals.findFirst({
      where: and(
        eq(referrals.ownerId, ownerId),
        eq(referrals.refereeId, refereeId),
        eq(referrals.status, ReferralStatus.PENDING),
      ),
    });
    if (!ref) return;

    const owner = await tx.query.owners.findFirst({
      where: eq(owners.id, ownerId),
    });
    const reward = dec(owner?.referralReward ?? '0');
    if (reward.greaterThan(0)) {
      await this.ledger.post(tx, {
        ownerId,
        customerId: ref.referrerId,
        type: LedgerTxnType.REFERRAL_REWARD,
        amount: reward,
        lane: creditLane(ownerId),
        refType: 'referral',
        refId: ref.id,
        note: 'Referral reward (referee first paid booking)',
      });
    }
    await tx
      .update(referrals)
      .set({
        status: ReferralStatus.REWARDED,
        rewardReleasedOnFirstPaid: true,
      })
      .where(eq(referrals.id, ref.id));
  }
}
