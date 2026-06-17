import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkillLevel, UserRole } from '@sportsbooking/shared';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
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
  list(user: RequestUser, segment?: string) {
    return this.prisma.withTenant(async (tx) => {
      const links = await tx.ownerCustomer.findMany({
        orderBy: { lastVisitAt: 'desc' },
      });
      const cutoff = new Date(Date.now() - 60 * 24 * 3600 * 1000);
      return links
        .filter((l) => {
          if (segment === 'lapsed') return l.lastVisitAt < cutoff;
          if (segment === 'regulars') return l.bookingCount >= 5;
          return true;
        })
        .map((l) => ({
          customerId: l.customerId,
          bookingCount: l.bookingCount,
          lastVisitAt: l.lastVisitAt.toISOString(),
          consent: l.consent,
          optedOut: l.optedOut,
        }));
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
}

@Module({
  controllers: [PlayersController],
  providers: [PlayersService],
})
export class PlayersModule {}
