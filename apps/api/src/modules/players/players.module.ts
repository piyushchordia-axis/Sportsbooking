import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  PlayerSummary,
  SkillLevel,
  UserRole,
} from '@sportsbooking/shared';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PrismaService } from '../../prisma/prisma.service';

class UpdateProfileDto {
  @IsOptional() @IsEnum(SkillLevel) skillLevel?: SkillLevel;
  @IsOptional() @IsArray() @IsString({ each: true }) games?: string[];
}

class CreateCustomerDto {
  @IsString() name!: string;
  @IsString() mobile!: string;
  @IsBoolean() consent!: boolean;
}

/**
 * Player profiles & CRM (PRD §4.9, §5.1). Skill level powers open-match
 * matching; the per-owner CRM supports segment/filter for marketing.
 */
@Injectable()
export class PlayersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Customer updates their (per-owner) profile — skill level / games. */
  updateProfile(ownerId: string, customerId: string, dto: UpdateProfileDto) {
    return this.prisma.withTenantId(ownerId, (tx) =>
      tx.playerProfile.update({
        where: { ownerId_customerId: { ownerId, customerId } },
        data: { skillLevel: dto.skillLevel, games: dto.games },
      }),
    );
  }

  /** Owner CRM directory with simple frequency/recency segmentation. */
  list(user: RequestUser, segment?: string): Promise<PlayerSummary[]> {
    return this.prisma.withTenant(async (tx) => {
      const links = await tx.ownerCustomer.findMany({
        orderBy: { lastVisitAt: 'desc' },
      });
      const cutoff = new Date(Date.now() - 60 * 24 * 3600 * 1000);
      const filtered = links.filter((l) => {
        if (segment === 'lapsed') return l.lastVisitAt < cutoff;
        if (segment === 'regulars') return l.bookingCount >= 5;
        return true;
      });

      // Enrich with name + mobile. Prefer the per-owner player profile; fall
      // back to the (global) user record for any legacy CRM link without one.
      const customerIds = filtered.map((l) => l.customerId);
      const [profiles, users] = await Promise.all([
        tx.playerProfile.findMany({
          where: { customerId: { in: customerIds } },
        }),
        tx.user.findMany({ where: { id: { in: customerIds } } }),
      ]);
      const profileById = new Map(profiles.map((p) => [p.customerId, p]));
      const userById = new Map(users.map((u) => [u.id, u]));

      return filtered.map((l) => {
        const profile = profileById.get(l.customerId);
        const u = userById.get(l.customerId);
        return {
          customerId: l.customerId,
          name: profile?.name ?? u?.name ?? null,
          mobile: profile?.mobile ?? u?.mobile ?? null,
          bookingCount: l.bookingCount,
          lastVisitAt: l.lastVisitAt.toISOString(),
          consent: l.consent,
          optedOut: l.optedOut,
        };
      });
    });
  }

  /**
   * Owner/staff add a customer to their CRM directly (PRD §4.9). Find or create
   * the global user by mobile, then upsert the owner's CRM link + player
   * profile. Mirrors the auto-capture done on booking, minus a booking.
   */
  async addCustomer(
    user: RequestUser,
    dto: CreateCustomerDto,
  ): Promise<PlayerSummary> {
    const ownerId = user.ownerId;
    if (!ownerId) throw new BadRequestException('No tenant context');

    return this.prisma.withTenantId(ownerId, async (tx) => {
      let customer = await tx.user.findUnique({
        where: { mobile: dto.mobile },
      });
      if (!customer) {
        customer = await tx.user.create({
          data: { role: 'customer', name: dto.name, mobile: dto.mobile },
        });
      }

      const link = await tx.ownerCustomer.upsert({
        where: { ownerId_customerId: { ownerId, customerId: customer.id } },
        create: {
          ownerId,
          customerId: customer.id,
          consent: dto.consent,
          lastVisitAt: new Date(),
        },
        update: { consent: dto.consent },
      });

      const profile = await tx.playerProfile.upsert({
        where: { ownerId_customerId: { ownerId, customerId: customer.id } },
        create: {
          ownerId,
          customerId: customer.id,
          name: dto.name,
          mobile: dto.mobile,
          consent: dto.consent,
        },
        update: { name: dto.name, mobile: dto.mobile, consent: dto.consent },
      });

      return {
        customerId: customer.id,
        name: profile.name,
        mobile: profile.mobile,
        bookingCount: link.bookingCount,
        lastVisitAt: link.lastVisitAt.toISOString(),
        consent: link.consent,
        optedOut: link.optedOut,
      };
    });
  }
}

@Controller()
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  @Put('owners/:ownerId/profile')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CUSTOMER)
  updateProfile(
    @CurrentUser() user: RequestUser,
    @Param('ownerId') ownerId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.players.updateProfile(ownerId, user.id, dto);
  }

  /** Owner CRM directory (PRD §4.9) with optional segment filter. */
  @Get('players')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  list(@CurrentUser() user: RequestUser, @Query('segment') segment?: string) {
    return this.players.list(user, segment);
  }

  /** Owner/staff add a customer to the CRM (PRD §4.9). */
  @Post('players')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  addCustomer(@CurrentUser() user: RequestUser, @Body() dto: CreateCustomerDto) {
    return this.players.addCustomer(user, dto);
  }
}

@Module({
  controllers: [PlayersController],
  providers: [PlayersService],
})
export class PlayersModule {}
