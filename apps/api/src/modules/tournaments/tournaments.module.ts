import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import {
  FeatureFlag,
  FeeBasis,
  LedgerTxnType,
  RegistrationType,
  TournamentFormat,
  UserRole,
} from '@sportsbooking/shared';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
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
import { PaymentLedgerService } from '../payments/payment-ledger.service';
import {
  RecordResultDto,
  TournamentFixturesService,
} from './tournament-fixtures.service';
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
  /** Team-event roster: player names (TEAM regType). */
  @IsOptional() @IsArray() @IsString({ each: true }) roster?: string[];
}

class ConfirmParticipantDto {
  // Gateway handshake fields. When a razorpayPaymentId is presented it MUST come
  // with the order id it settles and the signature, so the handshake can be
  // verified against the participant's stored razorpayOrderId before we mark
  // paid (mirrors bookings.confirmPayment — SEC: never trust a client-supplied
  // payment id without verifying the gateway signature).
  @IsOptional() @IsString() razorpayOrderId?: string;
  @IsOptional() @IsString() razorpayPaymentId?: string;
  @IsOptional() @IsString() razorpaySignature?: string;
}

/** Trim + drop empty roster entries; null when none provided. */
function normalizeRoster(roster?: string[]): string[] | null {
  if (!roster) return null;
  const cleaned = roster.map((s) => s.trim()).filter(Boolean);
  return cleaned.length ? cleaned : null;
}

/**
 * Derived lifecycle status for the owner back-office list. There is no stored
 * status column — open/closed has always been derived from regCloseAt — so the
 * four buckets below are computed from the dates each time. Every tournament
 * maps to exactly one bucket (priority order: completed → in_progress →
 * closing_soon → open):
 *  - completed:    the event's last day has passed.
 *  - in_progress:  entries are locked (cut-off passed, or the event has started)
 *                  and it is not yet completed — i.e. underway or about to play.
 *  - closing_soon: still accepting entries, with the cut-off within a week.
 *  - open:         still accepting entries, cut-off not imminent.
 */
export type OwnerTournamentStatus =
  | 'open'
  | 'closing_soon'
  | 'in_progress'
  | 'completed';

/** Cut-off proximity (days) below which an open tournament reads "closing soon". */
const CLOSING_SOON_DAYS = 7;

/** Local-midnight date string (YYYY-MM-DD), matching how `date` columns store. */
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function deriveTournamentStatus(
  t: { startDate: string; endDate: string; regCloseAt: Date | null },
  now: Date,
): OwnerTournamentStatus {
  const today = toDateStr(now);
  if (today > t.endDate) return 'completed';

  // Entries close at the explicit cut-off, or implicitly once play begins.
  const cutoffPassed = t.regCloseAt != null && t.regCloseAt.getTime() < now.getTime();
  const started = today >= t.startDate;
  if (cutoffPassed || started) return 'in_progress';

  if (t.regCloseAt) {
    const days = Math.ceil(
      (t.regCloseAt.getTime() - now.getTime()) / 86_400_000,
    );
    if (days <= CLOSING_SOON_DAYS) return 'closing_soon';
  }
  return 'open';
}

/** Paginated/filterable owner tournaments list query (back-office list page). */
class OwnerTournamentListQueryDto {
  /** Scope to one venue; omitted = across all the owner's venues. */
  @IsOptional() @IsUUID() venueId?: string;

  /** Free-text match on tournament name (ilike). */
  @IsOptional() @IsString() q?: string;

