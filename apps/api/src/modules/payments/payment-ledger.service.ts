import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import type { DbTx } from '../../db';
import { payments } from '../../db/schema';

/** A gateway money-movement kind (mirrors the PaymentTxnType enum). */
export type PaymentTxnKind = 'capture' | 'refund';

export interface RecordPaymentInput {
  ownerId: string;
  customerId?: string | null;
  /** The settled entity: a booking or a tournament participant. */
  refType: 'booking' | 'tournament_participant';
  refId: string;
  type: PaymentTxnKind;
  /** Gateway id (pay_… for a capture, rfnd_… for a refund). */
  gatewayId?: string | null;
  amount: number | string;
  /** Amount withheld (e.g. a cancellation fee) — refunds only. */
  fee?: number | string;
  /** Gateway status (captured / processed / pending / failed / …). */
  status: string;
  note?: string;
}

/**
 * Append-only ledger of real gateway transactions (captures + refunds). Records
 * the gateway id and status so refunds — whose gateway result was previously
 * discarded — become reconcilable and trackable per booking / tournament.
 */
@Injectable()
export class PaymentLedgerService {
  constructor(private readonly db: DbService) {}

  /**
   * Append a transaction using the CALLER'S transaction so the ledger row
   * commits atomically with the booking/participant state change (never a
   * dangling record if the surrounding update rolls back).
   */
  async record(tx: DbTx, input: RecordPaymentInput): Promise<void> {
    await tx.insert(payments).values({
      id: randomUUID(),
      ownerId: input.ownerId,
      customerId: input.customerId ?? null,
      refType: input.refType,
      refId: input.refId,
      type: input.type,
      gatewayId: input.gatewayId ?? null,
      amount: String(input.amount),
      fee: String(input.fee ?? 0),
      status: input.status,
      note: input.note ?? null,
    });
  }

  /**
   * List the caller's gateway transactions, newest first, optionally scoped to
   * one entity. Tenant isolation is enforced by an explicit ownerId filter —
   * RLS is not forced in production, so withTenant's session var alone would
   * leak other tenants' captures/refunds.
   */
  async list(filter: { ownerId: string; refType?: string; refId?: string }) {
    return this.db.withTenant((tx) => {
      const conds = [eq(payments.ownerId, filter.ownerId)];
      if (filter.refType) conds.push(eq(payments.refType, filter.refType));
      if (filter.refId) conds.push(eq(payments.refId, filter.refId));
      return tx
        .select()
        .from(payments)
        .where(and(...conds))
        .orderBy(desc(payments.createdAt));
    });
  }
}
