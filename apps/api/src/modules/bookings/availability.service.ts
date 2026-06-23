import { Injectable, NotFoundException } from '@nestjs/common';
import { CalendarResponse, ResolvedSlot, SlotStatus } from '@sportsbooking/shared';
import { and, eq, gte, lt } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { DbService } from '../../db/db.service';
import { bookableUnits, slots as slotsTable } from '../../db/schema';
import { PricingService } from '../pricing/pricing.service';

/**
 * All venues operate on India Standard Time (single-region launch). Venue
 * openTime/closeTime are IST wall-clock strings, so the day window and the slot
 * grid MUST be built in this zone — never the server's system zone. On a UTC
 * server, parsing "06:00" without a zone yields 06:00 UTC (= 11:30 IST), which
 * shifts every displayed slot and breaks the booked-slot match. Pinning the
 * zone here makes availability identical regardless of where the API runs.
 */
const VENUE_TZ = 'Asia/Kolkata';

/**
 * Builds the live availability calendar for a unit/day with resolved per-court
 * pricing (PRD §4.3, §5.2). Open availability = operating hours sliced by the
 * game's slot granularity, minus any booked/blocked Slot rows. Target < 1s
 * (PRD §7).
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly db: DbService,
    private readonly pricing: PricingService,
  ) {}

  async calendar(unitId: string, date: string): Promise<CalendarResponse> {
    // Public discovery spans tenants, so read under bypass scoped to the unit.
    return this.db.withTenantBypass(async (tx) => {
      const unit = await tx.query.bookableUnits.findFirst({
        where: eq(bookableUnits.id, unitId),
        with: { venue: true, gameCatalogue: true },
      });
      if (!unit) throw new NotFoundException('Unit not found');

      const granularity = unit.gameCatalogue.slotGranularityMin;
      const dayStart = DateTime.fromISO(`${date}T${unit.venue.openTime}`, {
        zone: VENUE_TZ,
      });
      const dayEnd = DateTime.fromISO(`${date}T${unit.venue.closeTime}`, {
        zone: VENUE_TZ,
      });

      // existing occupying slots for the day
      const occupied = await tx.query.slots.findMany({
        where: and(
          eq(slotsTable.unitId, unitId),
          gte(slotsTable.startsAt, dayStart.toJSDate()),
          lt(slotsTable.startsAt, dayEnd.toJSDate()),
        ),
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
