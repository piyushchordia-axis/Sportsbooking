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
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  FeatureFlag,
  FeeBasis,
  LedgerTxnType,
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
import { FeatureFlagGuard } from '../../common/guards/feature-flag.guard';
import { RequireFlag } from '../../common/decorators/require-flag.decorator';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentService } from '../payments/payment.service';
import {
  NotificationFeedModule,
  NotificationFeedService,
} from '../notification-feed/notification-feed.module';
import { DbService } from '../../db/db.service';
import type { DbTx } from '../../db';
import { Decimal } from '../../db/money';
import {
  ownerCustomers,
  tournamentParticipants,
  tournaments,
  users,
} from '../../db/schema';

/** Cash lane: a positive balance is money owed back to the customer. */
const CASH_LANE = 'cash';

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

class ConfirmParticipantDto {
  // Optional so the dev mock confirm (no real gateway handshake) keeps working;
  // when present it is the captured gateway payment id persisted for refunds.
  @IsOptional() @IsString() razorpayPaymentId?: string;
}

/**
 * Tournaments (PRD §4.7): solo or team registration with per-player/per-team
 * fee, online entry & fee collection, participant capture into the player DB.
 */
@Injectable()
export class TournamentsService {
  constructor(
    private readonly db: DbService,
    private readonly payments: PaymentService,
    private readonly ledger: LedgerService,
    private readonly feed: NotificationFeedService,
  ) {}

  create(user: RequestUser, dto: CreateTournamentDto) {
    return this.db.withTenant(
      async (tx) =>
        (
          await tx
            .insert(tournaments)
            .values({
              id: randomUUID(),
              ownerId: user.ownerId!,
              venueId: dto.venueId,
              name: dto.name,
              gameId: dto.gameId,
              format: dto.format,
              // `date` columns are string-mode: store the date portion only.
              startDate: new Date(dto.startDate).toISOString().slice(0, 10),
              endDate: new Date(dto.endDate).toISOString().slice(0, 10),
              capacity: dto.capacity,
              regType: dto.regType,
              feeBasis: dto.feeBasis,
              fee: new Decimal(dto.fee).toFixed(2),
              regCloseAt: dto.regCloseAt ? new Date(dto.regCloseAt) : null,
            })
            .returning()
        )[0],
    );
  }

  /** Public listing for discovery. Participant PII is NOT exposed here. */
  list(venueId: string) {
    return this.db.withTenantBypass(async (tx) => {
      const rows = await tx.query.tournaments.findMany({
        where: eq(tournaments.venueId, venueId),
        extras: {
          participantCount: sql<number>`(
            SELECT COUNT(*)::int FROM ${tournamentParticipants}
            WHERE ${tournamentParticipants.tournamentId} = ${tournaments.id}
          )`.as('participant_count'),
        },
      });
      // Preserve the `_count.participants` shape consumed by the client.
      return rows.map(({ participantCount, ...t }) => ({
        ...t,
        _count: { participants: Number(participantCount) },
      }));
    });
  }

  /**
   * Owner back-office listing: the caller-owner's own tournaments WITH their
   * participants (captain PII), used by the participant cancel/refund screen.
   * Tenant-scoped via `withTenant`, so an owner only ever sees their own rows —
   * unlike the public `list()` which omits participant detail.
   */
  listForOwner(venueId: string) {
    return this.db.withTenant(async (tx) => {
      const rows = await tx.query.tournaments.findMany({
        where: eq(tournaments.venueId, venueId),
        with: {
          tournamentParticipants: {
            orderBy: asc(tournamentParticipants.createdAt),
          },
        },
        orderBy: desc(tournaments.createdAt),
      });
      // Preserve the `participants` + `_count.participants` shape.
      return rows.map(({ tournamentParticipants: participants, ...t }) => ({
        ...t,
        participants,
        _count: { participants: participants.length },
      }));
    });
  }

