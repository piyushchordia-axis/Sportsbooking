import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { LedgerTxnType } from '@sportsbooking/shared';
import { DbService } from '../../db/db.service';
import type { DbTx } from '../../db';
import { ledgerTxns, membershipPacks } from '../../db/schema';
import { POINTS_LANE, CREDIT_LANE } from '../loyalty/loyalty.service';
import { isPackExpired, packLane } from './memberships.service';

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
 *
 * Balances are derived PER LANE (the latest balanceAfter for each distinct
 * lane), NOT from a fixed window of recent rows — otherwise a long-idle lane
 * whose newest row falls outside the window silently drops out of the view
 * even though its balance is non-zero (WALLET-1). The row limit applies only
 * to the HISTORY/transactions list.
 */
@Injectable()
export class WalletService {
  constructor(private readonly db: DbService) {}

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
      return this.db.withTenantId(ownerId, (tx) =>
        this.scopedSummary(tx, customerId),
      );
    }
    return this.db.withTenantBypass((tx) =>
      this.aggregateSummary(tx, customerId),
    );
  }

  /** Per-owner view: latest balanceAfter per lane within the owner tenant. */
  private async scopedSummary(tx: DbTx, customerId: string) {
    // Balances: latest balanceAfter per DISTINCT lane (no row-window limit) so
    // idle lanes don't drop out (WALLET-1).
    const balances = await this.laneBalances(tx, customerId);
    // PACK-4: agree with the checkout "Use pack" picker (listOwnedPacks) by
    // dropping expired FORFEIT pack lanes from the reported balances.
    await this.dropExpiredPackLanes(tx, customerId, balances);

    return {
      balances,
      history: await this.history(tx, customerId),
    };
  }

  /**
   * Aggregate view across every owner: roll all per-owner `points:*` lanes into
   * a single `points` balance and all `credit:*` lanes into a single `credit`
   * balance (sum of the latest balanceAfter per distinct lane). Other lanes
   * (e.g. pack/cash/dues) are summed per distinct lane as-is.
   */
  private async aggregateSummary(tx: DbTx, customerId: string) {
    // Latest balanceAfter per distinct lane (no row-window limit) so idle lanes
    // don't drop out (WALLET-1).
    const latestPerLane = await this.laneBalances(tx, customerId);
    // PACK-4: drop expired FORFEIT pack lanes so the sessions tile agrees with
    // the checkout picker.
    await this.dropExpiredPackLanes(tx, customerId, latestPerLane);

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
      history: await this.history(tx, customerId),
    };
  }

  /**
   * Latest balanceAfter per DISTINCT lane for a customer — the same latest-row
   * semantics as ledger.balance (`createdAt desc, id desc`), but computed for
   * EVERY lane in one pass via DISTINCT ON. This is the authoritative balance
   * aggregation: it is NOT capped by any row window, so every lane with activity
   * is represented even if its newest row is old (WALLET-1).
   */
  private async laneBalances(
    tx: DbTx,
    customerId: string,
  ): Promise<Record<string, number>> {
    // DISTINCT ON (lane) keeps the first row per lane under the ORDER BY, whose
    // leading key must be `lane`; the trailing `createdAt desc, id desc` selects
    // the latest row per lane (matching ledger.balance's tiebreaker).
    const rows = await tx
      .selectDistinctOn([ledgerTxns.lane], {
        lane: ledgerTxns.lane,
        balanceAfter: ledgerTxns.balanceAfter,
      })
      .from(ledgerTxns)
      .where(eq(ledgerTxns.customerId, customerId))
      .orderBy(ledgerTxns.lane, desc(ledgerTxns.createdAt), desc(ledgerTxns.id));

    const balances: Record<string, number> = {};
    for (const r of rows) balances[r.lane] = Number(r.balanceAfter);
    return balances;
  }

  /**
   * PACK-4: drop expired FORFEIT pack lanes from a balances map so the wallet
   * agrees with the checkout "Use pack" picker (listOwnedPacks), which hides
   * packs past their validity window. We do NOT post a forfeiture row here —
   * this is a read-only view; the actual ledger settlement happens lazily on the
   * write paths (purchase/evaluatePack via resolvePackExpiry). Expiry is decided
   * with the same pure helper (isPackExpired) those paths use, so the views
   * never disagree.
   */
  private async dropExpiredPackLanes(
    tx: DbTx,
    customerId: string,
    balances: Record<string, number>,
  ): Promise<void> {
    const packIds: string[] = [];
    for (const lane of Object.keys(balances)) {
      if (lane.startsWith('pack:')) packIds.push(lane.slice('pack:'.length));
    }
    if (!packIds.length) return;

    const packs = await tx.query.membershipPacks.findMany({
      where: inArray(membershipPacks.id, packIds),
    });
    const packById = new Map(packs.map((p) => [p.id, p]));

    for (const packId of packIds) {
      const pack = packById.get(packId);
      if (!pack) continue;
      const lastBuy = await tx.query.ledgerTxns.findFirst({
        where: and(
          eq(ledgerTxns.customerId, customerId),
          eq(ledgerTxns.lane, packLane(packId)),
          eq(ledgerTxns.type, LedgerTxnType.PACK_BUY),
        ),
        orderBy: desc(ledgerTxns.createdAt),
      });
      if (!lastBuy) continue;
      if (
        isPackExpired(
          pack.expiryMode,
          pack.validityDays,
          new Date(lastBuy.createdAt),
        )
      ) {
        delete balances[packLane(packId)];
      }
    }
  }

  /** Recent ledger rows for the transactions list (row-limited, newest-first). */
  private async history(tx: DbTx, customerId: string) {
    const txns = await tx.query.ledgerTxns.findMany({
      where: eq(ledgerTxns.customerId, customerId),
      orderBy: desc(ledgerTxns.createdAt),
      limit: 100,
    });
    return txns.map((t) => ({
      type: t.type,
      lane: t.lane,
      amount: Number(t.amount),
      balanceAfter: Number(t.balanceAfter),
      note: t.note,
      at: t.createdAt.toISOString(),
    }));
  }
}
