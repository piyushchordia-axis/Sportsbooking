import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  JoinRequestStatus,
  LedgerTxnType,
  OpenMatchRepaymentMode,
  OpenMatchStatus,
  SkillLevel,
  UserRole,
} from '@sportsbooking/shared';
import { IsEnum, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { LedgerService } from '../ledger/ledger.service';
import { CREDIT_LANE } from '../loyalty/loyalty.service';
import { PrismaService } from '../../prisma/prisma.service';

class CreateMatchDto {
  @IsUUID() bookingId!: string;
  @IsInt() @Min(1) openSpots!: number;
  @IsOptional() @IsEnum(SkillLevel) skillMin?: SkillLevel;
  @IsOptional() @IsEnum(SkillLevel) skillMax?: SkillLevel;
}

/**
 * Open matches / find players (PRD §5.3, §6.2). A host opens spare spots on a
 * booked slot; players request to join and the host approves each. Repayment is
 * per-venue: informational only, or settled through the ledger (joiner repays
 * the host their share).
 */
@Injectable()
export class OpenMatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /** Host opens a match on their own booking. */
  async create(host: RequestUser, dto: CreateMatchDto) {
    const booking = await this.prisma.withTenantBypass((tx) =>
      tx.booking.findUnique({ where: { id: dto.bookingId } }),
    );
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.customerId !== host.id) {
      throw new ForbiddenException('Only the host can open this booking');
    }

    return this.prisma.withTenantId(booking.ownerId, async (tx) => {
      const settings = await tx.venueSettings.findUnique({
        where: { venueId: booking.venueId },
      });
      return tx.openMatch.create({
        data: {
          ownerId: booking.ownerId,
          bookingId: dto.bookingId,
          hostId: host.id,
          openSpots: dto.openSpots,
          skillMin: dto.skillMin ?? SkillLevel.BEGINNER,
          skillMax: dto.skillMax ?? SkillLevel.PRO,
          repaymentMode:
            settings?.openMatchRepaymentMode ?? OpenMatchRepaymentMode.INFO,
        },
      });
    });
  }

  /** A player requests to join an open match. */
  async requestJoin(player: RequestUser, matchId: string) {
    const match = await this.prisma.withTenantBypass((tx) =>
      tx.openMatch.findUnique({ where: { id: matchId } }),
    );
    if (!match) throw new NotFoundException('Match not found');
    if (match.status !== OpenMatchStatus.OPEN) {
      throw new BadRequestException('Match is not open');
    }
    return this.prisma.withTenantId(match.ownerId, (tx) =>
      tx.openMatchJoinRequest.create({
        data: { matchId, playerId: player.id },
      }),
    );
  }

  /**
   * Host approves a join request. When the venue uses ledger settlement, the
   * joiner repays the host their share (booking total / total players) via the
   * credit lane — throws if the joiner's wallet credit is insufficient.
   */
  async approve(host: RequestUser, matchId: string, requestId: string) {
    const match = await this.prisma.withTenantBypass((tx) =>
      tx.openMatch.findUnique({ where: { id: matchId }, include: { booking: true } }),
    );
    if (!match) throw new NotFoundException('Match not found');
    if (match.hostId !== host.id) {
      throw new ForbiddenException('Only the host approves requests');
    }

    return this.prisma.withTenantId(match.ownerId, async (tx) => {
      const req = await tx.openMatchJoinRequest.findUnique({
        where: { id: requestId },
      });
      if (!req || req.matchId !== matchId) {
        throw new NotFoundException('Request not found');
      }
      await tx.openMatchJoinRequest.update({
        where: { id: requestId },
        data: { status: JoinRequestStatus.APPROVED },
      });

      const approved = await tx.openMatchJoinRequest.count({
        where: { matchId, status: JoinRequestStatus.APPROVED },
      });

      if (match.repaymentMode === OpenMatchRepaymentMode.LEDGER) {
        const players = match.openSpots + 1; // host + spots
        const share = match.booking.total.div(players);
        // joiner repays host their share
        await this.ledger.post(tx, {
          ownerId: match.ownerId,
          customerId: req.playerId,
          type: LedgerTxnType.OPEN_MATCH_SETTLE,
          amount: share.negated(),
          lane: CREDIT_LANE,
          refType: 'open_match',
          refId: matchId,
          note: 'Open-match share repaid to host',
        });
        await this.ledger.post(tx, {
          ownerId: match.ownerId,
          customerId: match.hostId,
          type: LedgerTxnType.OPEN_MATCH_SETTLE,
          amount: share,
          lane: CREDIT_LANE,
          refType: 'open_match',
          refId: matchId,
          note: 'Received open-match share from joiner',
        });
      }

      // Close the match once all spots are filled.
      if (approved >= match.openSpots) {
        await tx.openMatch.update({
          where: { id: matchId },
          data: { status: OpenMatchStatus.FULL },
        });
      }
      return { approved: true, spotsFilled: approved, openSpots: match.openSpots };
    });
  }
}

@Controller('open-matches')
@UseGuards(RolesGuard)
@Roles(UserRole.CUSTOMER)
export class OpenMatchesController {
  constructor(private readonly matches: OpenMatchesService) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateMatchDto) {
    return this.matches.create(user, dto);
  }

  @Post(':id/join')
  join(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.matches.requestJoin(user, id);
  }

  @Post(':id/requests/:requestId/approve')
  approve(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('requestId') requestId: string,
  ) {
    return this.matches.approve(user, id, requestId);
  }
}

@Module({
  controllers: [OpenMatchesController],
  providers: [OpenMatchesService],
})
export class OpenMatchesModule {}