  /** Lifecycle bucket filter (see deriveTournamentStatus). */
  @IsOptional()
  @IsIn(['open', 'closing_soon', 'in_progress', 'completed'])
  status?: OwnerTournamentStatus;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
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
    private readonly paymentLedger: PaymentLedgerService,
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
   * Paginated, filterable owner list for the back-office master view. Unlike
   * listForOwner(), this returns LIGHTWEIGHT rows — tournament metadata + the
   * venue name + participant counts (via subqueries), NOT the full participant
   * roster — so the list never over-fetches as the catalogue grows. Participant
   * detail is fetched per-tournament by getForOwner() when a row is opened.
   *
   * The lifecycle status is derived per row (no stored column), so — like the
   * grounds list's derived statuses — the matching set is evaluated, then the
   * status filter + pagination are applied in memory. q (name) and venueId are
   * pushed to SQL. Owner-scoped + tenant-scoped via withTenant.
   */
  listForOwnerPaged(ownerId: string, query: OwnerTournamentListQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 12;

    return this.db.withTenant(async (tx) => {
      const filters = [eq(tournaments.ownerId, ownerId)];
      if (query.venueId) filters.push(eq(tournaments.venueId, query.venueId));
      if (query.q) filters.push(ilike(tournaments.name, `%${query.q}%`));

      const rows = await tx.query.tournaments.findMany({
        where: and(...filters),
        with: { venue: { columns: { name: true } } },
        orderBy: desc(tournaments.createdAt),
      });

      // Participant tallies in one grouped pass. A correlated subquery via the
      // relational builder's `extras` mis-aliases the participant table once a
      // `with` relation is joined, so count separately and map by tournament id.
      const ids = rows.map((r) => r.id);
      const countRows = ids.length
        ? await tx
            .select({
              tournamentId: tournamentParticipants.tournamentId,
              total: sql<number>`COUNT(*)::int`,
              paid: sql<number>`COUNT(*) FILTER (WHERE ${tournamentParticipants.paid})::int`,
            })
            .from(tournamentParticipants)
            .where(inArray(tournamentParticipants.tournamentId, ids))
            .groupBy(tournamentParticipants.tournamentId)
        : [];
      const countById = new Map(countRows.map((c) => [c.tournamentId, c]));

      const now = new Date();
      const items = rows.map(({ venue, ...t }) => {
        const c = countById.get(t.id);
        return {
          id: t.id,
          name: t.name,
          venueId: t.venueId,
          venueName: venue?.name ?? null,
          format: t.format,
          regType: t.regType,
          capacity: t.capacity,
          startDate: t.startDate,
          endDate: t.endDate,
          regCloseAt: t.regCloseAt,
          refundAllowedAfterClose: t.refundAllowedAfterClose,
          entries: Number(c?.total ?? 0),
          paidEntries: Number(c?.paid ?? 0),
          status: deriveTournamentStatus(t, now),
        };
      });

      // Tab counts + headline summary are tallied over the whole q/venue-scoped
      // set (before the status filter) so the tabs always show the full
      // distribution and the stats strip stays stable as tabs are switched.
      const counts = { open: 0, closing_soon: 0, in_progress: 0, completed: 0 };
      let entries = 0;
      let paidEntries = 0;
      let capacity = 0;
      for (const i of items) {
        counts[i.status] += 1;
        entries += i.entries;
        paidEntries += i.paidEntries;
        capacity += i.capacity;
      }

      const filtered = query.status
        ? items.filter((i) => i.status === query.status)
        : items;
      const start = (page - 1) * pageSize;
      return {
        items: filtered.slice(start, start + pageSize),
        total: filtered.length,
        counts: { ...counts, all: items.length },
        summary: { entries, paidEntries, capacity },
      };
    });
  }

