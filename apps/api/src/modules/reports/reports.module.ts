import {
  Controller,
  Get,
  Injectable,
  Module,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  and,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  sql,
  sum,
  type SQL,
} from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { PaymentStatus, UserRole } from '@sportsbooking/shared';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DbService } from '../../db/db.service';
import type { DbTx } from '../../db';
import { Decimal, dec } from '../../db/money';
import {
  bookableUnits,
  bookingAddons,
  bookings,
  gameCatalogue,
  ledgerTxns,
  owners,
  ownerCustomers,
  referrals,
  slots,
  tournamentParticipants,
  tournaments,
  venues,
} from '../../db/schema';

const PAID_STATES = [PaymentStatus.PAID, PaymentStatus.SETTLED_AT_VENUE];

/**
 * Resolve an optional ?from=&to= date range into a normalised window.
 *
 * Both bounds are optional and parsed leniently (any value `new Date` accepts,
 * e.g. "2026-01-01"); invalid values are ignored so the endpoint stays
 * backward-compatible (default = all time). `to` is treated as inclusive of the
 * whole day when given as a bare date by snapping to end-of-day.
 */
function parseRange(from?: string, to?: string): { from: Date | null; to: Date | null } {
  const parse = (v: string | undefined): Date | null => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const fromD = parse(from);
  let toD = parse(to);
  // bare "YYYY-MM-DD" parses to UTC midnight; make `to` inclusive of that day.
  if (toD && /^\d{4}-\d{2}-\d{2}$/.test(to ?? '')) {
    toD = new Date(toD.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
  return { from: fromD, to: toD };
}

/**
 * Build a list of SQL bound conditions (gte/lte) on a timestamp column for the
 * given range, or `[]` when the range is unbounded. Drizzle's `and(...)` skips
 * undefined entries, so an empty list contributes no filter.
 */
function dateConds(
  column: PgColumn,
  range: { from: Date | null; to: Date | null },
): SQL[] {
  const conds: SQL[] = [];
  if (range.from) conds.push(gte(column, range.from));
  if (range.to) conds.push(lte(column, range.to));
  return conds;
}

/** Hours between two "HH:mm" strings; clamped to >= 0. */
function operatingHours(openTime: string, closeTime: string): number {
  const toMin = (t: string): number => {
    const [h, m] = t.split(':').map((n) => Number(n));
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  return Math.max(0, (toMin(closeTime) - toMin(openTime)) / 60);
}

/**
 * Number of days covered by the range. When unbounded we fall back to the span
 * between the earliest reference date and now so occupancy stays meaningful.
 */
function rangeDays(from: Date | null, to: Date | null, fallbackFrom: Date): number {
  const start = from ?? fallbackFrom;
  const end = to ?? new Date();
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/**
 * Reports (PRD §4.11): bookings, revenue, occupancy, membership liability,
 * add-on revenue and player growth — per venue and consolidated. Plus a
 * platform-wide aggregate for Super Admin (PRD §3.3).
 */
@Injectable()
export class ReportsService {
  constructor(private readonly db: DbService) {}

  async ownerSummary(user: RequestUser, from?: string, to?: string) {
    const range = parseRange(from, to);
    // Tenant isolation: RLS is not forced in production (the API connects as the
    // table owner), so withTenant's session var does NOT filter rows — every
    // aggregate below must carry an explicit ownerId predicate. Folding it into
    // the shared condition arrays scopes all the bookings/slots/ledger queries.
    const ownerId = user.ownerId!;
    // Bookings created in range (used by most revenue/offer/repeat metrics).
    const bookedConds = [
      eq(bookings.ownerId, ownerId),
      ...dateConds(bookings.createdAt, range),
    ];
    // Slots are scoped by their actual start time (when play happens).
    const slotConds = [
      eq(slots.ownerId, ownerId),
      ...dateConds(slots.startsAt, range),
    ];

    return this.db.withTenant(async (tx) => {
      const [bookingCount, cancelled] = await Promise.all([
        tx
          .select({ c: count() })
          .from(bookings)
          .where(and(...bookedConds))
          .then((r) => r[0].c),
        tx
          .select({ c: count() })
          .from(bookings)
          .where(and(eq(bookings.status, 'cancelled'), ...bookedConds))
          .then((r) => r[0].c),
      ]);

      const revenue = Number(
        dec(
          (
            await tx
              .select({ s: sum(bookings.total) })
              .from(bookings)
              .where(
                and(
                  inArray(bookings.paymentStatus, PAID_STATES),
                  ...bookedConds,
                ),
              )
          )[0].s ?? '0',
        ),
      );

      // Outstanding membership liability = net unspent pack sessions across the
      // append-only ledger (sum of signed amounts on pack lanes). Liability is a
      // point-in-time figure, so it is intentionally not range-filtered.
      const liabilityRows = await tx
        .select({ amount: ledgerTxns.amount })
        .from(ledgerTxns)
        .where(
          and(
            eq(ledgerTxns.ownerId, ownerId),
            sql`${ledgerTxns.lane} LIKE 'pack:%'`,
          ),
        );
      const outstandingSessions = liabilityRows.reduce(
        (acc, r) => acc.add(dec(r.amount)),
        new Decimal(0),
      );

      // add-on revenue: sum of unit prices for add-ons on in-range bookings.
      const addonRevenue = Number(
        dec(
          (
            await tx
              .select({ s: sum(bookingAddons.unitPrice) })
              .from(bookingAddons)
              .innerJoin(bookings, eq(bookingAddons.bookingId, bookings.id))
              .where(and(...bookedConds))
          )[0].s ?? '0',
        ),
      );

      const [players, packSales, bookedSlots] = await Promise.all([
        tx
          .select({ c: count() })
          .from(ownerCustomers)
          .where(eq(ownerCustomers.ownerId, ownerId))
          .then((r) => r[0].c),
        tx
          .select({ c: count() })
          .from(ledgerTxns)
          .where(
            and(
              eq(ledgerTxns.ownerId, ownerId),
              eq(ledgerTxns.type, 'pack_buy'),
              ...dateConds(ledgerTxns.createdAt, range),
            ),
          )
          .then((r) => r[0].c),
        tx
          .select({ c: count() })
          .from(slots)
          .where(and(eq(slots.status, 'booked'), ...slotConds))
          .then((r) => r[0].c),
      ]);

      // per-venue revenue breakdown (+ venue names via a follow-up lookup)
      const byVenue = await tx
        .select({
          venueId: bookings.venueId,
          total: sum(bookings.total),
          count: count(),
        })
        .from(bookings)
        .where(and(inArray(bookings.paymentStatus, PAID_STATES), ...bookedConds))
        .groupBy(bookings.venueId);
      const venueRows = await tx
        .select({
          id: venues.id,
          name: venues.name,
          openTime: venues.openTime,
          closeTime: venues.closeTime,
        })
        .from(venues)
        .where(eq(venues.ownerId, ownerId));
      const venueName = new Map(venueRows.map((v) => [v.id, v.name]));

      // --- occupancy: booked slots ÷ available slot-capacity over the range ---
      const units = await tx
        .select({
          openTime: venues.openTime,
          closeTime: venues.closeTime,
          slotGranularityMin: gameCatalogue.slotGranularityMin,
        })
        .from(bookableUnits)
        .innerJoin(venues, eq(bookableUnits.venueId, venues.id))
        .innerJoin(gameCatalogue, eq(bookableUnits.gameId, gameCatalogue.id))
        .where(
          and(
            eq(bookableUnits.active, true),
            eq(bookableUnits.ownerId, ownerId),
          ),
        );
      const earliestUnit = await tx
        .select({ createdAt: bookableUnits.createdAt })
        .from(bookableUnits)
        .where(eq(bookableUnits.ownerId, ownerId))
        .orderBy(bookableUnits.createdAt)
        .limit(1);
      const days = rangeDays(
        range.from,
        range.to,
        earliestUnit[0]?.createdAt ?? new Date(),
      );
      let availableCapacity = 0;
      for (const u of units) {
        const hours = operatingHours(u.openTime, u.closeTime);
        const gran = u.slotGranularityMin || 60;
        availableCapacity += Math.floor((hours * 60) / gran) * days;
      }
      const occupancyPct =
        availableCapacity > 0
          ? Math.min(100, Math.round((bookedSlots / availableCapacity) * 1000) / 10)
          : 0;

      // --- peak hour + per-hour histogram (over booked slots in range) ---
      const slotRows = await tx
        .select({ startsAt: slots.startsAt })
        .from(slots)
        .where(and(eq(slots.status, 'booked'), ...slotConds));
      const histogram = new Array(24).fill(0) as number[];
      for (const s of slotRows) histogram[s.startsAt.getHours()] += 1;
      const hourHistogram = histogram.map((count, hour) => ({
        hour: `${String(hour).padStart(2, '0')}:00`,
        count,
      }));
      let peakHour: string | null = null;
      let peakCount = -1;
      histogram.forEach((count, hour) => {
        if (count > peakCount) {
          peakCount = count;
          peakHour = `${String(hour).padStart(2, '0')}:00`;
        }
      });
      if (peakCount <= 0) peakHour = null;

      // --- loyalty points (earned/redeemed) over the range ---
      const ledgerConds = [
        eq(ledgerTxns.ownerId, ownerId),
        ...dateConds(ledgerTxns.createdAt, range),
      ];
      const [earnedSum, redeemedSum] = await Promise.all([
        tx
          .select({ s: sum(ledgerTxns.amount) })
          .from(ledgerTxns)
          .where(and(eq(ledgerTxns.type, 'points_earn'), ...ledgerConds))
          .then((r) => r[0].s),
        tx
          .select({ s: sum(ledgerTxns.amount) })
          .from(ledgerTxns)
          .where(and(eq(ledgerTxns.type, 'points_redeem'), ...ledgerConds))
          .then((r) => r[0].s),
      ]);
      // redeem amounts are stored as negative debits; report the magnitude.
      const loyalty = {
        earned: Number(earnedSum ?? 0),
        redeemed: Math.abs(Number(redeemedSum ?? 0)),
      };

      // --- referrals over the range ---
      const [referralCount, rewardSum] = await Promise.all([
        tx
          .select({ c: count() })
          .from(referrals)
          .where(
            and(
              eq(referrals.ownerId, ownerId),
              ...dateConds(referrals.createdAt, range),
            ),
          )
          .then((r) => r[0].c),
        tx
          .select({ s: sum(ledgerTxns.amount) })
          .from(ledgerTxns)
          .where(and(eq(ledgerTxns.type, 'referral_reward'), ...ledgerConds))
          .then((r) => r[0].s),
      ]);
      const referral = {
        referrals: referralCount,
        rewardsPaid: Number(rewardSum ?? 0),
      };

      // --- offer redemptions over the range ---
      const offerAgg = (
        await tx
          .select({ count: count(), discount: sum(bookings.discount) })
          .from(bookings)
          .where(and(isNotNull(bookings.offerId), ...bookedConds))
      )[0];
      const offers = {
        redemptions: offerAgg.count,
        discountTotal: Number(offerAgg.discount ?? 0),
      };

      // --- tournaments over the range (by start date) ---
      // startDate is a DATE column (string); compare against date-only bounds.
      const startConds: SQL[] = [];
      if (range.from) {
        startConds.push(gte(tournaments.startDate, range.from.toISOString().slice(0, 10)));
      }
      if (range.to) {
        startConds.push(lte(tournaments.startDate, range.to.toISOString().slice(0, 10)));
      }
      const tournamentRows = await tx.query.tournaments.findMany({
        where: and(eq(tournaments.ownerId, ownerId), ...startConds),
        columns: { fee: true },
        with: {
          tournamentParticipants: { columns: { paid: true } },
        },
      });
      let participants = 0;
      let feeRevenue = new Decimal(0);
      for (const t of tournamentRows) {
        participants += t.tournamentParticipants.length;
        const paid = t.tournamentParticipants.filter((p) => p.paid).length;
        feeRevenue = feeRevenue.add(dec(t.fee).mul(paid));
      }
      const tournaments_ = {
        count: tournamentRows.length,
        participants,
        feeRevenue: Number(feeRevenue),
      };

      // --- repeat rate: % of owner's customers with > 1 booking ---
      const [totalCustomers, repeatCustomers] = await Promise.all([
        tx
          .select({ c: count() })
          .from(ownerCustomers)
          .where(eq(ownerCustomers.ownerId, ownerId))
          .then((r) => r[0].c),
        tx
          .select({ c: count() })
          .from(ownerCustomers)
          .where(
            and(
              eq(ownerCustomers.ownerId, ownerId),
              sql`${ownerCustomers.bookingCount} > 1`,
            ),
          )
          .then((r) => r[0].c),
      ]);
      const repeatRatePct =
        totalCustomers > 0
          ? Math.round((repeatCustomers / totalCustomers) * 1000) / 10
          : 0;

      return {
        range: {
          from: range.from ? range.from.toISOString() : null,
          to: range.to ? range.to.toISOString() : null,
        },
        bookings: { total: bookingCount, cancelled },
        revenue,
        bookedSlots,
        membership: {
          packsSold: packSales,
          outstandingSessions: Number(outstandingSessions),
        },
        addonRevenue,
        players,
        occupancyPct,
        peakHour,
        hourHistogram,
        loyalty,
        referral,
        offers,
        tournaments: tournaments_,
        repeatRatePct,
        perVenue: byVenue.map((v) => ({
          venueId: v.venueId,
          venueName: venueName.get(v.venueId) ?? null,
          revenue: Number(v.total ?? 0),
          bookings: v.count,
        })),
      };
    });
  }

  /** Platform-wide read-only aggregate (Super Admin). */
  async platformSummary(from?: string, to?: string) {
    const range = parseRange(from, to);
    const bookedConds = dateConds(bookings.createdAt, range);
    const slotConds = dateConds(slots.startsAt, range);

    return this.db.withTenantBypass(async (tx) => {
      const [owners_, venues_, bookingsCount] = await Promise.all([
        tx
          .select({ c: count() })
          .from(owners)
          .then((r) => r[0].c),
        tx
          .select({ c: count() })
          .from(venues)
          .then((r) => r[0].c),
        tx
          .select({ c: count() })
          .from(bookings)
          .where(and(...bookedConds))
          .then((r) => r[0].c),
      ]);
      const grossRevenue = Number(
        dec(
          (
            await tx
              .select({ s: sum(bookings.total) })
              .from(bookings)
              .where(
                and(
                  inArray(bookings.paymentStatus, PAID_STATES),
                  ...bookedConds,
                ),
              )
          )[0].s ?? '0',
        ),
      );

      // --- platform occupancy (cheap aggregate across all units) ---
      const [bookedSlots, venueRows, unitRows, earliestUnit] = await Promise.all([
        tx
          .select({ c: count() })
          .from(slots)
          .where(and(eq(slots.status, 'booked'), ...slotConds))
          .then((r) => r[0].c),
        tx
          .select({
            id: venues.id,
            openTime: venues.openTime,
            closeTime: venues.closeTime,
          })
          .from(venues),
        tx
          .select({
            venueId: bookableUnits.venueId,
            slotGranularityMin: gameCatalogue.slotGranularityMin,
          })
          .from(bookableUnits)
          .innerJoin(gameCatalogue, eq(bookableUnits.gameId, gameCatalogue.id))
          .where(eq(bookableUnits.active, true)),
        tx
          .select({ createdAt: bookableUnits.createdAt })
          .from(bookableUnits)
          .orderBy(bookableUnits.createdAt)
          .limit(1),
      ]);
      const venueHours = new Map(
        venueRows.map((v) => [v.id, operatingHours(v.openTime, v.closeTime)]),
      );
      const days = rangeDays(
        range.from,
        range.to,
        earliestUnit[0]?.createdAt ?? new Date(),
      );
      let availableCapacity = 0;
      for (const u of unitRows) {
        const hours = venueHours.get(u.venueId) ?? 0;
        const gran = u.slotGranularityMin || 60;
        availableCapacity += Math.floor((hours * 60) / gran) * days;
      }
      const occupancyPct =
        availableCapacity > 0
          ? Math.min(100, Math.round((bookedSlots / availableCapacity) * 1000) / 10)
          : 0;

      // --- platform repeat rate ---
      const [totalCustomers, repeatCustomers] = await Promise.all([
        tx
          .select({ c: count() })
          .from(ownerCustomers)
          .then((r) => r[0].c),
        tx
          .select({ c: count() })
          .from(ownerCustomers)
          .where(sql`${ownerCustomers.bookingCount} > 1`)
          .then((r) => r[0].c),
      ]);
      const repeatRatePct =
        totalCustomers > 0
          ? Math.round((repeatCustomers / totalCustomers) * 1000) / 10
          : 0;

      // --- platform loyalty + offer activity ---
      const ledgerConds = dateConds(ledgerTxns.createdAt, range);
      const [earnedSum, redeemedSum, offerAgg] = await Promise.all([
        tx
          .select({ s: sum(ledgerTxns.amount) })
          .from(ledgerTxns)
          .where(and(eq(ledgerTxns.type, 'points_earn'), ...ledgerConds))
          .then((r) => r[0].s),
        tx
          .select({ s: sum(ledgerTxns.amount) })
          .from(ledgerTxns)
          .where(and(eq(ledgerTxns.type, 'points_redeem'), ...ledgerConds))
          .then((r) => r[0].s),
        tx
          .select({ count: count(), discount: sum(bookings.discount) })
          .from(bookings)
          .where(and(isNotNull(bookings.offerId), ...bookedConds))
          .then((r) => r[0]),
      ]);

      return {
        range: {
          from: range.from ? range.from.toISOString() : null,
          to: range.to ? range.to.toISOString() : null,
        },
        owners: owners_,
        venues: venues_,
        bookings: bookingsCount,
        grossRevenue,
        occupancyPct,
        repeatRatePct,
        loyalty: {
          earned: Number(earnedSum ?? 0),
          redeemed: Math.abs(Number(redeemedSum ?? 0)),
        },
        offers: {
          redemptions: offerAgg.count,
          discountTotal: Number(offerAgg.discount ?? 0),
        },
      };
    });
  }
}

@Controller('reports')
@UseGuards(RolesGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('owner')
  @Roles(UserRole.OWNER)
  ownerSummary(
    @CurrentUser() user: RequestUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.ownerSummary(user, from, to);
  }

  @Get('platform')
  @Roles(UserRole.SUPER_ADMIN)
  platformSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.platformSummary(from, to);
  }
}

@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
