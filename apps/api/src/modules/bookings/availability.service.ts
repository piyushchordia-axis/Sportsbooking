import { Injectable, NotFoundException } from '@nestjs/common';
import { CalendarResponse, ResolvedSlot, SlotStatus } from '@sportsbooking/shared';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';

/**
 * Builds the live availability calendar for a unit/day with resolved per-court
 * pricing (PRD §4.3, §5.2). Open availability = operating hours sliced by the
 * game's slot granularity, minus any booked/blocked Slot rows. Target < 1s
 * (PRD §7).
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async calendar(unitId: string, date: string): Promise<CalendarResponse> {
    // Public discovery spans tenants, so read under bypass scoped to the unit.
    return this.prisma.withTenantBypass(async (tx) => {
      const unit = await tx.bookableUnit.findUnique({
        where: { id: unitId },
        include: { venue: true, game: true },
      });
      if (!unit) throw new NotFoundException('Unit not found');

      const granularity = unit.game.slotGranularityMin;
      const dayStart = DateTime.fromISO(`${date}T${unit.venue.openTime}`);
      const dayEnd = DateTime.fromISO(`${date}T${unit.venue.closeTime}`);

      // existing occupying slots for the day
      const occupied = await tx.slot.findMany({
        where: {
          unitId,
          startsAt: { gte: dayStart.toJSDate(), lt: dayEnd.toJSDate() },
        },
      });
      const occupiedByStart = new Map(
        occupied.map((s) => [s.startsAt.toISOString(), s]),
      );

      const slots: ResolvedSlot[] = [];
      let cursor = dayStart;
      while (cursor.plus({ minutes: granularity }) <= dayEnd) {
        const start = cursor;
        const end = cursor.plus({ minutes: granularity });
        const existing = occupiedByStart.get(start.toJSDate().toISOString());

        if (existing) {
          slots.push({
            unitId,
            start: start.toISO()!,
            end: end.toISO()!,
            status: existing.status as SlotStatus,
            price: 0,
            dayType: PricingService.dayType(start),
            timeBand: PricingService.timeBand(start),
          });
        } else {
          const resolved = await this.pricing.resolve(
            unitId,
            start.toJSDate(),
            granularity,
            tx,
          );
          slots.push({
            unitId,
            start: start.toISO()!,
            end: end.toISO()!,
            status: SlotStatus.OPEN,
            price: Number(resolved.price),
            dayType: resolved.dayType,
            timeBand: resolved.timeBand,
          });
        }
        cursor = end;
      }

      return { venueId: unit.venueId, unitId, date, slots };
    });
  }
}