  /**
   * Register a participant, collect the entry fee (Razorpay order; mocked
   * without live keys), and capture the captain into the player DB.
   */
  async register(tournamentId: string, dto: RegisterDto) {
    const t = await this.db.withTenantBypass((tx) =>
      tx.query.tournaments.findFirst({ where: eq(tournaments.id, tournamentId) }),
    );
    if (!t) throw new NotFoundException('Tournament not found');
    if (t.regCloseAt && t.regCloseAt < new Date()) {
      throw new BadRequestException('Registration is closed');
    }

    // Idempotency key derived from the de-dup scope (tournament + captain). A
    // retried submit by the same captain reuses the existing unpaid participant
    // & order instead of creating a duplicate (BUG-2).
    const idempotencyKey = `${tournamentId}:${dto.captainMobile}`;

    // BUG-2: capacity must be re-checked INSIDE the write transaction (the
    // earlier read-only check above is only a fast-fail); otherwise two
    // concurrent registrations both pass a stale count and over-fill the
    // tournament / double-charge. The whole create runs in one tx so the count
    // and the insert are atomic.
    const result = await this.db.withTenantId(t.ownerId, async (tx) => {
      // Reuse an existing unpaid registration for the same captain (retry /
      // double-submit) so we never create a duplicate participant or order.
      const existing = await tx.query.tournamentParticipants.findFirst({
        where: and(
          eq(tournamentParticipants.tournamentId, tournamentId),
          eq(tournamentParticipants.idempotencyKey, idempotencyKey),
          eq(tournamentParticipants.paid, false),
        ),
        orderBy: asc(tournamentParticipants.createdAt),
      });
      if (existing) {
        // Capture/refresh the captain CRM row on the retry too (idempotent).
        await this.captureCaptain(tx, t.ownerId, dto);
        return {
          participantId: existing.id,
          razorpayOrderId:
            existing.razorpayOrderId ??
            (await this.payments.createOrder(Number(t.fee), existing.id)).id,
          fee: Number(t.fee),
          reused: !!existing.razorpayOrderId,
        };
      }

      const count = (
        await tx
          .select({ c: sql<number>`COUNT(*)::int` })
          .from(tournamentParticipants)
          .where(eq(tournamentParticipants.tournamentId, tournamentId))
      )[0].c;
      if (count >= t.capacity) {
        throw new BadRequestException('Tournament is full');
      }

      const participant = (
        await tx
          .insert(tournamentParticipants)
          .values({
            id: randomUUID(),
            tournamentId,
            teamName: dto.teamName,
            captainName: dto.captainName,
            captainMobile: dto.captainMobile,
            paid: false,
            idempotencyKey,
          })
          .returning()
      )[0];

      const order = await this.payments.createOrder(
        Number(t.fee),
        participant.id,
      );
      // Persist the order id so a retried register reuses it and so confirm can
      // validate the handshake order against the participant (BUG-3).
      await tx
        .update(tournamentParticipants)
        .set({ razorpayOrderId: order.id })
        .where(eq(tournamentParticipants.id, participant.id));

      // Capture the captain into the owner CRM (PRD §4.7); upserts a User by
      // mobile so cancelRegistration() can always resolve a ledger customer.
      await this.captureCaptain(tx, t.ownerId, dto);

      // Owner in-app feed (the "bell"). Best-effort and fire-and-forget:
      // createForOwner runs in its OWN tenant transaction and never throws, so a
      // feed write can never roll back or fail the registration.
      void this.notifyOwnerTournamentRegistration(t.ownerId, t.name, dto);

      return {
        participantId: participant.id,
        razorpayOrderId: order.id,
        fee: Number(t.fee),
      };
    });

    return result;
  }

  /**
   * Best-effort owner in-app notification for a new tournament entry. Never
   * awaited in a way that affects the registration tx (createForOwner swallows
   * its own errors and uses its own tenant transaction).
   */
  private async notifyOwnerTournamentRegistration(
    ownerId: string,
    tournamentName: string,
    dto: RegisterDto,
  ): Promise<void> {
    const team = dto.teamName?.trim();
    const captain = dto.captainName?.trim();
    const who = team
      ? captain
        ? `${team} (captain ${captain})`
        : team
      : captain || 'A participant';
    await this.feed.createForOwner(ownerId, {
      type: 'tournament_registration',
      title: 'New tournament entry',
      body: `${who} registered for ${tournamentName}.`,
      link: '/owner/tournaments',
    });
  }

  /**
   * Upsert the captain into the global User table (by mobile) and link them to
   * the owner CRM. register() relies on this so every paid registration has a
   * resolvable User row, which keeps the refund ledger balanced (BUG-4).
   */
  private async captureCaptain(tx: DbTx, ownerId: string, dto: RegisterDto) {
    const user = await tx.query.users.findFirst({
      where: eq(users.mobile, dto.captainMobile),
    });
    const customer =
      user ??
      (
        await tx
          .insert(users)
          .values({
            id: randomUUID(),
            role: 'customer',
            name: dto.captainName,
            mobile: dto.captainMobile,
          })
          .returning()
      )[0];
    await tx
      .insert(ownerCustomers)
      .values({
        id: randomUUID(),
        ownerId,
        customerId: customer.id,
      })
      .onConflictDoUpdate({
        target: [ownerCustomers.ownerId, ownerCustomers.customerId],
        set: { lastVisitAt: new Date() },
      });
    return customer;
  }

