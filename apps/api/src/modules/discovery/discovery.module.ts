import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Public discovery (PRD §5.2): browse venues across owners with their courts,
 * games and owner branding (for white-label theming on the customer side).
 * Runs under RLS bypass since discovery legitimately spans tenants.
 */
@Injectable()
export class DiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  async venues(city?: string, gameId?: string) {
    return this.prisma.withTenantBypass(async (tx) => {
      const venues = await tx.venue.findMany({
        where: {
          active: true,
          ...(city ? { city: { contains: city, mode: 'insensitive' } } : {}),
          ...(gameId ? { games: { some: { gameId } } } : {}),
        },
        include: {
          units: { where: { active: true } },
          games: { include: { game: true } },
          owner: {
            select: {
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

      return venues.map((v) => ({
        id: v.id,
        name: v.name,
        city: v.city,
        address: v.address,
        openTime: v.openTime,
        closeTime: v.closeTime,
        ownerId: v.ownerId,
        branding: {
          logoUrl: v.owner.logoUrl,
          primaryColor: v.owner.primaryColor,
          secondaryColor: v.owner.secondaryColor,
          accentColor: v.owner.accentColor,
        },
        games: v.games.map((g) => ({ id: g.game.id, name: g.game.name })),
        units: v.units.map((u) => ({
          id: u.id,
          name: u.name,
          label: u.label,
          gameId: u.gameId,
          capacity: u.capacity,
        })),
      }));
    });
  }

  games() {
    return this.prisma.gameCatalogue.findMany({ orderBy: { name: 'asc' } });
  }
}

@Controller('discover')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Public()
  @Get('venues')
  venues(@Query('city') city?: string, @Query('gameId') gameId?: string) {
    return this.discovery.venues(city, gameId);
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
