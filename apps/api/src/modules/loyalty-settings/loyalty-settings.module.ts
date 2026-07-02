import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Put,
  Query,
} from '@nestjs/common';
import { UserRole } from '@sportsbooking/shared';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DbService } from '../../db/db.service';
import { ledgerTxns, owners, users } from '../../db/schema';

class UpdateLoyaltyConfigDto {
  /** Points earned per ₹1 spent (fraction, 0–1). */
  @IsOptional() @IsNumber() @Min(0) @Max(1) loyaltyEarnRate?: number;
  /** ₹ value of 1 redeemed point. */
  @IsOptional() @IsNumber() @Min(0) loyaltyRedeemValue?: number;
  /** ₹ credited to the referrer on a successful referral. */
  @IsOptional() @IsNumber() @Min(0) referralReward?: number;
}

interface LoyaltyConfig {
  loyaltyEarnRate: number;
  loyaltyRedeemValue: number;
  referralReward: number;
}

interface LoyaltyHistoryItem {
  id: string;
  type: string;
  amount: string;
  customerName: string | null;
  note: string | null;
  createdAt: Date;
}

/** Ledger types surfaced in the loyalty/referral history. */
const HISTORY_TYPES = [
  'points_earn',
  'points_redeem',
  'referral_reward',
] as const;
const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;

/**
 * Owner-level loyalty + referral configuration (the per-owner defaults on the
 * Owner row; venues can still override loyalty rates in their own settings) and
 * a read-only activity history from the points/referral ledger.
 */
@Injectable()
export class LoyaltySettingsService {
  constructor(private readonly db: DbService) {}

  getConfig(ownerId: string): Promise<LoyaltyConfig> {
    return this.db.withTenantId(ownerId, async (tx) => {
      const o = await tx.query.owners.findFirst({
        where: eq(owners.id, ownerId),
        columns: {
          loyaltyEarnRate: true,
          loyaltyRedeemValue: true,
          referralReward: true,
        },
      });
      if (!o) throw new BadRequestException('Owner not found');
      return {
        loyaltyEarnRate: Number(o.loyaltyEarnRate),
        loyaltyRedeemValue: Number(o.loyaltyRedeemValue),
        referralReward: Number(o.referralReward),
      };
    });
  }

  async updateConfig(
    ownerId: string,
    dto: UpdateLoyaltyConfigDto,
  ): Promise<LoyaltyConfig> {
    await this.db.withTenantId(ownerId, async (tx) => {
      const data: Record<string, unknown> = { updatedAt: new Date() };
      if (dto.loyaltyEarnRate !== undefined)
        data.loyaltyEarnRate = String(dto.loyaltyEarnRate);
      if (dto.loyaltyRedeemValue !== undefined)
        data.loyaltyRedeemValue = String(dto.loyaltyRedeemValue);
      if (dto.referralReward !== undefined)
        data.referralReward = String(dto.referralReward);
      await tx.update(owners).set(data).where(eq(owners.id, ownerId));
    });
    return this.getConfig(ownerId);
  }

  async getHistory(
    ownerId: string,
    limit = DEFAULT_HISTORY_LIMIT,
  ): Promise<LoyaltyHistoryItem[]> {
    const take = Math.min(MAX_HISTORY_LIMIT, Math.max(1, limit));
    return this.db.withTenant(async (tx) => {
      const rows = await tx
        .select({
          id: ledgerTxns.id,
          type: ledgerTxns.type,
          amount: ledgerTxns.amount,
          customerName: users.name,
          note: ledgerTxns.note,
          createdAt: ledgerTxns.createdAt,
        })
        .from(ledgerTxns)
        .leftJoin(users, eq(users.id, ledgerTxns.customerId))
        // Explicit ownerId filter — RLS is not forced in prod, so withTenant
        // alone would leak other tenants' customer names + point movements.
        .where(
          and(
            eq(ledgerTxns.ownerId, ownerId),
            inArray(ledgerTxns.type, [...HISTORY_TYPES]),
          ),
        )
        .orderBy(desc(ledgerTxns.createdAt))
        .limit(take);
      return rows as LoyaltyHistoryItem[];
    });
  }
}

@Controller('me/loyalty')
export class LoyaltySettingsController {
  constructor(private readonly loyalty: LoyaltySettingsService) {}

  @Get()
  @Roles(UserRole.OWNER, UserRole.STAFF)
  getConfig(@CurrentUser() user: RequestUser) {
    if (!user.ownerId) throw new BadRequestException('No tenant context');
    return this.loyalty.getConfig(user.ownerId);
  }

  @Put()
  @Roles(UserRole.OWNER)
  updateConfig(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateLoyaltyConfigDto,
  ) {
    if (!user.ownerId) throw new BadRequestException('No tenant context');
    return this.loyalty.updateConfig(user.ownerId, dto);
  }

  @Get('history')
  @Roles(UserRole.OWNER, UserRole.STAFF)
  getHistory(@CurrentUser() user: RequestUser, @Query('limit') limit?: string) {
    if (!user.ownerId) throw new BadRequestException('No tenant context');
    return this.loyalty.getHistory(
      user.ownerId,
      limit ? Number(limit) : undefined,
    );
  }
}

@Module({
  controllers: [LoyaltySettingsController],
  providers: [LoyaltySettingsService],
})
export class LoyaltySettingsModule {}
