import {
  Controller,
  Get,
  Injectable,
  Module,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentStatus, UserRole } from '@sportsbooking/shared';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PrismaService } from '../../prisma/prisma.service';

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

/** Build a Prisma datetime filter (or undefined) for the given column range. */
function dateFilter(
  range: { from: Date | null; to: Date | null },
): { gte?: Date; lte?: Date } | undefined {
  if (!range.from && !range.to) return undefined;
  return {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lte: range.to } : {}),
  };
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
  constructor(private readonly prisma: PrismaService) {}

  async ownerSummary(user: RequestUser, from?: string, to?: string) {
    const range = parseRange(from, to);
    const createdAt = dateFilter(range);
    // Bookings created in range (used by most revenue/offer/repeat metrics).
    const bookedWhere = createdAt ? { createdAt } : {};
    // Slots are scoped by their actual start time (when play happens).
    const slotsAt = (() => {
      if (!range.from && !range.to) return undefined;
      return {
        ...(range.from ? { gte: range.from } : {}),
        ...(range.to ? { lte: range.to } : {}),
      };
    })();

    return this.prisma.withTenant(async (tx) => {
      const [bookingCount, cancelled] = await Promise.all([
        tx.booking.count({ where: bookedWhere }),
        tx.booking.count({ where: { ...bookedWhere, status: 'cancelled' } }),
      ]);

      const revenueAgg = await tx.booking.aggregate({
        _sum: { total: true },
        where: { ...bookedWhere, paymentStatus: { in: PAID_STATES } },
      });

      // Outstanding membership liability = net unspent pack sessions across the
      // append-only ledger (sum of signed amounts on pack lanes). Liability is a
      // point-in-time figure, so it is intentionally not range-filtered.
      const liabilityRows = await tx.ledgerTxn.findMany({
        where: { lane: { startsWith: 'pack:' } },
        select: { amount: true },
      });
      const outstandingSessions = liabilityRows.reduce(
        (acc, r) => acc.add(r.amount),
        new Prisma.Decimal(0),
      );

      const addonRevenue = await tx.bookingAddon.aggregate({
        _sum: { unitPrice: true },
        ...(createdAt ? { where: { booking: { createdAt } } } : {}),
      });

      const [players, packSales, bookedSlots] = await Promise.all([
        tx.ownerCustomer.count(),
        tx.ledgerTxn.count({
          where: { type: 'pack_buy', ...(createdAt ? { createdAt } : {}) },
        }),
        tx.slot.count({
          where: { status: 'booked', ...(slotsAt ? { startsAt: slotsAt } : {}) },
        }),
      ]);

      // per-venue revenue breakdown (+ venue names via a follow-up lookup)
      const byVenue = await tx.booking.groupBy({
        by: ['venueId'],
        _sum: { total: true },
        _count: { _all: true },
        where: { ...bookedWhere, paymentStatus: { in: PAID_STATES } },
      });
      const venues = await tx.venue.findMany({
        select: { id: true, name: true, openTime: true, closeTime: true },
      });
      const venueName = new Map(venues.map((v) => [v.id, v.name]));

      // --- occupancy: booked slots ÷ available slot-capacity over the range ---
      const units = await tx.bookableUnit.findMany({
        where: { active: true },
        select: {
          id: true,
          venue: { select: { openTime: true, closeTime: true } },
          game: { select: { slotGranularityMin: true } },
        },
      });
      const earliestUnit = await tx.bookableUnit.aggregate({
        _min: { createdAt: true },
      });
      const days = rangeDays(
        range.from,
        range.to,
        earliestUnit._min.createdAt ?? new Date(),
      );
      let availableCapacity = 0;
      for (const u of units) {
        const hours = operatingHours(u.venue.openTime, u.venue.closeTime);
        const gran = u.game.slotGranularityMin || 60;
        availableCapacity += Math.floor((hours * 60) / gran) * days;
      }
      const occupancyPct =
        availableCapacity > 0
          ? Math.min(100, Math.round((bookedSlots / availableCapacity) * 1000) / 10)
          : 0;

      // --- peak hour + per-hour histogram (over booked slots in range) ---
      const slotRows = await tx.slot.findMany({
        where: { status: 'booked', ...(slotsAt ? { startsAt: slotsAt } : {}) },
        select: { startsAt: true },
      });
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
      const ledgerWhere = createdAt ? { createdAt } : {};
      const [earnedAgg, redeemedAgg] = await Promise.all([
        tx.ledgerTxn.aggregate({
          _sum: { amount: true },
          where: { ...ledgerWhere, type: 'points_earn' },
        }),
        tx.ledgerTxn.aggregate({
          _sum: { amount: true },
          where: { ...ledgerWhere, type: 'points_redeem' },
        }),
      ]);
      // redeem amounts are stored as negative debits; report the magnitude.
      const loyalty = {
        earned: Number(earnedAgg._sum.amount ?? 0),
        redeemed: Math.abs(Number(redeemedAgg._sum.amount ?? 0)),
      };

      // --- referrals over the range ---
      const [referralCount, rewardAgg] = await Promise.all([
        tx.referral.count({ where: ledgerWhere }),
        tx.ledgerTxn.aggregate({
          _sum: { amount: true },
          where: { ...ledgerWhere, type: 'referral_reward' },
        }),
      ]);
      const referral = {
        referrals: referralCount,
        rewardsPaid: Number(rewardAgg._sum.amount ?? 0),
      };

      // --- offer redemptions over the range ---
      const offerAgg = await tx.booking.aggregate({
        _count: { _all: true },
        _sum: { discount: true },
        where: { ...bookedWhere, offerId: { not: null } },
      });
      const offers = {
        redemptions: offerAgg._count._all,
        discountTotal: Number(offerAgg._sum.discount ?? 0),
      };

      // --- tournaments over the range (by start date) ---
      const tournamentRows = await tx.tournament.findMany({
        where: createdAt ? { startDate: createdAt } : {},
        select: {
          fee: true,
          participants: { select: { paid: true } },
        },
      });
      let participants = 0;
      let feeRevenue = new Prisma.Decimal(0);
      for (const t of tournamentRows) {
        participants += t.participants.length;
        const paid = t.participants.filter((p) => p.paid).length;
        feeRevenue = feeRevenue.add(t.fee.mul(paid));
      }
      const tournaments = {
        count: tournamentRows.length,
        participants,
        feeRevenue: Number(feeRevenue),
      };

      // --- repeat rate: % of owner's customers with > 1 booking ---
      const [totalCustomers, repeatCustomers] = await Promise.all([
        tx.ownerCustomer.count(),
        tx.ownerCustomer.count({ where: { bookingCount: { gt: 1 } } }),
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
        revenue: Number(revenueAgg._sum.total ?? 0),
        bookedSlots,
        membership: {
          packsSold: packSales,
          outstandingSessions: Number(outstandingSessions),
        },
        addonRevenue: Number(addonRevenue._sum.unitPrice ?? 0),
        players,
        occupancyPct,
        peakHour,
        hourHistogram,
        loyalty,
        referral,
        offers,
        tournaments,
        repeatRatePct,
        perVenue: byVenue.map((v) => ({
          venueId: v.venueId,
          venueName: venueName.get(v.venueId) ?? null,
          revenue: Number(v._sum.total ?? 0),
          bookings: v._count._all,
        })),
      };
    });
  }

  /** Platform-wide read-only aggregate (Super Admin). */
  async platformSummary(from?: string, to?: string) {
    const range = parseRange(from, to);
    const createdAt = dateFilter(range);
    const bookedWhere = createdAt ? { createdAt } : {};
    const slotsAt = createdAt
      ? {
          ...(range.from ? { gte: range.from } : {}),
          ...(range.to ? { lte: range.to } : {}),
        }
      : undefined;

    return this.prisma.withTenantBypass(async (tx) => {
      const [owners, venues, bookings] = await Promise.all([
        tx.owner.count(),
        tx.venue.count(),
        tx.booking.count({ where: bookedWhere }),
      ]);
      const revenue = await tx.booking.aggregate({
        _sum: { total: true },
        where: { ...bookedWhere, paymentStatus: { in: PAID_STATES } },
      });

      // --- platform occupancy (cheap aggregate across all units) ---
      const [bookedSlots, venueRows, unitRows, earliestUnit] = await Promise.all([
        tx.slot.count({
          where: { status: 'booked', ...(slotsAt ? { startsAt: slotsAt } : {}) },
        }),
        tx.venue.findMany({ select: { id: true, openTime: true, closeTime: true } }),
        tx.bookableUnit.findMany({
          where: { active: true },
          select: { venueId: true, game: { select: { slotGranularityMin: true } } },
        }),
        tx.bookableUnit.aggregate({ _min: { createdAt: true } }),
      ]);
      const venueHours = new Map(
        venueRows.map((v) => [v.id, operatingHours(v.openTime, v.closeTime)]),
      );
      const days = rangeDays(
        range.from,
        range.to,
        earliestUnit._min.createdAt ?? new Date(),
      );
      let availableCapacity = 0;
      for (const u of unitRows) {
        const hours = venueHours.get(u.venueId) ?? 0;
        const gran = u.game.slotGranularityMin || 60;
        availableCapacity += Math.floor((hours * 60) / gran) * days;
      }
      const occupancyPct =
        availableCapacity > 0
          ? Math.min(100, Math.round((bookedSlots / availableCapacity) * 1000) / 10)
          : 0;

      // --- platform repeat rate ---
      const [totalCustomers, repeatCustomers] = await Promise.all([
        tx.ownerCustomer.count(),
        tx.ownerCustomer.count({ where: { bookingCount: { gt: 1 } } }),
      ]);
      const repeatRatePct =
        totalCustomers > 0
          ? Math.round((repeatCustomers / totalCustomers) * 1000) / 10
          : 0;

      // --- platform loyalty + offer activity ---
      const ledgerWhere = createdAt ? { createdAt } : {};
      const [earnedAgg, redeemedAgg, offerAgg] = await Promise.all([
        tx.ledgerTxn.aggregate({
          _sum: { amount: true },
          where: { ...ledgerWhere, type: 'points_earn' },
        }),
        tx.ledgerTxn.aggregate({
          _sum: { amount: true },
          where: { ...ledgerWhere, type: 'points_redeem' },
        }),
        tx.booking.aggregate({
          _count: { _all: true },
          _sum: { discount: true },
          where: { ...bookedWhere, offerId: { not: null } },
        }),
      ]);

      return {
        range: {
          from: range.from ? range.from.toISOString() : null,
          to: range.to ? range.to.toISOString() : null,
        },
        owners,
        venues,
        bookings,
        grossRevenue: Number(revenue._sum.total ?? 0),
        occupancyPct,
        repeatRatePct,
        loyalty: {
          earned: Number(earnedAgg._sum.amount ?? 0),
          redeemed: Math.abs(Number(redeemedAgg._sum.amount ?? 0)),
        },
        offers: {
          redemptions: offerAgg._count._all,
          discountTotal: Number(offerAgg._sum.discount ?? 0),
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
