import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import {
  BlockSlotsDto,
  CreateUnitDto,
  CreateVenueDto,
  PricingRuleDto,
} from './dto';

/**
 * Owner-facing venue, unit, pricing-grid and slot-blocking management
 * (PRD §4.1, §4.2, §4.3). All reads/writes run under the owner's tenant scope.
 */
@Injectable()
export class VenuesService {
  constructor(private readonly prisma: PrismaService) {}

  private ownerId(user: RequestUser): string {
    if (!user.ownerId) throw new BadRequestException('No tenant context');
    return user.ownerId;
  }

  listVenues(user: RequestUser) {
    return this.prisma.withTenant((tx) =>
      tx.venue.findMany({ include: { units: true, games: true } }),
    );
  }

  /** Create a venue, enforcing the owner's quota (PRD §4.1). */
  async createVenue(user: RequestUser, dto: CreateVenueDto) {
    const ownerId = this.ownerId(user);
    return this.prisma.withTenant(async (tx) => {
      const owner = await tx.owner.findUnique({ where: { id: ownerId } });
      if (!owner) throw new NotFoundException('Owner not found');
      const count = await tx.venue.count();
      if (count >= owner.venueQuota) {
        throw new ConflictException(
          `Venue quota (${owner.venueQuota}) reached`,
        );
      }
      // Only allow games the owner is entitled to (PRD §2.2).
      const disallowed = dto.gameIds.filter(
        (g) => !owner.allowedGameIds.includes(g),
      );
      if (disallowed.length) {
        throw new BadRequestException('Game not in owner entitlement');
      }
      const venue = await tx.venue.create({
        data: {
          ownerId,
          name: dto.name,
          geoLat: dto.geoLat,
          geoLng: dto.geoLng,
          address: dto.address,
          city: dto.city,
          contactPhone: dto.contactPhone,
          openTime: dto.openTime ?? '06:00',
          closeTime: dto.closeTime ?? '23:00',
          games: { create: dto.gameIds.map((gameId) => ({ gameId })) },
          settings: { create: {} },
        },
        include: { games: true, settings: true },
      });
      return venue;
    });
  }

  async addUnit(user: RequestUser, venueId: string, dto: CreateUnitDto) {
    const ownerId = this.ownerId(user);
    return this.prisma.withTenant((tx) =>
      tx.bookableUnit.create({
        data: {
          venueId,
          ownerId,
          name: dto.name,
          label: dto.label,
          gameId: dto.gameId,
          capacity: dto.capacity,
        },
      }),
    );
  }

  /** Replace the weekly price grid for a unit (PRD §4.2). */
  async setPricing(user: RequestUser, unitId: string, rules: PricingRuleDto[]) {
    const ownerId = this.ownerId(user);
    return this.prisma.withTenant(async (tx) => {
      await tx.pricingRule.deleteMany({ where: { unitId } });
      await tx.pricingRule.createMany({
        data: rules.map((r) => ({
          unitId,
          ownerId,
          dayType: r.dayType,
          timeBand: r.timeBand,
          dateOverride: r.dateOverride ? new Date(r.dateOverride) : null,
          minDuration: r.minDuration,
          price: new Prisma.Decimal(r.price),
        })),
      });
      return tx.pricingRule.findMany({ where: { unitId } });
    });
  }

  /** Block a range of slots for maintenance/private use (PRD §4.3). */
  async block(user: RequestUser, dto: BlockSlotsDto) {
    const ownerId = this.ownerId(user);
    return this.prisma.withTenant(async (tx) => {
      const unit = await tx.bookableUnit.findUnique({
        where: { id: dto.unitId },
        include: { game: true },
      });
      if (!unit) throw new NotFoundException('Unit not found');
      const granularity = unit.game.slotGranularityMin;

      let cursor = DateTime.fromISO(dto.start);
      const end = DateTime.fromISO(dto.end);
      const created: string[] = [];
      while (cursor < end) {
        const next = cursor.plus({ minutes: granularity });
        try {
          const slot = await tx.slot.create({
            data: {
              unitId: dto.unitId,
              ownerId,
              startsAt: cursor.toJSDate(),
              endsAt: next.toJSDate(),
              status: 'blocked',
              blockReason: dto.reason,
            },
          });
          created.push(slot.id);
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            throw new ConflictException(
              `Slot at ${cursor.toISO()} is already booked/blocked`,
            );
          }
          throw err;
        }
        cursor = next;
      }
      return { blocked: created.length };
    });
  }
}