  /**
   * Mark a registration paid (after Razorpay confirmation).
   *
   * Tenant-scoped: the tournament is looked up by `{ id, ownerId }` so an
   * owner/staff caller can only confirm participants on their own tournaments.
   * The dev DATABASE_URL connects as a Postgres superuser which bypasses RLS,
   * so this explicit ownerId scoping is the real tenant guard (defense in
   * depth), not RLS.
   */
  markPaid(
    ownerId: string,
    tournamentId: string,
    participantId: string,
    razorpayPaymentId?: string,
  ) {
    return this.db.withTenantBypass(async (tx) => {
      const t = await tx.query.tournaments.findFirst({
        where: and(eq(tournaments.id, tournamentId), eq(tournaments.ownerId, ownerId)),
      });
      if (!t) throw new NotFoundException('Tournament not found');

      const p = await tx.query.tournamentParticipants.findFirst({
        where: eq(tournamentParticipants.id, participantId),
      });
      if (!p || p.tournamentId !== tournamentId) {
        throw new NotFoundException('Participant not found');
      }
      // Idempotency: if already paid, return without re-processing.
      if (p.paid) return p;
      return (
        await tx
          .update(tournamentParticipants)
          .set({
            paid: true,
            // Persist the captured gateway payment id so a later cancellation
            // can refund against it (BUG-3). Only set when supplied by the
            // handshake.
            ...(razorpayPaymentId ? { razorpayPaymentId } : {}),
          })
          .where(eq(tournamentParticipants.id, participantId))
          .returning()
      )[0];
    });
  }

  /**
   * Cancel a participant's registration and refund the entry fee per policy.
   *
   * Refund policy:
   *  - ALLOWED before registration close (regCloseAt in the future, or no close
   *    date set).
   *  - AFTER close only if tournament.refundAllowedAfterClose is true; otherwise
   *    400 'refunds closed'.
   *
   * Refund mechanics:
   *  - If the participant was paid, attempt a gateway refund via PaymentService
   *    (using the deterministic order/payment reference from registration when no
   *    distinct gateway payment id is stored) and record the cash on the
   *    append-only ledger against the registrant.
   *  - Idempotent: an unpaid (already-refunded/cancelled) participant is a no-op,
   *    so we never double-refund. Marking paid=false flips the participant into
   *    the cancelled/refunded state with the existing column.
   *
   * Authorization is enforced at the controller (@Roles OWNER, STAFF); here we
   * also tenant-scope the tournament so an owner can only touch their own.
   */
  async cancelRegistration(
    ownerId: string,
    tournamentId: string,
    participantId: string,
  ) {
    const t = await this.db.withTenantBypass((tx) =>
      tx.query.tournaments.findFirst({ where: eq(tournaments.id, tournamentId) }),
    );
    if (!t || t.ownerId !== ownerId) {
      throw new NotFoundException('Tournament not found');
    }

    const p = await this.db.withTenantBypass((tx) =>
      tx.query.tournamentParticipants.findFirst({
        where: eq(tournamentParticipants.id, participantId),
      }),
    );
    if (!p || p.tournamentId !== tournamentId) {
      throw new NotFoundException('Participant not found');
    }

    // Idempotency: an already-cancelled/refunded participant (paid=false) is a
    // no-op so the gateway is never hit twice.
    if (!p.paid) {
      return { cancelled: true as const, refunded: false as const };
    }

    // Policy gate: after registration close, only when explicitly allowed.
    const closed = t.regCloseAt != null && t.regCloseAt < new Date();
    if (closed && !t.refundAllowedAfterClose) {
      throw new BadRequestException('refunds closed');
    }

    const fee = Number(t.fee);
    let gatewayId = '';
    if (fee > 0) {
      // BUG-3: refund against the captured gateway payment id (mirrors
      // booking.razorpayPaymentId). Fall back to the order id, then the
      // participant id, only when no payment id was captured (e.g. legacy rows
      // or the dev mock flow) so the dev/mock path keeps working.
      const refundRef =
        p.razorpayPaymentId ?? p.razorpayOrderId ?? participantId;
      const res = await this.payments.refund(refundRef, fee);
      gatewayId = res.id;
    }

    return this.db.withTenantId(t.ownerId, async (tx) => {
      // Re-check inside the tx for idempotency under concurrency.
      const fresh = await tx.query.tournamentParticipants.findFirst({
        where: eq(tournamentParticipants.id, participantId),
      });
      if (!fresh || !fresh.paid) {
        return { cancelled: true as const, refunded: false as const };
      }

      await tx
        .update(tournamentParticipants)
        .set({ paid: false })
        .where(eq(tournamentParticipants.id, participantId));

      // BUG-4: every gateway refund MUST have a matching ledger entry or the
      // cash book is unbalanced. register() upserts a User by mobile, so the
      // customer should always resolve; if it somehow does not (legacy data),
      // upsert one now keyed off the captain's captured details rather than
      // silently skipping the ledger post.
      if (fee > 0) {
        let customer = await tx.query.users.findFirst({
          where: eq(users.mobile, fresh.captainMobile),
        });
        if (!customer) {
          customer = (
            await tx
              .insert(users)
              .values({
                id: randomUUID(),
                role: 'customer',
                name: fresh.captainName,
                mobile: fresh.captainMobile,
              })
              .returning()
          )[0];
        }
        await this.ledger.post(tx, {
          ownerId: t.ownerId,
          customerId: customer.id,
          type: LedgerTxnType.CASH_REFUND,
          amount: new Decimal(fee),
          lane: CASH_LANE,
          refType: 'tournament_participant',
          refId: participantId,
          note: gatewayId
            ? `Tournament refund ${gatewayId} (₹${fee})`
            : `Tournament refund (₹${fee})`,
        });
      }

      return {
        cancelled: true as const,
        refunded: fee > 0,
        gatewayId: gatewayId || undefined,
      };
    });
  }
}

