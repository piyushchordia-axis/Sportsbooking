import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Customer wallet/ledger view (PRD §5.1): derived balances per lane plus recent
 * history, scoped to one owner. Balances are read from the append-only ledger.
 */
@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(ownerId: string, customerId: string) {
    return this.prisma.withTenantId(ownerId, async (tx) => {
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
    });
  }
}
