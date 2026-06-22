import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import {
  FeatureFlag,
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
import { FeatureFlagGuard } from '../../common/guards/feature-flag.guard';
import { RequireFlag } from '../../common/decorators/require-flag.decorator';
import { LedgerService } from '../ledger/ledger.service';
import { creditLane } from '../loyalty/loyalty.service';
import { NotificationService } from '../notifications/notification.service';
import { db } from '../../db';
import { DbService } from '../../db/db.service';
import { dec } from '../../db/money';
import {
  bookings,
  ledgerTxns,
  openMatches,
  openMatchJoinRequests,
  slots,
  users,
  venueSettings,
} from '../../db/schema';

class CreateMatchDto {
  @IsUUID() bookingId!: string;
  @IsInt() @Min(1) openSpots!: number;
  @IsOptional() @IsEnum(SkillLevel) skillMin?: SkillLevel;
  @IsOptional() @IsEnum(SkillLevel) skillMax?: SkillLevel;
}

/**
 * Relational `with` clause for a match projection (used by the relational query
 * builder). Drizzle relation names (from relations.ts): the host is the `user`
 * relation on open_matches (hostId), the joined slots live under `slots`, a
 * slot's unit is `bookableUnit` whose game is `gameCatalogue`, and approved
 * requests (= filled spots) are `openMatchJoinRequests`.
 */
const MATCH_WITH = {
  user: { columns: { id: true, name: true } },
  booking: {
    with: {
      slots: {
        with: {
          bookableUnit: { with: { gameCatalogue: true, venue: true } },
        },
        orderBy: asc(slots.startsAt),
        limit: 1,
      },
    },
  },
  openMatchJoinRequests: {
    where: eq(openMatchJoinRequests.status, JoinRequestStatus.APPROVED),
    columns: { status: true },
  },
} as const;

/** A match projected with {@link MATCH_WITH} (host + booking/slot + approved). */
type MatchWithIncludes = NonNullable<
  Awaited<
    ReturnType<typeof db.query.openMatches.findFirst<{ with: typeof MATCH_WITH }>>
  >
>;

/**
 * Open matches / find players (PRD §5.3, §6.2). A host opens spare spots on a
 * booked slot; players request to join and the host approves each. Repayment is
 * per-venue: informational only, or settled through the ledger (joiner repays
 * the host their share).
 */
@Injectable()
export class OpenMatchesService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Best-effort notification helper (PRD §9). Looks up the recipient's mobile
   * and sends a WhatsApp message; any failure is swallowed so an open-match
   * action never breaks on a delivery error.
   */
  private async notifyUser(userId: string, message: string): Promise<void> {
    try {
      const user = await this.db.withTenantBypass((tx) =>
        tx.query.users.findFirst({
          where: eq(users.id, userId),
          columns: { mobile: true },
        }),
      );
      if (user?.mobile) {
        await this.notifications.sendWhatsApp(user.mobile, message);
      }
    } catch {
      // Swallow: notifications are best-effort and must not break the action.
    }
  }

  /** Host opens a match on their own booking. */
  async create(host: RequestUser, dto: CreateMatchDto) {
    const booking = await this.db.withTenantBypass((tx) =>
      tx.query.bookings.findFirst({ where: eq(bookings.id, dto.bookingId) }),
    );
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.customerId !== host.id) {
      throw new ForbiddenException('Only the host can open this booking');
    }

    return this.db.withTenantId(booking.ownerId, async (tx) => {
      const settings = await tx.query.venueSettings.findFirst({
        where: eq(venueSettings.venueId, booking.venueId),
      });
      return (
        await tx
          .insert(openMatches)
          .values({
            id: randomUUID(),
            ownerId: booking.ownerId,
            bookingId: dto.bookingId,
            hostId: host.id,
            openSpots: dto.openSpots,
            skillMin: dto.skillMin ?? SkillLevel.BEGINNER,
            skillMax: dto.skillMax ?? SkillLevel.PRO,
            repaymentMode:
              settings?.openMatchRepaymentMode ?? OpenMatchRepaymentMode.INFO,
          })
          .returning()
      )[0];
    });
  }

  /**
   * Browse OPEN matches that still have spare spots (customer-visible, cross
   * tenant). Excludes full/closed/cancelled/completed matches. Optionally
   * filtered to a single venue.
   */
  async browse(venueId?: string) {
    const matches = await this.db.withTenantBypass((tx) =>
      tx.query.openMatches.findMany({
        where: eq(openMatches.status, OpenMatchStatus.OPEN),
        with: MATCH_WITH,
        orderBy: desc(openMatches.createdAt),
      }),
    );

    // Only matches that still have at least one unfilled spot. Venue filter is
    // applied post-fetch (the relational filter is on the nested booking).
    return matches
      .filter((m) => !venueId || m.booking.venueId === venueId)
      .map((m) => this.toBrowseView(m))
      .filter((v) => v.spots.remaining > 0);
  }

  /**
   * The authenticated customer's open-match activity: matches they HOST (with
   * the pending join requests they need to action) and matches they have
   * joined or requested.
   */
  async mine(user: RequestUser) {
    const [hosted, pending, joined] = await this.db.withTenantBypass((tx) =>
      Promise.all([
        tx.query.openMatches.findMany({
          where: eq(openMatches.hostId, user.id),
          with: MATCH_WITH,
          orderBy: desc(openMatches.createdAt),
        }),
        // pending join requests across all of this host's matches
        tx.query.openMatchJoinRequests.findMany({
          where: eq(openMatchJoinRequests.status, JoinRequestStatus.REQUESTED),
          with: {
            user: { columns: { id: true, name: true } },
            openMatch: { columns: { hostId: true } },
          },
          orderBy: openMatchJoinRequests.createdAt,
        }),
        tx.query.openMatchJoinRequests.findMany({
          where: eq(openMatchJoinRequests.playerId, user.id),
          with: {
            openMatch: { with: MATCH_WITH },
          },
          orderBy: desc(openMatchJoinRequests.createdAt),
        }),
      ]),
    );

    return {
      hosting: hosted.map((m) => ({
        ...this.toBrowseView(m),
        pendingRequests: pending
          .filter(
            (r) => r.matchId === m.id && r.openMatch?.hostId === user.id,
          )
          .map((r) => ({
            id: r.id,
            status: r.status,
            createdAt: r.createdAt,
            player: r.user,
          })),
      })),
      joined: joined.map((r) => ({
        requestId: r.id,
        status: r.status,
        requestedAt: r.createdAt,
        match: this.toBrowseView(r.openMatch),
      })),
    };
  }

  /** Project a match (+booking/slot/host) into a customer-facing view. */
  private toBrowseView(m: MatchWithIncludes) {
    const slot = m.booking.slots[0];
    const unit = slot?.bookableUnit ?? null;
    const players = m.openSpots + 1; // host + spots
    const filled = m.openMatchJoinRequests.filter(
      (r) => r.status === JoinRequestStatus.APPROVED,
    ).length;
    return {
      id: m.id,
      status: m.status,
      createdAt: m.createdAt,
      skillMin: m.skillMin,
      skillMax: m.skillMax,
      host: m.user,
      venue: unit
        ? { id: unit.venue.id, name: unit.venue.name, city: unit.venue.city }
        : null,
      court: unit ? { id: unit.id, name: unit.name } : null,
      game: unit
        ? { id: unit.gameCatalogue.id, name: unit.gameCatalogue.name }
        : null,
      time: slot ? { startsAt: slot.startsAt, endsAt: slot.endsAt } : null,
      spots: {
        total: m.openSpots,
        filled,
        remaining: Math.max(m.openSpots - filled, 0),
      },
      fee: {
        repaymentMode: m.repaymentMode,
        bookingTotal: dec(m.booking.total),
        // even share each of the `players` participants owes
        perPlayer: dec(m.booking.total).div(players),
      },
    };
  }

  /** A player requests to join an open match. */
  async requestJoin(player: RequestUser, matchId: string) {
    const match = await this.db.withTenantBypass((tx) =>
      tx.query.openMatches.findFirst({ where: eq(openMatches.id, matchId) }),
    );
    if (!match) throw new NotFoundException('Match not found');
    if (match.status !== OpenMatchStatus.OPEN) {
      throw new BadRequestException('Match is not open');
    }
    const created = await this.db.withTenantId(match.ownerId, async (tx) =>
      (
        await tx
          .insert(openMatchJoinRequests)
          .values({ id: randomUUID(), matchId, playerId: player.id })
          .returning()
      )[0],
    );

    // Notify the host that a player requested to join (best-effort, PRD §9).
    await this.notifyUser(
      match.hostId,
      'A player has requested to join your open match. Review the request in your matches.',
    );

    return created;
  }

  /**
   * Host approves a join request. When the venue uses ledger settlement, the
   * joiner repays the host their share (booking total / total players) via the
   * credit lane — throws if the joiner's wallet credit is insufficient.
   */
  async approve(host: RequestUser, matchId: string, requestId: string) {
    const match = await this.db.withTenantBypass((tx) =>
      tx.query.openMatches.findFirst({
        where: eq(openMatches.id, matchId),
        with: { booking: true },
      }),
    );
    if (!match) throw new NotFoundException('Match not found');
    if (match.hostId !== host.id) {
      throw new ForbiddenException('Only the host approves requests');
    }

    const result = await this.db.withTenantId(match.ownerId, async (tx) => {
      const req = await tx.query.openMatchJoinRequests.findFirst({
        where: eq(openMatchJoinRequests.id, requestId),
      });
      if (!req || req.matchId !== matchId) {
        throw new NotFoundException('Request not found');
      }

      // Idempotency guard: only settle/charge when the request is still in the
      // expected pending (REQUESTED) state. Once approved, re-approval must be a
      // no-op so the joiner is not double-charged / the host not double-credited
      // via the ledger. Conditionally update only still-pending rows and verify a
      // row actually transitioned before proceeding to settlement.
      const transition = await tx
        .update(openMatchJoinRequests)
        .set({ status: JoinRequestStatus.APPROVED })
        .where(
          and(
            eq(openMatchJoinRequests.id, requestId),
            eq(openMatchJoinRequests.status, JoinRequestStatus.REQUESTED),
          ),
        )
        .returning({ id: openMatchJoinRequests.id });
      if (transition.length === 0) {
        // Already approved (or otherwise not pending) — do not re-settle.
        const approvedNow = (
          await tx
            .select({ c: count() })
            .from(openMatchJoinRequests)
            .where(
              and(
                eq(openMatchJoinRequests.matchId, matchId),
                eq(openMatchJoinRequests.status, JoinRequestStatus.APPROVED),
              ),
            )
        )[0].c;
        return {
          approved: true,
          spotsFilled: approvedNow,
          openSpots: match.openSpots,
          playerId: req.playerId,
          transitioned: false,
        };
      }

      const approved = (
        await tx
          .select({ c: count() })
          .from(openMatchJoinRequests)
          .where(
            and(
              eq(openMatchJoinRequests.matchId, matchId),
              eq(openMatchJoinRequests.status, JoinRequestStatus.APPROVED),
            ),
          )
      )[0].c;

      if (match.repaymentMode === OpenMatchRepaymentMode.LEDGER) {
        const players = match.openSpots + 1; // host + spots
        const share = dec(match.booking.total).div(players);
        // joiner repays host their share
        await this.ledger.post(tx, {
          ownerId: match.ownerId,
          customerId: req.playerId,
          type: LedgerTxnType.OPEN_MATCH_SETTLE,
          amount: share.negated(),
          lane: creditLane(match.ownerId),
          refType: 'open_match',
          refId: matchId,
          note: 'Open-match share repaid to host',
        });
        await this.ledger.post(tx, {
          ownerId: match.ownerId,
          customerId: match.hostId,
          type: LedgerTxnType.OPEN_MATCH_SETTLE,
          amount: share,
          lane: creditLane(match.ownerId),
          refType: 'open_match',
          refId: matchId,
          note: 'Received open-match share from joiner',
        });
      }

      // Close the match once all spots are filled.
      if (approved >= match.openSpots) {
        await tx
          .update(openMatches)
          .set({ status: OpenMatchStatus.FULL })
          .where(eq(openMatches.id, matchId));
      }
      return {
        approved: true,
        spotsFilled: approved,
        openSpots: match.openSpots,
        playerId: req.playerId,
        transitioned: true,
      };
    });

    // Notify the player their join was approved (best-effort, only on a real
    // transition so a re-approval does not double-notify). PRD §9.
    if (result.transitioned) {
      await this.notifyUser(
        result.playerId,
        'Your request to join the open match has been approved. See you on court!',
      );
    }

    // Strip internal fields from the public response shape.
    return {
      approved: result.approved,
      spotsFilled: result.spotsFilled,
      openSpots: result.openSpots,
    };
  }

  /**
   * Host rejects a pending join request. Idempotent: only acts on a request
   * still in REQUESTED state (already-rejected/approved requests are no-ops).
   */
  async reject(host: RequestUser, matchId: string, requestId: string) {
    const match = await this.db.withTenantBypass((tx) =>
      tx.query.openMatches.findFirst({ where: eq(openMatches.id, matchId) }),
    );
    if (!match) throw new NotFoundException('Match not found');
    if (match.hostId !== host.id) {
      throw new ForbiddenException('Only the host rejects requests');
    }

    const result = await this.db.withTenantId(match.ownerId, async (tx) => {
      const req = await tx.query.openMatchJoinRequests.findFirst({
        where: eq(openMatchJoinRequests.id, requestId),
      });
      if (!req || req.matchId !== matchId) {
        throw new NotFoundException('Request not found');
      }

      // Idempotency: only transition still-pending requests to REJECTED.
      const transition = await tx
        .update(openMatchJoinRequests)
        .set({ status: JoinRequestStatus.REJECTED })
        .where(
          and(
            eq(openMatchJoinRequests.id, requestId),
            eq(openMatchJoinRequests.status, JoinRequestStatus.REQUESTED),
          ),
        )
        .returning({ id: openMatchJoinRequests.id });
      return {
        rejected: true,
        changed: transition.length > 0,
        playerId: req.playerId,
      };
    });

    // Notify the player their request was declined (best-effort, only on a real
    // transition). PRD §9.
    if (result.changed) {
      await this.notifyUser(
        result.playerId,
        'Your request to join the open match was not accepted this time.',
      );
    }

    return { rejected: result.rejected, changed: result.changed };
  }

  /**
   * Host cancels their match. Marks it cancelled and prevents new joins.
   * If any ledger-settled (approved) repayments already exist, cancellation is
   * blocked — reversing append-only settlement is out of scope here.
   */
  async cancel(host: RequestUser, matchId: string) {
    const match = await this.db.withTenantBypass((tx) =>
      tx.query.openMatches.findFirst({ where: eq(openMatches.id, matchId) }),
    );
    if (!match) throw new NotFoundException('Match not found');
    if (match.hostId !== host.id) {
      throw new ForbiddenException('Only the host can cancel this match');
    }

    const affectedPlayers = await this.db.withTenantId(
      match.ownerId,
      async (tx) => {
        if (
          match.status === OpenMatchStatus.CANCELLED ||
          match.status === OpenMatchStatus.COMPLETED
        ) {
          throw new BadRequestException(`Match is already ${match.status}`);
        }

        // Block cancellation when repayments have been settled through the
        // ledger — those entries are append-only and reversing them is out of
        // scope. Surface a clear conflict rather than silently leaving the
        // ledger inconsistent.
        const settledCount = (
          await tx
            .select({ c: count() })
            .from(ledgerTxns)
            .where(
              and(
                eq(ledgerTxns.type, LedgerTxnType.OPEN_MATCH_SETTLE),
                eq(ledgerTxns.refType, 'open_match'),
                eq(ledgerTxns.refId, matchId),
              ),
            )
        )[0].c;
        if (settledCount > 0) {
          throw new ConflictException(
            'Match has settled ledger repayments; cancellation/reversal is out of scope',
          );
        }

        // Capture players with an active (approved/requested) interest so we can
        // tell them the match is off (best-effort, after the tx commits).
        const requests = await tx.query.openMatchJoinRequests.findMany({
          where: and(
            eq(openMatchJoinRequests.matchId, matchId),
            inArray(openMatchJoinRequests.status, [
              JoinRequestStatus.APPROVED,
              JoinRequestStatus.REQUESTED,
            ]),
          ),
          columns: { playerId: true },
        });

        await tx
          .update(openMatches)
          .set({ status: OpenMatchStatus.CANCELLED })
          .where(eq(openMatches.id, matchId));
        return requests.map((r) => r.playerId);
      },
    );

    // Notify affected players the match was cancelled (best-effort, PRD §9).
    for (const playerId of new Set(affectedPlayers)) {
      await this.notifyUser(
        playerId,
        'An open match you joined or requested has been cancelled by the host.',
      );
    }

    return { cancelled: true };
  }
}

