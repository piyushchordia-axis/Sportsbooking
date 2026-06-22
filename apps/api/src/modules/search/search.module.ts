import {
  Controller,
  Get,
  Injectable,
  Module,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@sportsbooking/shared';
import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DbService } from '../../db/db.service';
import {
  bookings,
  ownerCustomers,
  playerProfiles,
  slots,
  tournaments,
  users,
  venues,
} from '../../db/schema';

interface VenueResult {
  id: string;
  name: string;
  city: string | null;
}

interface PlayerResult {
  customerId: string;
  name: string | null;
  mobile: string | null;
}

interface TournamentResult {
  id: string;
  name: string;
}

interface BookingResult {
  id: string;
  customerName: string | null;
  venueName: string | null;
  startsAt: string | null;
  status: string;
}

interface SearchResults {
  venues: VenueResult[];
  players: PlayerResult[];
  tournaments: TournamentResult[];
  bookings: BookingResult[];
}

const GROUP_LIMIT = 5;

/**
 * Owner/staff global quick-search (PRD §5). One free-text query fans out across
 * venues, the owner CRM, tournaments and recent bookings, each capped at five
 * hits. Strictly tenant-scoped via the request context so an owner can only
 * ever match their own data.
 */
@Injectable()
export class SearchService {
  constructor(private readonly db: DbService) {}

  async search(user: RequestUser, q: string): Promise<SearchResults> {
    const term = typeof q === 'string' ? q.trim() : '';
    const empty: SearchResults = {
      venues: [],
      players: [],
      tournaments: [],
      bookings: [],
    };
    // Require at least two characters to avoid scanning on a single keystroke.
    if (term.length < 2) return empty;

    const pattern = `%${term}%`;

    return this.db.withTenant(async (tx) => {
      const [venueRows, tournamentRows] = await Promise.all([
        tx.query.venues.findMany({
          where: or(ilike(venues.name, pattern), ilike(venues.city, pattern)),
          limit: GROUP_LIMIT,
        }),
        tx.query.tournaments.findMany({
          where: ilike(tournaments.name, pattern),
          limit: GROUP_LIMIT,
        }),
      ]);

      // Players: the owner CRM (ownerCustomers) joined to the per-owner player
      // profile (preferred) and falling back to the global user record for
      // name/mobile, matched case-insensitively on either field.
      const players = await this.searchPlayers(tx, pattern);

      // Bookings: customer (joined users) name/mobile matches, recent first,
      // with the venue name resolved for display.
      const bookingsOut = await this.searchBookings(tx, pattern);

      const venuesOut: VenueResult[] = venueRows.map((v) => ({
        id: v.id,
        name: v.name,
        city: v.city ?? null,
      }));
      const tournamentsOut: TournamentResult[] = tournamentRows.map((t) => ({
        id: t.id,
        name: t.name,
      }));

      return {
        venues: venuesOut,
        players,
        tournaments: tournamentsOut,
        bookings: bookingsOut,
      };
    });
  }

  private async searchPlayers(
    tx: Parameters<Parameters<DbService['withTenant']>[0]>[0],
    pattern: string,
  ): Promise<PlayerResult[]> {
    const rows = await tx
      .select({
        customerId: ownerCustomers.customerId,
        profileName: playerProfiles.name,
        profileMobile: playerProfiles.mobile,
        userName: users.name,
        userMobile: users.mobile,
      })
      .from(ownerCustomers)
      .leftJoin(
        playerProfiles,
        eq(playerProfiles.customerId, ownerCustomers.customerId),
      )
      .leftJoin(users, eq(users.id, ownerCustomers.customerId))
      .where(
        or(
          ilike(playerProfiles.name, pattern),
          ilike(playerProfiles.mobile, pattern),
          ilike(users.name, pattern),
          ilike(users.mobile, pattern),
        ),
      )
      .limit(GROUP_LIMIT);

    return rows.map((r) => ({
      customerId: r.customerId,
      name: r.profileName ?? r.userName ?? null,
      mobile: r.profileMobile ?? r.userMobile ?? null,
    }));
  }

  private async searchBookings(
    tx: Parameters<Parameters<DbService['withTenant']>[0]>[0],
    pattern: string,
  ): Promise<BookingResult[]> {
    const rows = await tx
      .select({
        id: bookings.id,
        status: bookings.status,
        venueId: bookings.venueId,
        venueName: venues.name,
        customerName: users.name,
        createdAt: bookings.createdAt,
      })
      .from(bookings)
      .innerJoin(users, eq(users.id, bookings.customerId))
      .leftJoin(venues, eq(venues.id, bookings.venueId))
      .where(or(ilike(users.name, pattern), ilike(users.mobile, pattern)))
      .orderBy(desc(bookings.createdAt))
      .limit(GROUP_LIMIT);

    if (rows.length === 0) return [];

    // Resolve each booking's start time from its earliest slot.
    const bookingIds = rows.map((r) => r.id);
    const slotRows = await tx.query.slots.findMany({
      where: inArray(slots.bookingId, bookingIds),
      columns: { bookingId: true, startsAt: true },
    });
    const earliestStart = new Map<string, Date>();
    for (const s of slotRows) {
      if (!s.bookingId) continue;
      const existing = earliestStart.get(s.bookingId);
      if (!existing || s.startsAt.getTime() < existing.getTime()) {
        earliestStart.set(s.bookingId, s.startsAt);
      }
    }

    return rows.map((r) => {
      const start = earliestStart.get(r.id);
      return {
        id: r.id,
        customerName: r.customerName ?? null,
        venueName: r.venueName ?? null,
        startsAt: start ? start.toISOString() : null,
        status: r.status,
      };
    });
  }
}

@Controller()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** Owner/staff global quick-search across venues, players, tournaments, bookings. */
  @Get('search')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  query(@CurrentUser() user: RequestUser, @Query('q') q?: string) {
    return this.search.search(user, q ?? '');
  }
}

@Module({
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
