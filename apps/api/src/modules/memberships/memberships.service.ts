import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LedgerTxnType, PackPricingMode } from '@sportsbooking/shared';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePackDto } from './dto';

export function packLane(packId: string): string {
  return `pack:${packId}`;
}

export interface PackApplication {
  /** rupee value the pack covers/discounts on the slot subtotal */
  discount: Prisma.Decimal;
  /** sessions to debit (one per slot) */
  sessions: number;
}

/**
 * Membership session packs (PRD §4.4). Packs load sessions into the customer's
 * append-only ledger and are debited per booking. Pricing per pack is either
 * flat-rate (pack fully covers the slot, dynamic price ignored) or a % discount
 * on the dynamic price.
 */
@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  // ---- Owner: pack catalogue ----
  createPack(user: RequestUser, dto: CreatePackDto) {
    const ownerId = user.ownerId!;
    if (dto.pricingMode === PackPricingMode.DISCOUNT && dto.discountPct == null) {
      throw new BadRequestException('discountPct required for discount packs');
    }
    return this.prisma.withTenant((tx) =>
      tx.membershipPack.create({
        data: {
          ownerId,
          name: dto.name,
          sessions: dto.sessions,
          price: new Prisma.Decimal(dto.price),
          validityDays: dto.validityDays,
          expiryMode: dto.expiryMode,
          pricingMode: dto.pricingMode,
          discountPct:
            dto.discountPct != null ? new Prisma.Decimal(dto.discountPct) : null,
          flatRate:
            dto.flatRate != null ? new Prisma.Decimal(dto.flatRate) : null,
          venueIds: dto.venueIds ?? [],
          unitIds: dto.unitIds ?? [],
        },
      }),
    );
  }

  listPacks(user: RequestUser) {
    return this.prisma.withTenant((tx) =>
      tx.membershipPack.findMany({ where: { active: true } }),
    );
  }

  /** Customer-facing: active packs offered by a given owner. */
  listPacksForOwner(ownerId: string) {
    return this.prisma.withTenantId(ownerId, (tx) =>
      tx.membershipPack.findMany({ where: { active: true } }),
    );
  }

  /** Customer buys a pack → ledger credited with sessions (PRD §6.3). */
  async purchase(ownerId: string, customerId: string, packId: string) {
    return this.prisma.withTenantId(ownerId, async (tx) => {
      const pack = await tx.membershipPack.findUnique({ where: { id: packId } });
      if (!pack || !pack.active) throw new NotFoundException('Pack not found');
      const balanceAfter = await this.ledger.post(tx, {
        ownerId,
        customerId,
        type: LedgerTxnType.PACK_BUY,
        amount: pack.sessions,
        lane: packLane(packId),
        refType: 'pack',
        refId: packId,
        note: `Bought ${pack.name} (${pack.sessions} sessions)`,
      });
      // NOTE: real payment for the pack price would precede this credit.
      return { packId, sessionsAdded: pack.sessions, balance: Number(balanceAfter) };
    });
  }

  /**
   * Compute how a pack applies to a slot subtotal and validate scope/balance.
   * Called inside the booking transaction. Does NOT debit — the caller debits
   * once the booking is committed (so cancellation can refund).
   */
  async evaluatePack(
    tx: Prisma.TransactionClient,
    packId: string,
    customerId: string,
    venueId: string,
    unitIds: string[],
    slotCount: number,
    slotSubtotal: Prisma.Decimal,
  ): Promise<PackApplication> {
    const pack = await tx.membershipPack.findUnique({ where: { id: packId } });
    if (!pack || !pack.active) throw new NotFoundException('Pack not found');

    // scope check (PRD §4.4): empty arrays = all venues/units
    if (pack.venueIds.length && !pack.venueIds.includes(venueId)) {
      throw new BadRequestException('Pack not valid at this venue');
    }
    if (pack.unitIds.length && !unitIds.every((u) => pack.unitIds.includes(u))) {
      throw new BadRequestException('Pack not valid for these courts');
    }

    const balance = await this.ledger.balance(tx, customerId, packLane(packId));
    if (balance.lessThan(slotCount)) {
      throw new BadRequestException('Not enough pack sessions');
    }

    let discount: Prisma.Decimal;
    if (pack.pricingMode === PackPricingMode.FLAT) {
      // flat-rate pack covers the dynamic price entirely
      discount = slotSubtotal;
    } else {
      const pct = pack.discountPct ?? new Prisma.Decimal(0);
      discount = slotSubtotal.mul(pct).div(100);
    }
    return { discount, sessions: slotCount };
  }

  /** Debit pack sessions for a committed booking. */
  debitSessions(
    tx: Prisma.TransactionClient,
    ownerId: string,
    customerId: string,
    packId: string,
    sessions: number,
    bookingId: string,
  ) {
    return this.ledger.post(tx, {
      ownerId,
      customerId,
      type: LedgerTxnType.PACK_DEBIT,
      amount: -sessions,
      lane: packLane(packId),
      refType: 'booking',
      refId: bookingId,
      note: `Debited ${sessions} session(s)`,
    });
  }

  /** Cancellation returns the session credit, not cash (PRD §4.4, §6.3). */
  refundSessions(
    tx: Prisma.TransactionClient,
    ownerId: string,
    customerId: string,
    packId: string,
    sessions: number,
    bookingId: string,
  ) {
    return this.ledger.post(tx, {
      ownerId,
      customerId,
      type: LedgerTxnType.PACK_REFUND,
      amount: sessions,
      lane: packLane(packId),
      refType: 'booking',
      refId: bookingId,
      note: `Refunded ${sessions} session(s) on cancellation`,
    });
  }
}