  /**
   * Single owner tournament WITH its participants (captain PII) for the detail
   * drawer. Tenant-scoped, plus an explicit ownerId match (defense in depth,
   * mirroring cancelRegistration) so an owner only ever opens their own.
   */
  getForOwner(ownerId: string, tournamentId: string) {
    return this.db.withTenant(async (tx) => {
      const row = await tx.query.tournaments.findFirst({
        where: and(
          eq(tournaments.id, tournamentId),
          eq(tournaments.ownerId, ownerId),
        ),
        with: {
          venue: { columns: { name: true } },
          tournamentParticipants: {
            orderBy: asc(tournamentParticipants.createdAt),
          },
        },
      });
      if (!row) throw new NotFoundException('Tournament not found');

      const { venue, tournamentParticipants: participants, ...t } = row;
      return {
        ...t,
        venueName: venue?.name ?? null,
        status: deriveTournamentStatus(t, new Date()),
        participants,
        entries: participants.length,
        paidEntries: participants.filter((p) => p.paid).length,
        _count: { participants: participants.length },
      };
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
            roster: normalizeRoster(dto.roster),
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
    payment?: {
      razorpayOrderId?: string;
      razorpayPaymentId?: string;
      razorpaySignature?: string;
    },
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

      // SEC: a presented gateway payment id MUST be verified — never trust a
      // client-supplied razorpayPaymentId. When one is supplied we require the
      // order id + signature, bind the presented order to the participant's
      // STORED razorpayOrderId, and verify the handshake signature before
      // marking paid (mirrors bookings.service.confirmPayment exactly). Absent a
      // payment id this is an owner/staff manual/offline settlement.
      const razorpayPaymentId = payment?.razorpayPaymentId;
      const isGatewaySettlement = !!razorpayPaymentId;
      if (isGatewaySettlement) {
        if (!payment?.razorpayOrderId || !payment?.razorpaySignature) {
          throw new BadRequestException('Payment order and signature are required');
        }
        // The order presented must be the one we created for this participant —
        // stops a valid signature for some other order settling this entry.
        if (
          !p.razorpayOrderId ||
          p.razorpayOrderId !== payment.razorpayOrderId
        ) {
          throw new BadRequestException(
            'Payment order does not match this participant',
          );
        }
        const ok = this.payments.verifyPaymentSignature(
          payment.razorpayOrderId,
          razorpayPaymentId,
          payment.razorpaySignature,
        );
        if (!ok) throw new BadRequestException('Invalid payment signature');
      }

      const updated = (
        await tx
          .update(tournamentParticipants)
          .set({
            paid: true,
            // Persist the captured gateway payment id so a later cancellation
            // can refund against it (BUG-3). Only set on the verified handshake.
            ...(isGatewaySettlement ? { razorpayPaymentId } : {}),
          })
          .where(eq(tournamentParticipants.id, participantId))
          .returning()
      )[0];

      // Gateway settlement: record the real capture against the verified payment
      // id (gateway-ledger 'capture' row, mirroring bookings). A manual/offline
      // settlement (owner/staff, no gateway handshake) must NOT fabricate a
      // 'capture' gateway-ledger row for an unverified payment — it is recorded
      // explicitly as a manual settlement on the append-only payment ledger
      // (no gatewayId, status 'manual') so it is reconcilable yet never mistaken
      // for a verified gateway capture.
      if (isGatewaySettlement) {
        await this.paymentLedger.record(tx, {
          ownerId,
          refType: 'tournament_participant',
          refId: participantId,
          type: 'capture',
          gatewayId: razorpayPaymentId,
          amount: t.fee,
          status: 'captured',
        });
      } else {
        await this.paymentLedger.record(tx, {
          ownerId,
          refType: 'tournament_participant',
          refId: participantId,
          type: 'capture',
          // No gateway id: this is an offline/manual settlement, not a gateway
          // capture. The 'manual' status distinguishes it from a verified
          // gateway capture for reconciliation.
          gatewayId: null,
          amount: t.fee,
          status: 'manual',
        });
      }

      return updated;
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
    let refundStatus = 'skipped';
    if (fee > 0) {
      // BUG-3: refund against the captured gateway payment id (mirrors
      // booking.razorpayPaymentId). Fall back to the order id, then the
      // participant id, only when no payment id was captured (e.g. legacy rows
      // or the dev mock flow) so the dev/mock path keeps working.
      const refundRef =
        p.razorpayPaymentId ?? p.razorpayOrderId ?? participantId;
      const res = await this.payments.refund(refundRef, fee);
      gatewayId = res.id;
      refundStatus = res.status;
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
        await this.paymentLedger.record(tx, {
          ownerId: t.ownerId,
          customerId: customer.id,
          refType: 'tournament_participant',
          refId: participantId,
          type: 'refund',
          gatewayId,
          amount: fee,
          status: refundStatus,
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
  constructor(
    private readonly tournaments: TournamentsService,
    private readonly fixtures: TournamentFixturesService,
  ) {}

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

  /**
   * Paginated, filterable owner master list (lightweight rows; no participant
   * roster). Backs the back-office tournaments list page. Scoped to the
   * caller's owner; supports venueId, q (name), status, page, pageSize.
   */
  @UseGuards(RolesGuard, FeatureFlagGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @RequireFlag(FeatureFlag.TOURNAMENTS)
  @Get('manage')
  listForOwnerPaged(
    @CurrentUser() user: RequestUser,
    @Query() query: OwnerTournamentListQueryDto,
  ) {
    return this.tournaments.listForOwnerPaged(user.ownerId!, query);
  }

  /**
   * Single owner tournament with participant detail (captain PII), fetched on
   * demand when a row is opened. The two-segment path keeps it distinct from
   * the three-segment manage/venue/:venueId route above.
   */
  @UseGuards(RolesGuard, FeatureFlagGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @RequireFlag(FeatureFlag.TOURNAMENTS)
  @Get('manage/:id')
  getForOwner(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.tournaments.getForOwner(user.ownerId!, id);
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
    return this.tournaments.markPaid(user.ownerId!, id, participantId, {
      razorpayOrderId: dto?.razorpayOrderId,
      razorpayPaymentId: dto?.razorpayPaymentId,
      razorpaySignature: dto?.razorpaySignature,
    });
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

  /** Generate the draw/schedule from the paid participants (owner only). */
  @UseGuards(RolesGuard, FeatureFlagGuard)
  @Roles(UserRole.OWNER)
  @RequireFlag(FeatureFlag.TOURNAMENTS)
  @Post(':id/fixtures')
  generateFixtures(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.fixtures.generate(user.ownerId!, id);
  }

  /** Clear all fixtures so they can be regenerated (owner only). */
  @UseGuards(RolesGuard, FeatureFlagGuard)
  @Roles(UserRole.OWNER)
  @RequireFlag(FeatureFlag.TOURNAMENTS)
  @Delete(':id/fixtures')
  clearFixtures(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.fixtures.clear(user.ownerId!, id);
  }

  /** The fixtures board: matches by round + standings. */
  @UseGuards(RolesGuard, FeatureFlagGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @RequireFlag(FeatureFlag.TOURNAMENTS)
  @Get(':id/fixtures')
  board(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.fixtures.getBoard(user.ownerId!, id);
  }

  /** Record a match result; advances the winner in a knockout bracket. */
  @UseGuards(RolesGuard, FeatureFlagGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @RequireFlag(FeatureFlag.TOURNAMENTS)
  @Post(':id/matches/:matchId/result')
  recordResult(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() dto: RecordResultDto,
  ) {
    return this.fixtures.recordResult(user.ownerId!, id, matchId, dto);
  }
}

@Module({
  imports: [NotificationFeedModule],
  controllers: [TournamentsController],
  providers: [TournamentsService, TournamentFixturesService],
})
export class TournamentsModule {}