@Controller('open-matches')
@UseGuards(RolesGuard, FeatureFlagGuard)
@Roles(UserRole.CUSTOMER)
export class OpenMatchesController {
  constructor(private readonly matches: OpenMatchesService) {}

  @Get()
  browse(@Query('venueId') venueId?: string) {
    return this.matches.browse(venueId);
  }

  @Get('mine')
  mine(@CurrentUser() user: RequestUser) {
    return this.matches.mine(user);
  }

  @Post()
  @RequireFlag(FeatureFlag.OPEN_MATCHES)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateMatchDto) {
    return this.matches.create(user, dto);
  }

  @Post(':id/join')
  join(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.matches.requestJoin(user, id);
  }

  @Post(':id/requests/:requestId/approve')
  @RequireFlag(FeatureFlag.OPEN_MATCHES)
  approve(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('requestId') requestId: string,
  ) {
    return this.matches.approve(user, id, requestId);
  }

  @Post(':id/requests/:requestId/reject')
  @RequireFlag(FeatureFlag.OPEN_MATCHES)
  reject(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('requestId') requestId: string,
  ) {
    return this.matches.reject(user, id, requestId);
  }

  @Post(':id/cancel')
  @RequireFlag(FeatureFlag.OPEN_MATCHES)
  cancel(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.matches.cancel(user, id);
  }
}

@Module({
  controllers: [OpenMatchesController],
  providers: [OpenMatchesService],
})
export class OpenMatchesModule {}
