import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { POINTS_LANE, CREDIT_LANE } from '../loyalty/loyalty.service';

/**
 * Customer wallet/ledger view (PRD §5.1): derived balances per lane plus recent
 * history, read from the append-only ledger.
 *
 * SEC-5: the points and credit lanes are namespaced per owner
 * (`points:<ownerId>` / `credit:<ownerId>`). The wallet supports two reads:
 *  - scoped to a single owner (the usual case): the per-owner points/credit
 *    lanes plus that owner's pack lanes;
 *  - aggregated across ALL of the customer's owners (no ownerId): we sum the
 *    latest balance of every distinct `points:*` / `credit:*` lane so the
 *    customer still sees a combined view.
 */
@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Wallet summary for a customer, optionally scoped to one owner.
   *
   * - `ownerId` provided  → read that owner's lanes (RLS-scoped to the owner),
   *   so the per-owner `points:<ownerId>` / `credit:<ownerId>` lanes show that
   *   owner's balance only.
   * - `ownerId` omitted   → aggregate across all of the customer's owners: the
   *   `points` / `credit` balances are the SUM of the latest balanceAfter of
   *   each distinct `points:*` / `credit:*` lane.
   */
  async summary(customerId: string, ownerId?: string) {
    if (ownerId) {
      return this.prisma.withTenantId(ownerId, (tx) =>
        this.scopedSummary(tx, customerId),
      );
    }
    return this.prisma.withTenantBypass((tx) =>
      this.aggregateSummary(tx, customerId),
    );
  }

  /** Per-owner view: latest balanceAfter per lane within the owner tenant. */
  private async scopedSummary(
    tx: Prisma.TransactionClient,
    customerId: string,
  ) {
    const txns = await tx.ledgerTxn.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // latest balanceAfter per lane = current derived balance
    const balances: Record<string, number> = {};
    for (const t of txns) {
      if (!(t.lane in balances)) balances[t.lane] = Number(t.balanceAfter);
    }

    return {
      balances,
      history: txns.map((t) => ({
        type: t.type,
        lane: t.lane,
        amount: Number(t.amount),
        balanceAfter: Number(t.balanceAfter),
        note: t.note,
        at: t.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Aggregate view across every owner: roll all per-owner `points:*` lanes into
   * a single `points` balance and all `credit:*` lanes into a single `credit`
   * balance (sum of the latest balanceAfter per distinct lane). Other lanes
   * (e.g. pack/cash/dues) are summed per distinct lane as-is.
   */
  private async aggregateSummary(
    tx: Prisma.TransactionClient,
    customerId: string,
  ) {
    const txns = await tx.ledgerTxn.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Latest balanceAfter per distinct lane (txns are newest-first).
    const latestPerLane: Record<string, number> = {};
    for (const t of txns) {
      if (!(t.lane in latestPerLane)) {
        latestPerLane[t.lane] = Number(t.balanceAfter);
      }
    }

    const pointsPrefix = `${POINTS_LANE}:`;
    const creditPrefix = `${CREDIT_LANE}:`;
    const balances: Record<string, number> = {};
    for (const [lane, bal] of Object.entries(latestPerLane)) {
      if (lane.startsWith(pointsPrefix)) {
        balances[POINTS_LANE] = (balances[POINTS_LANE] ?? 0) + bal;
      } else if (lane.startsWith(creditPrefix)) {
        balances[CREDIT_LANE] = (balances[CREDIT_LANE] ?? 0) + bal;
      } else {
        balances[lane] = bal;
      }
    }

    return {
      balances,
      history: txns.map((t) => ({
        type: t.type,
        lane: t.lane,
        amount: Number(t.amount),
        balanceAfter: Number(t.balanceAfter),
        note: t.note,
        at: t.createdAt.toISOString(),
      })),
    };
  }
}
