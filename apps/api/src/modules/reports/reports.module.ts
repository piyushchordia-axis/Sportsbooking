import {
  Controller,
  Get,
  Injectable,
  Module,
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
 * Reports (PRD §4.11): bookings, revenue, occupancy, membership liability,
 * add-on revenue and player growth — per venue and consolidated. Plus a
 * platform-wide aggregate for Super Admin (PRD §3.3).
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async ownerSummary(user: RequestUser) {
    return this.prisma.withTenant(async (tx) => {
      const [bookingCount, cancelled] = await Promise.all([
        tx.booking.count(),
        tx.booking.count({ where: { status: 'cancelled' } }),
      ]);

      const revenueAgg = await tx.booking.aggregate({
        _sum: { total: true },
        where: { paymentStatus: { in: PAID_STATES } },
      });

      // Outstanding membership liability = net unspent pack sessions across the
      // append-only ledger (sum of signed amounts on pack lanes).
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
      });

      const [players, packSales, bookedSlots] = await Promise.all([
        tx.ownerCustomer.count(),
        tx.ledgerTxn.count({ where: { type: 'pack_buy' } }),
        tx.slot.count({ where: { status: 'booked' } }),
      ]);

      // per-venue revenue breakdown
      const byVenue = await tx.booking.groupBy({
        by: ['venueId'],
        _sum: { total: true },
        _count: { _all: true },
        where: { paymentStatus: { in: PAID_STATES } },
      });

      return {
        bookings: { total: bookingCount, cancelled },
        revenue: Number(revenueAgg._sum.total ?? 0),
        bookedSlots,
        membership: {
          packsSold: packSales,
          outstandingSessions: Number(outstandingSessions),
        },
        addonRevenue: Number(addonRevenue._sum.unitPrice ?? 0),
        players,
        perVenue: byVenue.map((v) => ({
          venueId: v.venueId,
          revenue: Number(v._sum.total ?? 0),
          bookings: v._count._all,
        })),
      };
    });
  }

  /** Platform-wide read-only aggregate (Super Admin). */
  async platformSummary() {
    return this.prisma.withTenantBypass(async (tx) => {
      const [owners, venues, bookings] = await Promise.all([
        tx.owner.count(),
        tx.venue.count(),
        tx.booking.count(),
      ]);
      const revenue = await tx.booking.aggregate({
        _sum: { total: true },
        where: { paymentStatus: { in: PAID_STATES } },
      });
      return {
        owners,
        venues,
        bookings,
        grossRevenue: Number(revenue._sum.total ?? 0),
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
  ownerSummary(@CurrentUser() user: RequestUser) {
    return this.reports.ownerSummary(user);
  }

  @Get('platform')
  @Roles(UserRole.SUPER_ADMIN)
  platformSummary() {
    return this.reports.platformSummary();
  }
}

@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
