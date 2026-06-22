import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { and, asc, eq, ilike } from 'drizzle-orm';
import { Public } from '../../common/decorators/public.decorator';
import { DbService } from '../../db/db.service';
import { bookableUnits, gameCatalogue, venues } from '../../db/schema';

/** Great-circle distance in km between two lat/lng points (haversine). */
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371; // Earth radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Parse a query string to a finite number, or undefined if absent/NaN. */
function parseNum(v?: string): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Public discovery (PRD §5.2): browse venues across owners with their courts,
 * games and owner branding (for white-label theming on the customer side).
 * Runs under RLS bypass since discovery legitimately spans tenants.
 */
@Injectable()
export class DiscoveryService {
  constructor(private readonly db: DbService) {}

  async venues(
    city?: string,
    gameId?: string,
    geo?: {
      lat?: number;
      lng?: number;
      radiusKm?: number;
      limit?: number;
      offset?: number;
    },
  ) {
    return this.db.withTenantBypass(async (tx) => {
      const rows = await tx.query.venues.findMany({
        where: and(
          eq(venues.active, true),
          ...(city ? [ilike(venues.city, `%${city}%`)] : []),
        ),
        with: {
          bookableUnits: {
            where: eq(bookableUnits.active, true),
            with: { pricingRules: { columns: { price: true } } },
          },
          venueGames: { with: { gameCatalogue: true } },
          owner: {
            columns: {
              id: true,
              name: true,
              logoUrl: true,
              primaryColor: true,
              secondaryColor: true,
              accentColor: true,
            },
          },
        },
      });

      // Venue-level filter: keep only venues that offer the requested game.
      const venuesList = gameId
        ? rows.filter((v) => v.venueGames.some((g) => g.gameId === gameId))
        : rows;

      const items = venuesList.map((v) => {
        // Best-effort lowest hourly price across the venue's bookable units.
        // Pricing is rule-based (PricingRule per unit, most-specific-wins); the
        // cheapest configured rule is the closest stand-in for a "from" price.
        const prices = v.bookableUnits.flatMap((u) =>
          u.pricingRules.map((r) => Number(r.price)),
        );
        const minPrice = prices.length ? Math.min(...prices) : null;

        return {
        id: v.id,
        name: v.name,
        city: v.city,
        address: v.address,
        openTime: v.openTime,
        closeTime: v.closeTime,
        ownerId: v.ownerId,
        minPrice,
        geoLat: v.geoLat,
        geoLng: v.geoLng,
        photos: v.photos ?? [],
        branding: {
          logoUrl: v.owner.logoUrl,
          primaryColor: v.owner.primaryColor,
          secondaryColor: v.owner.secondaryColor,
          accentColor: v.owner.accentColor,
        },
        games: v.venueGames.map((g) => ({
          id: g.gameCatalogue.id,
          name: g.gameCatalogue.name,
        })),
        units: v.bookableUnits.map((u) => ({
          id: u.id,
          name: u.name,
          label: u.label,
          gameId: u.gameId,
          capacity: u.capacity,
        })),
        };
      });

      const hasOrigin =
        geo?.lat !== undefined && geo?.lng !== undefined;

      // Geo-aware shaping: attach distanceKm (when an origin is given), then
      // optionally radius-filter and sort nearest-first. Venues missing
      // coordinates get distanceKm null and are pushed to the end.
      let result: Array<(typeof items)[number] & { distanceKm?: number | null }> =
        items;

      if (hasOrigin) {
        const originLat = geo!.lat as number;
        const originLng = geo!.lng as number;

        const withDistance = items.map((item) => ({
          ...item,
          distanceKm:
            item.geoLat !== null && item.geoLng !== null
              ? haversineKm(originLat, originLng, item.geoLat, item.geoLng)
              : null,
        }));

        const filtered =
          geo?.radiusKm !== undefined
            ? withDistance.filter(
                (item) =>
                  item.distanceKm !== null &&
                  item.distanceKm <= (geo!.radiusKm as number),
              )
            : withDistance;

        filtered.sort((a, b) => {
          if (a.distanceKm === null && b.distanceKm === null) return 0;
          if (a.distanceKm === null) return 1;
          if (b.distanceKm === null) return -1;
          return a.distanceKm - b.distanceKm;
        });

        result = filtered;
      }

      // Pagination applied last. No slicing unless an explicit window is given;
      // a bare limit defaults sensibly while keeping the response an array.
      const hasOffset = geo?.offset !== undefined;
      const hasLimit = geo?.limit !== undefined;
      if (hasOffset || hasLimit) {
        const offset = hasOffset ? (geo!.offset as number) : 0;
        const limit = hasLimit ? (geo!.limit as number) : 24;
        result = result.slice(offset, offset + limit);
      }

      return result;
    });
  }

  games() {
    return this.db.db.query.gameCatalogue.findMany({
      orderBy: asc(gameCatalogue.name),
    });
  }
}

@Controller('discover')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Public()
  @Get('venues')
  venues(
    @Query('city') city?: string,
    @Query('gameId') gameId?: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('radiusKm') radiusKm?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.discovery.venues(city, gameId, {
      lat: parseNum(lat),
      lng: parseNum(lng),
      radiusKm: parseNum(radiusKm),
      limit: parseNum(limit),
      offset: parseNum(offset),
    });
  }

  /** Global game catalogue (non-sensitive) — used by discovery & venue setup. */
  @Public()
  @Get('games')
  games() {
    return this.discovery.games();
  }
}

@Module({
  controllers: [DiscoveryController],
  providers: [DiscoveryService],
})
export class DiscoveryModule {}
