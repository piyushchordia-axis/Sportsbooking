import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { LedgerTxnType } from '@sportsbooking/shared';
import type { DbTx } from '../../db';
import { Decimal, dec, money } from '../../db/money';
import { ledgerTxns } from '../../db/schema';

export interface LedgerPost {
  ownerId: string;
  customerId: string;
  type: LedgerTxnType;
  /** signed amount: positive = credit, negative = debit */
  amount: Decimal | number | string;
  /**
   * balance lane, e.g. "pack:<packId>" | "points:<ownerId>" |
   * "credit:<ownerId>" | "cash" | "dues" (SEC-5: points/credit are per-owner).
   */
  lane: string;
  refType?: string;
  refId?: string;
  note?: string;
}

/**
 * The single writer to the append-only ledger (PRD §7). Balances are DERIVED:
 * we read the latest balanceAfter for the (customer, lane), add the signed
 * amount, and append a new immutable row. Always call within an existing
 * transaction (tx) so it participates in the booking/payment atomically.
 */
@Injectable()
export class LedgerService {
  /** Current derived balance for a lane (sum is cached as balanceAfter). */
  async balance(
    tx: DbTx,
    customerId: string,
    lane: string,
  ): Promise<Decimal> {
    // Deterministic latest-row read: two rows can share the same createdAt
    // (same millisecond), so add a stable tiebreaker on id to guarantee a
    // single, well-defined "latest" row regardless of insertion timing.
    // NOTE (schema batch): id is a random uuid, so {createdAt desc, id desc}
    // is deterministic but NOT guaranteed to match true insertion order when
    // timestamps collide. A monotonic sequence column (e.g. `seq BigInt
    // @default(autoincrement())`) indexed by [customerId, lane, seq] would let
    // us order strictly by insertion order. The advisory lock in post() makes
    // this moot for writes (posts on a lane are serialized), so this only
    // matters for read-time tie resolution between historically equal-timestamp
    // rows.
    const last = await tx.query.ledgerTxns.findFirst({
      where: and(
        eq(ledgerTxns.customerId, customerId),
        eq(ledgerTxns.lane, lane),
      ),
      orderBy: [desc(ledgerTxns.createdAt), desc(ledgerTxns.id)],
    });
    return last ? dec(last.balanceAfter) : dec(0);
  }

  /** Append a transaction; returns the new balanceAfter. Throws on overdraft. */
  async post(tx: DbTx, entry: LedgerPost): Promise<Decimal> {
    // Serialize concurrent posts on the same (customer, lane) within their
    // transactions. pg_advisory_xact_lock blocks until any other txn holding
    // the same lock key commits/rolls back, so the read-modify-append below is
    // race-free even for posts landing in the same millisecond. The lock is
    // tied to the transaction and released automatically on commit/rollback.
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtext(${entry.customerId} || ':' || ${entry.lane})
      )
    `);
    const current = await this.balance(tx, entry.customerId, entry.lane);
    const delta = dec(entry.amount);
    const next = current.add(delta);
    if (next.lessThan(0)) {
      throw new Error(
        `Ledger overdraft on lane ${entry.lane}: ${current} + ${delta} < 0`,
      );
    }
    await tx.insert(ledgerTxns).values({
      id: randomUUID(),
      ownerId: entry.ownerId,
      customerId: entry.customerId,
      type: entry.type,
      amount: money(delta),
      balanceAfter: money(next),
      lane: entry.lane,
      refType: entry.refType,
      refId: entry.refId,
      note: entry.note,
    });
    return next;
  }
}
