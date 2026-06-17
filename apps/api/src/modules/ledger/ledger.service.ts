import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LedgerTxnType } from '@sportsbooking/shared';
import { PrismaService } from '../../prisma/prisma.service';

export interface LedgerPost {
  ownerId: string;
  customerId: string;
  type: LedgerTxnType;
  /** signed amount: positive = credit, negative = debit */
  amount: Prisma.Decimal | number;
  /** balance lane: "pack:<packId>" | "points" | "cash" */
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
  constructor(private readonly prisma: PrismaService) {}

  /** Current derived balance for a lane (sum is cached as balanceAfter). */
  async balance(
    tx: Prisma.TransactionClient,
    customerId: string,
    lane: string,
  ): Promise<Prisma.Decimal> {
    const last = await tx.ledgerTxn.findFirst({
      where: { customerId, lane },
      orderBy: { createdAt: 'desc' },
    });
    return last?.balanceAfter ?? new Prisma.Decimal(0);
  }

  /** Append a transaction; returns the new balanceAfter. Throws on overdraft. */
  async post(
    tx: Prisma.TransactionClient,
    entry: LedgerPost,
  ): Promise<Prisma.Decimal> {
    const current = await this.balance(tx, entry.customerId, entry.lane);
    const delta = new Prisma.Decimal(entry.amount);
    const next = current.add(delta);
    if (next.lessThan(0)) {
      throw new Error(
        `Ledger overdraft on lane ${entry.lane}: ${current} + ${delta} < 0`,
      );
    }
    await tx.ledgerTxn.create({
      data: {
        ownerId: entry.ownerId,
        customerId: entry.customerId,
        type: entry.type,
        amount: delta,
        balanceAfter: next,
        lane: entry.lane,
        refType: entry.refType,
        refId: entry.refId,
        note: entry.note,
      },
    });
    return next;
  }
}
