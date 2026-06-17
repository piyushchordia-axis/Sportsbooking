import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LedgerTxnType, ReferralStatus } from '@sportsbooking/shared';
import { LedgerService } from '../ledger/ledger.service';
import { CREDIT_LANE } from '../loyalty/loyalty.service';

/**
 * Referral programme (PRD §4.5). Each player gets a per-owner referral code;
 * the reward credit is released to the referrer only after the referred
 * player's FIRST PAID booking. Reward lands in the redeemable `credit` lane.
 */
@Injectable()
export class ReferralService {
  constructor(private readonly ledger: LedgerService) {}

  private generateCode(): string {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  /** Get or create the caller's referral code for a given owner. */
  async myCode(
    tx: Prisma.TransactionClient,
    ownerId: string,
    referrerId: string,
  ): Promise<string> {
    const existing = await tx.referral.findFirst({
      where: { ownerId, referrerId, refereeId: null },
    });
    if (existing) return existing.code;
    let code = this.generateCode();
    // avoid collision on the (ownerId, code) unique constraint
    while (await tx.referral.findFirst({ where: { ownerId, code } })) {
      code = this.generateCode();
    }
    await tx.referral.create({
      data: { ownerId, referrerId, code, status: ReferralStatus.PENDING },
    });
    return code;
  }

  /** A new player applies a code → links them as the referee (still pending). */
  async apply(
    tx: Prisma.TransactionClient,
    ownerId: string,
    code: string,
    refereeId: string,
  ): Promise<void> {
    const ref = await tx.referral.findFirst({
      where: { ownerId, code, status: ReferralStatus.PENDING },
    });
    if (!ref) throw new NotFoundException('Invalid referral code');
    if (ref.referrerId === refereeId) return; // no self-referral
    // clone into a per-referee pending row so one code can refer many players
    await tx.referral.create({
      data: {
        ownerId,
        referrerId: ref.referrerId,
        refereeId,
        code,
        status: ReferralStatus.PENDING,
      },
    });
  }

  /**
   * Release the reward if `refereeId` has a pending referral for this owner and
   * this is their first paid booking. Idempotent. Called from booking markPaid.
   */
  async releaseOnFirstPaid(
    tx: Prisma.TransactionClient,
    ownerId: string,
    refereeId: string,
  ): Promise<void> {
    const ref = await tx.referral.findFirst({
      where: { ownerId, refereeId, status: ReferralStatus.PENDING },
    });
    if (!ref) return;

    const owner = await tx.owner.findUnique({ where: { id: ownerId } });
    const reward = owner?.referralReward ?? new Prisma.Decimal(0);
    if (reward.greaterThan(0)) {
      await this.ledger.post(tx, {
        ownerId,
        customerId: ref.referrerId,
        type: LedgerTxnType.REFERRAL_REWARD,
        amount: reward,
        lane: CREDIT_LANE,
        refType: 'referral',
        refId: ref.id,
        note: 'Referral reward (referee first paid booking)',
      });
    }
    await tx.referral.update({
      where: { id: ref.id },
      data: { status: ReferralStatus.REWARDED, rewardReleasedOnFirstPaid: true },
    });
  }
}