@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournaments: TournamentsService) {}

  @Post()
  @UseGuards(RolesGuard, FeatureFlagGuard)
  @Roles(UserRole.OWNER)
  @RequireFlag(FeatureFlag.TOURNAMENTS)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateTournamentDto) {
    return this.tournaments.create(user, dto);
  }

  @Public()
  @Get('venue/:venueId')
  list(@Param('venueId') venueId: string) {
    return this.tournaments.list(venueId);
  }

  /**
   * Owner/staff back-office listing including participant detail (captain PII)
   * for the cancel/refund screen. Tenant-scoped to the caller's owner; not
   * public, unlike the discovery listing above.
   */
  @UseGuards(RolesGuard, FeatureFlagGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @RequireFlag(FeatureFlag.TOURNAMENTS)
  @Get('manage/venue/:venueId')
  listForOwner(@Param('venueId') venueId: string) {
    return this.tournaments.listForOwner(venueId);
  }

  /** Open entry — guests can register and are captured into the player DB. */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post(':id/register')
  register(@Param('id') id: string, @Body() dto: RegisterDto) {
    return this.tournaments.register(id, dto);
  }

  /**
   * Confirm an entry-fee payment. Restricted to the owner/staff who run the
   * tournament (same RolesGuard pattern as the rest of the back office); the
   * global JWT auth guard populates request.user once @Public is removed.
   */
  @UseGuards(RolesGuard, FeatureFlagGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @RequireFlag(FeatureFlag.TOURNAMENTS)
  @Post(':id/participants/:participantId/confirm')
  confirm(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('participantId') participantId: string,
    @Body() dto: ConfirmParticipantDto,
  ) {
    return this.tournaments.markPaid(
      user.ownerId!,
      id,
      participantId,
      dto?.razorpayPaymentId,
    );
  }

  /**
   * Cancel a participant's registration and refund the entry fee per policy
   * (refundAllowedAfterClose). Owner/staff-initiated, mirroring the confirm
   * guard above; the service tenant-scopes the tournament to the caller's owner.
   */
  @UseGuards(RolesGuard, FeatureFlagGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @RequireFlag(FeatureFlag.TOURNAMENTS)
  @Post(':id/participants/:participantId/cancel')
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('participantId') participantId: string,
  ) {
    return this.tournaments.cancelRegistration(user.ownerId!, id, participantId);
  }
}

@Module({
  imports: [NotificationFeedModule],
  controllers: [TournamentsController],
  providers: [TournamentsService],
})
export class TournamentsModule {}
