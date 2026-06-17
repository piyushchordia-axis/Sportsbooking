import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FeeBasis,
  RegistrationType,
  TournamentFormat,
  UserRole,
} from '@sportsbooking/shared';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaymentService } from '../payments/payment.service';
import { PrismaService } from '../../prisma/prisma.service';

class CreateTournamentDto {
  @IsUUID() venueId!: string;
  @IsString() name!: string;
  @IsUUID() gameId!: string;
  @IsEnum(TournamentFormat) format!: TournamentFormat;
  @IsISO8601() startDate!: string;
  @IsISO8601() endDate!: string;
  @IsInt() @Min(2) capacity!: number;
  @IsEnum(RegistrationType) regType!: RegistrationType;
  @IsEnum(FeeBasis) feeBasis!: FeeBasis;
  @IsNumber() fee!: number;
  @IsOptional() @IsISO8601() regCloseAt?: string;
}

class RegisterDto {
  @IsString() captainName!: string;
  @IsString() captainMobile!: string;
  @IsOptional() @IsString() teamName?: string;
}

/**
 * Tournaments (PRD §4.7): solo or team registration with per-player/per-team
 * fee, online entry & fee collection, participant capture into the player DB.
 */
@Injectable()
export class TournamentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentService,
  ) {}

  create(user: RequestUser, dto: CreateTournamentDto) {
    return this.prisma.withTenant((tx) =>
      tx.tournament.create({
        data: {
          ownerId: user.ownerId!,
          venueId: dto.venueId,
          name: dto.name,
          gameId: dto.gameId,
          format: dto.format,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          capacity: dto.capacity,
          regType: dto.regType,
          feeBasis: dto.feeBasis,
          fee: new Prisma.Decimal(dto.fee),
          regCloseAt: dto.regCloseAt ? new Date(dto.regCloseAt) : null,
        },
      }),
    );
  }

  /** Public listing for discovery. */
  list(venueId: string) {
    return this.prisma.withTenantBypass((tx) =>
      tx.tournament.findMany({
        where: { venueId },
        include: { _count: { select: { participants: true } } },
      }),
    );
  }

  /**
   * Register a participant, collect the entry fee (Razorpay order; mocked
   * without live keys), and capture the captain into the player DB.
   */
  async register(tournamentId: string, dto: RegisterDto) {
    const t = await this.prisma.withTenantBypass((tx) =>
      tx.tournament.findUnique({
        where: { id: tournamentId },
        include: { _count: { select: { participants: true } } },
      }),
    );
    if (!t) throw new NotFoundException('Tournament not found');
    if (t.regCloseAt && t.regCloseAt < new Date()) {
      throw new BadRequestException('Registration is closed');
    }
    if (t._count.participants >= t.capacity) {
      throw new BadRequestException('Tournament is full');
    }

    return this.prisma.withTenantId(t.ownerId, async (tx) => {
      const participant = await tx.tournamentParticipant.create({
        data: {
          tournamentId,
          teamName: dto.teamName,
          captainName: dto.captainName,
          captainMobile: dto.captainMobile,
          paid: false,
        },
      });

      const order = await this.payments.createOrder(
        Number(t.fee),
        participant.id,
      );

      // Capture the captain into the owner CRM (PRD §4.7).
      const user = await tx.user.findUnique({
        where: { mobile: dto.captainMobile },
      });
      const customer =
        user ??
        (await tx.user.create({
          data: { role: 'customer', name: dto.captainName, mobile: dto.captainMobile },
        }));
      await tx.ownerCustomer.upsert({
        where: { ownerId_customerId: { ownerId: t.ownerId, customerId: customer.id } },
        create: { ownerId: t.ownerId, customerId: customer.id },
        update: { lastVisitAt: new Date() },
      });

      return { participantId: participant.id, razorpayOrderId: order.id, fee: Number(t.fee) };
    });
  }

  /** Mark a registration paid (after Razorpay confirmation). */
  markPaid(tournamentId: string, participantId: string) {
    return this.prisma.withTenantBypass(async (tx) => {
      const p = await tx.tournamentParticipant.findUnique({
        where: { id: participantId },
      });
      if (!p || p.tournamentId !== tournamentId) {
        throw new NotFoundException('Participant not found');
      }
      return tx.tournamentParticipant.update({
        where: { id: participantId },
        data: { paid: true },
      });
    });
  }
}

@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournaments: TournamentsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateTournamentDto) {
    return this.tournaments.create(user, dto);
  }

  @Public()
  @Get('venue/:venueId')
  list(@Param('venueId') venueId: string) {
    return this.tournaments.list(venueId);
  }

  /** Open entry — guests can register and are captured into the player DB. */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post(':id/register')
  register(@Param('id') id: string, @Body() dto: RegisterDto) {
    return this.tournaments.register(id, dto);
  }

  @Public()
  @Post(':id/participants/:participantId/confirm')
  confirm(
    @Param('id') id: string,
    @Param('participantId') participantId: string,
  ) {
    return this.tournaments.markPaid(id, participantId);
  }
}

@Module({
  controllers: [TournamentsController],
  providers: [TournamentsService],
})
export class TournamentsModule {}
