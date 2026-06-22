import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  or,
} from 'drizzle-orm';
import { DateTime } from 'luxon';
import { DbService } from '../../db/db.service';
import type { DbTx } from '../../db';
import { Decimal, money, num } from '../../db/money';
import {
  bookableUnits,
  bookings,
  owners,
  pricingRules,
  slots,
  venueGames,
  venueSettings,
  venues,
} from '../../db/schema';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { OpenMatchRepaymentMode } from '@sportsbooking/shared';
import {
  BlockSlotsDto,
  BulkPricingDto,
  CreateUnitDto,
  CreateVenueDto,
  PricingRuleDto,
  ScheduleQueryDto,
  SettingsDto,
  UnblockSlotsDto,
  UpdateUnitDto,
  UpdateVenueDto,
  VenueListQueryDto,
} from './dto';

/**
 * Schema defaults for VenueSettings (mirrors schema defaults), used when no
 * settings row exists yet. The cancellation template maps to a (free window,
 * penalty) policy enforced in bookings.service.ts CANCELLATION_TEMPLATES.
 */
const VENUE_SETTINGS_DEFAULTS = {
  cancellationTemplate: 'flexible' as const,
  noShowFee: 0,
  loyaltyEarnRate: null,
  loyaltyRedeemValue: null,
  openMatchRepaymentMode: OpenMatchRepaymentMode.INFO,
};

/** Free-cancellation window / penalty per template (see bookings.service.ts). */
const CANCELLATION_TEMPLATE_HELP: Record<string, string> = {
  flexible: 'Free cancellation up to 4h before; 50% penalty after',
  moderate: 'Free cancellation up to 12h before; 50% penalty after',
  strict: 'Free cancellation up to 24h before; 100% penalty after',
};

/** Postgres unique-violation SQLSTATE (23505). */
const PG_UNIQUE_VIOLATION = '23505';
/** Postgres foreign-key-violation SQLSTATE (23503). */
const PG_FK_VIOLATION = '23503';

/** Narrow an unknown error to a pg driver error carrying a SQLSTATE `code`. */
function pgErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

/**
 * Owner-facing venue, unit, pricing-grid and slot-blocking management
 * (PRD §4.1, §4.2, §4.3). All reads/writes run under the owner's tenant scope.
 */
@Injectable()
export class VenuesService {
  constructor(private readonly db: DbService) {}

  private ownerId(user: RequestUser): string {
    if (!user.ownerId) throw new BadRequestException('No tenant context');
    return user.ownerId;
  }

  /**
   * Map Drizzle relation keys back to the API contract the web app expects.
   * The relational query returns relations under their names
   * (bookableUnits/venueGames/venueSettings); the web client reads
   * units/games/settings.
   */
  private shapeVenue<T extends Record<string, unknown> | null | undefined>(
    v: T,
  ) {
    if (!v) return v;
    const { bookableUnits, venueGames, venueSettings, ...rest } =
      v as Record<string, unknown>;
    return {
      ...rest,
      units: bookableUnits ?? [],
      games: venueGames ?? [],
      settings: Array.isArray(venueSettings)
        ? venueSettings[0] ?? null
        : venueSettings ?? null,
    };
  }

  async listVenues(user: RequestUser) {
    const rows = await this.db.withTenant((tx) =>
      tx.query.venues.findMany({
        with: { bookableUnits: true, venueGames: true },
      }),
    );
    return rows.map((v) => this.shapeVenue(v));
  }

  /**
   * Derive the display status for a ground card (Grounds revamp list).
   *  - inactive : venue.active === false
   *  - draft    : active but has no bookable units yet
   *  - needs_setup : has units but none of them carry a pricing rule
   *  - active   : active, has units, and at least one priced unit
   */
  private deriveStatus(
    active: boolean,
    courtCount: number,
    pricedCount: number,
  ): 'active' | 'inactive' | 'draft' | 'needs_setup' {
    if (!active) return 'inactive';
    if (courtCount === 0) return 'draft';
    if (pricedCount === 0) return 'needs_setup';
    return 'active';
  }

  /**
   * Best-effort occupancy over the next 7 days for a set of units: booked slots
   * vs. a coarse capacity estimate (operating hours / 1h granularity * days *
   * courtCount). Returns 0 when there is no capacity to divide by. This is a
   * heuristic for the list/overview cards, not an exact accounting figure.
   */
  private async occupancyPct(
    tx: DbTx,
    unitIds: string[],
    openTime: string,
    closeTime: string,
    courtCount: number,
  ): Promise<number> {
    if (unitIds.length === 0 || courtCount === 0) return 0;
    const now = DateTime.now();
    const horizon = now.plus({ days: 7 });
    const booked = (
      await tx
        .select({ c: count() })
        .from(slots)
        .where(
          and(
            inArray(slots.unitId, unitIds),
            eq(slots.status, 'booked'),
            gte(slots.startsAt, now.toJSDate()),
            lt(slots.startsAt, horizon.toJSDate()),
          ),
        )
    )[0].c;

    // Coarse capacity: hourly slots per court per day across the 7-day horizon.
    const open = DateTime.fromISO(`2000-01-01T${openTime}`);
    const close = DateTime.fromISO(`2000-01-01T${closeTime}`);
    const hoursPerDay = Math.max(0, close.diff(open, 'hours').hours);
    const capacity = Math.round(hoursPerDay * 7 * courtCount);
    if (capacity <= 0) return 0;
    return Math.min(100, Math.round((booked / capacity) * 100));
  }

  /**
   * Paginated, filterable list of the owner's grounds (Grounds revamp). Each
   * item carries display fields (status, court count, best-effort occupancy)
   * for the list page. Owner-scoped + tenant-scoped; supports q (name/city
   * ilike), city, gameId (via venueGames), and status filters.
   */
  async listVenuesPaginated(user: RequestUser, query: VenueListQueryDto) {
    const ownerId = this.ownerId(user);
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 20;

    return this.db.withTenant(async (tx) => {
      // gameId filter: resolve the matching venue ids via venueGames first.
      let gameVenueIds: string[] | null = null;
      if (query.gameId) {
        const vg = await tx
          .select({ venueId: venueGames.venueId })
          .from(venueGames)
          .where(eq(venueGames.gameId, query.gameId));
        gameVenueIds = vg.map((r) => r.venueId);
        // No venue offers the game -> empty page (short-circuit).
        if (gameVenueIds.length === 0) return { items: [], total: 0 };
      }

      const filters = [eq(venues.ownerId, ownerId)];
      if (query.q) {
        const like = `%${query.q}%`;
        const qFilter = or(ilike(venues.name, like), ilike(venues.city, like));
        if (qFilter) filters.push(qFilter);
      }
      if (query.city) filters.push(ilike(venues.city, `%${query.city}%`));
      if (query.status === 'active') filters.push(eq(venues.active, true));
      if (query.status === 'inactive') filters.push(eq(venues.active, false));
      if (gameVenueIds) filters.push(inArray(venues.id, gameVenueIds));

      const where = and(...filters);

      // Map a venue row -> list item (derived status + counts + occupancy).
      const toItem = async (v: {
        id: string;
        name: string;
        city: string | null;
        active: boolean;
        openTime: string;
        closeTime: string;
        bookableUnits?: { id: string; active: boolean }[];
      }) => {
        const allUnits = v.bookableUnits ?? [];
        const courtCount = allUnits.length;
        const unitIds = allUnits.map((u) => u.id);

        // pricedCount: distinct units that have at least one pricing rule.
        let pricedCount = 0;
        if (unitIds.length > 0) {
          const priced = await tx
            .selectDistinct({ unitId: pricingRules.unitId })
            .from(pricingRules)
            .where(inArray(pricingRules.unitId, unitIds));
          pricedCount = priced.length;
        }

        const activeUnitIds = allUnits.filter((u) => u.active).map((u) => u.id);

        return {
          id: v.id,
          name: v.name,
          city: v.city ?? null,
          status: this.deriveStatus(v.active, courtCount, pricedCount),
          courtCount,
          occupancyPct: await this.occupancyPct(
            tx,
            activeUnitIds,
            v.openTime,
            v.closeTime,
            activeUnitIds.length,
          ),
        };
      };

      // Derived statuses (draft / needs_setup) are computed per-row and can't be
      // pushed to SQL, so the whole matching set must be evaluated BEFORE
      // filtering + paginating — otherwise total and the page are both wrong.
      if (query.status === 'draft' || query.status === 'needs_setup') {
        const allRows = await tx.query.venues.findMany({
          where,
          with: { bookableUnits: true },
          orderBy: [desc(venues.createdAt)],
        });
        const all = await Promise.all(allRows.map(toItem));
        const filtered = all.filter((i) => i.status === query.status);
        const start = (page - 1) * pageSize;
        return {
          items: filtered.slice(start, start + pageSize),
          total: filtered.length,
        };
      }

      // Non-derived statuses (active / inactive / all): count + page in SQL.
      const total = (
        await tx.select({ c: count() }).from(venues).where(where)
      )[0].c;
      const rows = await tx.query.venues.findMany({
        where,
        with: { bookableUnits: true },
        orderBy: [desc(venues.createdAt)],
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      const items = await Promise.all(rows.map(toItem));
      return { items, total };
    });
  }

  /** Single shaped venue for the detail page (PRD §4.1). 404 if not owner's. */
  async getVenue(user: RequestUser, venueId: string) {
    const ownerId = this.ownerId(user);
    return this.db.withTenant(async (tx) => {
      const venue = await tx.query.venues.findFirst({
        where: and(eq(venues.id, venueId), eq(venues.ownerId, ownerId)),
        with: { bookableUnits: true, venueGames: true, venueSettings: true },
      });
      if (!venue) throw new NotFoundException('Venue not found');
      return this.shapeVenue(venue);
    });
  }

  /**
   * Best-effort headline metrics for a ground's detail page: court count plus
   * this-week bookings/revenue and occupancy. Owner-scoped + tenant-scoped.
   */
  async getOverview(user: RequestUser, venueId: string) {
    const ownerId = this.ownerId(user);
    return this.db.withTenant(async (tx) => {
      const venue = await tx.query.venues.findFirst({
        where: and(eq(venues.id, venueId), eq(venues.ownerId, ownerId)),
        with: { bookableUnits: true },
      });
      if (!venue) throw new NotFoundException('Venue not found');

      const allUnits = venue.bookableUnits ?? [];
      const courtCount = allUnits.length;
      const activeUnitIds = allUnits.filter((u) => u.active).map((u) => u.id);

      const weekStart = DateTime.now().startOf('week');
      const weekEnd = weekStart.plus({ weeks: 1 });

      const weekBookings = await tx.query.bookings.findMany({
        where: and(
          eq(bookings.venueId, venueId),
          gte(bookings.createdAt, weekStart.toJSDate()),
          lt(bookings.createdAt, weekEnd.toJSDate()),
        ),
      });

      const bookingsThisWeek = weekBookings.length;
      const revenueThisWeek = weekBookings.reduce(
        (acc, b) =>
          b.status === 'cancelled' ? acc : acc + num(b.total),
        0,
      );

      return {
        courtCount,
        bookingsThisWeek,
        revenueThisWeek,
        occupancyPct: await this.occupancyPct(
          tx,
          activeUnitIds,
          venue.openTime,
          venue.closeTime,
          activeUnitIds.length,
        ),
      };
    });
  }

  /**
   * Per-court hourly slot grid for a ground on a given day (Grounds revamp
   * §4.3). Mirrors the availability calendar logic: operating hours sliced by
   * each court's game granularity, overlaid with any booked/blocked slot rows.
   * Owner-scoped + tenant-scoped.
   */
  async getSchedule(user: RequestUser, venueId: string, query: ScheduleQueryDto) {
    const ownerId = this.ownerId(user);
    return this.db.withTenant(async (tx) => {
      const venue = await tx.query.venues.findFirst({
        where: and(eq(venues.id, venueId), eq(venues.ownerId, ownerId)),
        with: {
          bookableUnits: { with: { gameCatalogue: true } },
        },
      });
      if (!venue) throw new NotFoundException('Venue not found');

      const date = query.date;
      const dayStart = DateTime.fromISO(`${date}T${venue.openTime}`);
      const dayEnd = DateTime.fromISO(`${date}T${venue.closeTime}`);

      const activeCourts = (venue.bookableUnits ?? []).filter((u) => u.active);

      const courts = await Promise.all(
        activeCourts.map(async (court) => {
          const granularity = court.gameCatalogue.slotGranularityMin;

          const occupied = await tx.query.slots.findMany({
            where: and(
              eq(slots.unitId, court.id),
              gte(slots.startsAt, dayStart.toJSDate()),
              lt(slots.startsAt, dayEnd.toJSDate()),
            ),
          });
          const occupiedByStart = new Map(
            occupied.map((s) => [s.startsAt.toISOString(), s]),
          );

          const courtSlots: {
            start: string;
            end: string;
            status: 'free' | 'booked' | 'blocked';
            bookingId?: string;
          }[] = [];
          let cursor = dayStart;
          while (cursor.plus({ minutes: granularity }) <= dayEnd) {
            const start = cursor;
            const end = cursor.plus({ minutes: granularity });
            const existing = occupiedByStart.get(
              start.toJSDate().toISOString(),
            );
            if (existing) {
              courtSlots.push({
                start: start.toISO()!,
                end: end.toISO()!,
                status: existing.status === 'blocked' ? 'blocked' : 'booked',
                ...(existing.bookingId
                  ? { bookingId: existing.bookingId }
                  : {}),
              });
            } else {
              courtSlots.push({
                start: start.toISO()!,
                end: end.toISO()!,
                status: 'free',
              });
            }
            cursor = end;
          }

          return { id: court.id, name: court.name, slots: courtSlots };
        }),
      );

      return {
        openTime: venue.openTime,
        closeTime: venue.closeTime,
        courts,
      };
    });
  }

  /**
   * Free BLOCKED slots in a range for an owner's unit (Grounds revamp §4.3):
   * delete blocked slot rows that carry no booking. Mirrors block()'s scoping.
   * Booked slots are never touched.
   */
  async unblock(user: RequestUser, dto: UnblockSlotsDto) {
    const ownerId = this.ownerId(user);
    return this.db.withTenant(async (tx) => {
      // Scope by ownerId explicitly (defense-in-depth): never rely on RLS alone,
      // which is bypassed when the app connects as a superuser (SEC-6).
      const unit = await tx.query.bookableUnits.findFirst({
        where: and(
          eq(bookableUnits.id, dto.unitId),
          eq(bookableUnits.ownerId, ownerId),
        ),
      });
      if (!unit) throw new NotFoundException('Unit not found');

      const start = DateTime.fromISO(dto.start).toJSDate();
      const end = DateTime.fromISO(dto.end).toJSDate();

      const removed = await tx
        .delete(slots)
        .where(
          and(
            eq(slots.unitId, dto.unitId),
            eq(slots.status, 'blocked'),
            gte(slots.startsAt, start),
            lt(slots.startsAt, end),
          ),
        )
        .returning();
      return { unblocked: removed.length };
    });
  }

  /**
   * Apply the same pricing grid to every listed court the owner owns (Grounds
   * revamp §4.2). Reuses the setPricing replace-grid semantics per unit inside
   * a single tenant transaction. Skips/owner-validates each unit.
   */
  async bulkPricing(user: RequestUser, venueId: string, dto: BulkPricingDto) {
    const ownerId = this.ownerId(user);
    return this.db.withTenant(async (tx) => {
      const venue = await tx.query.venues.findFirst({
        where: and(eq(venues.id, venueId), eq(venues.ownerId, ownerId)),
      });
      if (!venue) throw new NotFoundException('Venue not found');

      // Only operate on units that belong to this owner AND this venue.
      const owned =
        dto.unitIds.length === 0
          ? []
          : await tx.query.bookableUnits.findMany({
              where: and(
                inArray(bookableUnits.id, dto.unitIds),
                eq(bookableUnits.ownerId, ownerId),
                eq(bookableUnits.venueId, venueId),
              ),
            });
      const ownedIds = owned.map((u) => u.id);
      if (ownedIds.length === 0) {
        throw new NotFoundException('No matching courts for this venue');
      }

      for (const unitId of ownedIds) {
        await tx.delete(pricingRules).where(eq(pricingRules.unitId, unitId));
        if (dto.rules.length > 0) {
          await tx.insert(pricingRules).values(
            dto.rules.map((r) => ({
              id: randomUUID(),
              unitId,
              ownerId,
              dayType: r.dayType,
              timeBand: r.timeBand,
              dateOverride: r.dateOverride
                ? new Date(r.dateOverride).toISOString().slice(0, 10)
                : null,
              minDuration: r.minDuration,
              price: money(new Decimal(r.price)),
            })),
          );
        }
      }

      return { updatedUnits: ownedIds.length };
    });
  }

  /** Create a venue, enforcing the owner's quota (PRD §4.1). */
  async createVenue(user: RequestUser, dto: CreateVenueDto) {
    const ownerId = this.ownerId(user);
    return this.db.withTenant(async (tx) => {
      const owner = await tx.query.owners.findFirst({
        where: eq(owners.id, ownerId),
      });
      if (!owner) throw new NotFoundException('Owner not found');
      const venueCount = (
        await tx.select({ c: count() }).from(venues)
      )[0].c;
      if (venueCount >= owner.venueQuota) {
        throw new ConflictException(
          `Venue quota (${owner.venueQuota}) reached`,
        );
      }
      // Only allow games the owner is entitled to (PRD §2.2). An EMPTY
      // allowedGameIds means "all catalogue games allowed" (see
      // super-admin.service), so only enforce the filter when it's non-empty.
      const allowedGameIds = owner.allowedGameIds ?? [];
      if (allowedGameIds.length > 0) {
        const disallowed = dto.gameIds.filter(
          (g) => !allowedGameIds.includes(g),
        );
        if (disallowed.length) {
          throw new BadRequestException('Game not in owner entitlement');
        }
      }
      const venueId = randomUUID();
      await tx.insert(venues).values({
        id: venueId,
        ownerId,
        name: dto.name,
        geoLat: dto.geoLat,
        geoLng: dto.geoLng,
        address: dto.address,
        city: dto.city,
        contactPhone: dto.contactPhone,
        openTime: dto.openTime ?? '06:00',
        closeTime: dto.closeTime ?? '23:00',
      });
      if (dto.gameIds.length > 0) {
        await tx
          .insert(venueGames)
          .values(dto.gameIds.map((gameId) => ({ venueId, gameId })));
      }
      // DB-8: every venue gets a settings row at creation time.
      await tx.insert(venueSettings).values({ venueId });

      const venue = await tx.query.venues.findFirst({
        where: eq(venues.id, venueId),
        with: { venueGames: true, venueSettings: true, bookableUnits: true },
      });
      return this.shapeVenue(venue);
    });
  }

  /** Update a venue's editable fields (PRD §4.1). Tenant-scoped. */
  async updateVenue(user: RequestUser, venueId: string, dto: UpdateVenueDto) {
    const ownerId = this.ownerId(user);
    return this.db.withTenant(async (tx) => {
      // Scope by ownerId explicitly (defense-in-depth): never rely on RLS alone,
      // which is bypassed when the app connects as a superuser.
      const venue = await tx.query.venues.findFirst({
        where: and(eq(venues.id, venueId), eq(venues.ownerId, ownerId)),
      });
      if (!venue) throw new NotFoundException('Venue not found');
      await tx
        .update(venues)
        .set({
          name: dto.name,
          geoLat: dto.geoLat,
          geoLng: dto.geoLng,
          address: dto.address,
          city: dto.city,
          contactPhone: dto.contactPhone,
          openTime: dto.openTime,
          closeTime: dto.closeTime,
          photos: dto.photos,
        })
        .where(eq(venues.id, venueId));
      const updated = await tx.query.venues.findFirst({
        where: eq(venues.id, venueId),
        with: { venueGames: true, venueSettings: true, bookableUnits: true },
      });
      return this.shapeVenue(updated);
    });
  }

  /**
   * Delete a venue. Soft-deactivates (active=false) when it has any units or
   * bookings (historical dependents); otherwise hard-deletes the leaf row
   * (PRD §4.1). Never cascades bookings/ledger.
   */
  async deleteVenue(user: RequestUser, venueId: string) {
    const ownerId = this.ownerId(user);
    return this.db.withTenant(async (tx) => {
      const venue = await tx.query.venues.findFirst({
        where: and(eq(venues.id, venueId), eq(venues.ownerId, ownerId)),
      });
      if (!venue) throw new NotFoundException('Venue not found');

      const [unitCount, bookingCount] = await Promise.all([
        tx
          .select({ c: count() })
          .from(bookableUnits)
          .where(eq(bookableUnits.venueId, venueId))
          .then((r) => r[0].c),
        tx
          .select({ c: count() })
          .from(bookings)
          .where(eq(bookings.venueId, venueId))
          .then((r) => r[0].c),
      ]);

      if (unitCount > 0 || bookingCount > 0) {
        const updated = (
          await tx
            .update(venues)
            .set({ active: false })
            .where(eq(venues.id, venueId))
            .returning()
        )[0];
        return { deactivated: true, venue: updated };
      }

      // Leaf venue: only the cascade-safe venue_games / settings rows attach.
      try {
        await tx.delete(venues).where(eq(venues.id, venueId));
      } catch (err) {
        if (pgErrorCode(err) === PG_FK_VIOLATION) {
          throw new BadRequestException(
            'Venue has dependent records and cannot be deleted; deactivate it instead',
          );
        }
        throw err;
      }
      return { deleted: true, id: venueId };
    });
  }

  async addUnit(user: RequestUser, venueId: string, dto: CreateUnitDto) {
    const ownerId = this.ownerId(user);
    return this.db.withTenant(async (tx) => {
      // Ensure the venue belongs to this owner before attaching a unit.
      const venue = await tx.query.venues.findFirst({
        where: and(eq(venues.id, venueId), eq(venues.ownerId, ownerId)),
      });
      if (!venue) throw new NotFoundException('Venue not found');
      return (
        await tx
          .insert(bookableUnits)
          .values({
            id: randomUUID(),
            venueId,
            ownerId,
            name: dto.name,
            label: dto.label,
            gameId: dto.gameId,
            capacity: dto.capacity,
          })
          .returning()
      )[0];
    });
  }

  /** Update a bookable unit's name/label/capacity (PRD §4.1). Tenant-scoped. */
  async updateUnit(user: RequestUser, unitId: string, dto: UpdateUnitDto) {
    const ownerId = this.ownerId(user);
    return this.db.withTenant(async (tx) => {
      const unit = await tx.query.bookableUnits.findFirst({
        where: and(
          eq(bookableUnits.id, unitId),
          eq(bookableUnits.ownerId, ownerId),
        ),
      });
      if (!unit) throw new NotFoundException('Unit not found');
      return (
        await tx
          .update(bookableUnits)
          .set({
            name: dto.name,
            label: dto.label,
            capacity: dto.capacity,
          })
          .where(eq(bookableUnits.id, unitId))
          .returning()
      )[0];
    });
  }

  /**
   * Delete a bookable unit. Soft-deactivates (active=false) when the unit has
   * any slots/bookings; otherwise hard-deletes the leaf row (PRD §4.1).
   * Never cascades bookings/ledger.
   */
  async deleteUnit(user: RequestUser, unitId: string) {
    const ownerId = this.ownerId(user);
    return this.db.withTenant(async (tx) => {
      const unit = await tx.query.bookableUnits.findFirst({
        where: and(
          eq(bookableUnits.id, unitId),
          eq(bookableUnits.ownerId, ownerId),
        ),
      });
      if (!unit) throw new NotFoundException('Unit not found');

      // A Slot row exists once a unit is booked or blocked; any slot means the
      // unit carries history we must not orphan.
      const slotCount = (
        await tx
          .select({ c: count() })
          .from(slots)
          .where(eq(slots.unitId, unitId))
      )[0].c;
      if (slotCount > 0) {
        const updated = (
          await tx
            .update(bookableUnits)
            .set({ active: false })
            .where(eq(bookableUnits.id, unitId))
            .returning()
        )[0];
        return { deactivated: true, unit: updated };
      }

      // Leaf unit: only pricing rules attach, which cascade safely.
      try {
        await tx.delete(bookableUnits).where(eq(bookableUnits.id, unitId));
      } catch (err) {
        if (pgErrorCode(err) === PG_FK_VIOLATION) {
          throw new BadRequestException(
            'Unit has dependent records and cannot be deleted; deactivate it instead',
          );
        }
        throw err;
      }
      return { deleted: true, id: unitId };
    });
  }

  /** Replace the weekly price grid for a unit (PRD §4.2). */
  async setPricing(user: RequestUser, unitId: string, rules: PricingRuleDto[]) {
    const ownerId = this.ownerId(user);
    return this.db.withTenant(async (tx) => {
      const unit = await tx.query.bookableUnits.findFirst({
        where: and(
          eq(bookableUnits.id, unitId),
          eq(bookableUnits.ownerId, ownerId),
        ),
      });
      if (!unit) throw new NotFoundException('Unit not found');
      await tx.delete(pricingRules).where(eq(pricingRules.unitId, unitId));
      if (rules.length > 0) {
        await tx.insert(pricingRules).values(
          rules.map((r) => ({
            id: randomUUID(),
            unitId,
            ownerId,
            dayType: r.dayType,
            timeBand: r.timeBand,
            // `date` column is string-mode: store the date portion only.
            dateOverride: r.dateOverride
              ? new Date(r.dateOverride).toISOString().slice(0, 10)
              : null,
            minDuration: r.minDuration,
            price: money(new Decimal(r.price)),
          })),
        );
      }
      return tx.query.pricingRules.findMany({
        where: eq(pricingRules.unitId, unitId),
      });
    });
  }

  /**
   * Read a venue's settings, tenant-scoped. Falls back to schema defaults when
   * no settings row exists yet (PRD §4.1). Surfaces cancellation-template help
   * text so callers can explain the policy.
   */
  async getSettings(user: RequestUser, venueId: string) {
    const ownerId = this.ownerId(user);
    return this.db.withTenant(async (tx) => {
      const venue = await tx.query.venues.findFirst({
        where: and(eq(venues.id, venueId), eq(venues.ownerId, ownerId)),
      });
      if (!venue) throw new NotFoundException('Venue not found');

      const settings = await tx.query.venueSettings.findFirst({
        where: eq(venueSettings.venueId, venueId),
      });

      const resolved = settings
        ? {
            cancellationTemplate: settings.cancellationTemplate,
            noShowFee: Number(settings.noShowFee),
            loyaltyEarnRate:
              settings.loyaltyEarnRate === null
                ? null
                : Number(settings.loyaltyEarnRate),
            loyaltyRedeemValue:
              settings.loyaltyRedeemValue === null
                ? null
                : Number(settings.loyaltyRedeemValue),
            openMatchRepaymentMode: settings.openMatchRepaymentMode,
          }
        : { ...VENUE_SETTINGS_DEFAULTS };

      return {
        venueId,
        ...resolved,
        cancellationTemplateHelp:
          CANCELLATION_TEMPLATE_HELP[resolved.cancellationTemplate] ?? null,
      };
    });
  }

  /**
   * Upsert a venue's settings, tenant-scoped (PRD §4.1). Only provided fields
   * are written; decimals are coerced to fixed 2dp strings for numeric columns.
   */
  async updateSettings(user: RequestUser, venueId: string, dto: SettingsDto) {
    const ownerId = this.ownerId(user);
    return this.db.withTenant(async (tx) => {
      const venue = await tx.query.venues.findFirst({
        where: and(eq(venues.id, venueId), eq(venues.ownerId, ownerId)),
      });
      if (!venue) throw new NotFoundException('Venue not found');

      const writable: {
        cancellationTemplate?: string;
        noShowFee?: string;
        loyaltyEarnRate?: string;
        loyaltyRedeemValue?: string;
        openMatchRepaymentMode?: OpenMatchRepaymentMode;
      } = {};
      if (dto.cancellationTemplate !== undefined) {
        writable.cancellationTemplate = dto.cancellationTemplate;
      }
      if (dto.noShowFee !== undefined) {
        writable.noShowFee = money(new Decimal(dto.noShowFee));
      }
      if (dto.loyaltyEarnRate !== undefined) {
        writable.loyaltyEarnRate = new Decimal(dto.loyaltyEarnRate).toFixed(4);
      }
      if (dto.loyaltyRedeemValue !== undefined) {
        writable.loyaltyRedeemValue = money(new Decimal(dto.loyaltyRedeemValue));
      }
      if (dto.openMatchRepaymentMode !== undefined) {
        writable.openMatchRepaymentMode = dto.openMatchRepaymentMode;
      }

      const settings = (
        await tx
          .insert(venueSettings)
          .values({ venueId, ...writable })
          .onConflictDoUpdate({ target: venueSettings.venueId, set: writable })
          .returning()
      )[0];

      return {
        venueId,
        cancellationTemplate: settings.cancellationTemplate,
        noShowFee: Number(settings.noShowFee),
        loyaltyEarnRate:
          settings.loyaltyEarnRate === null
            ? null
            : Number(settings.loyaltyEarnRate),
        loyaltyRedeemValue:
          settings.loyaltyRedeemValue === null
            ? null
            : Number(settings.loyaltyRedeemValue),
        openMatchRepaymentMode: settings.openMatchRepaymentMode,
        cancellationTemplateHelp:
          CANCELLATION_TEMPLATE_HELP[settings.cancellationTemplate] ?? null,
      };
    });
  }

  /**
   * Block a range of slots for maintenance/private use (PRD §4.3).
   *
   * Without `dto.recurrence`: blocks the single [start,end] window, granularity-
   * sliced; any clash aborts with a 409 (behaviour unchanged).
   *
   * With `dto.recurrence` (weekly): the window is repeated for `count` total
   * weeks (including the first), shifting +7 days per occurrence via luxon so
   * wall-clock time survives DST. Mirroring booking recurrence, an occurrence
   * whose slots already exist is SKIPPED (recorded) rather than aborting the
   * whole call. Returns a summary of how many slots were blocked.
   */
  async block(user: RequestUser, dto: BlockSlotsDto) {
    const ownerId = this.ownerId(user);
    return this.db.withTenant(async (tx) => {
      // Scope by ownerId explicitly (defense-in-depth): never rely on RLS alone,
      // which is bypassed when the app connects as a superuser. Prevents blocking
      // another tenant's unit (SEC-6).
      const unit = await tx.query.bookableUnits.findFirst({
        where: and(
          eq(bookableUnits.id, dto.unitId),
          eq(bookableUnits.ownerId, ownerId),
        ),
        with: { gameCatalogue: true },
      });
      if (!unit) throw new NotFoundException('Unit not found');
      const granularity = unit.gameCatalogue.slotGranularityMin;

      const start = DateTime.fromISO(dto.start);
      const end = DateTime.fromISO(dto.end);

      // No recurrence → single window; a clash aborts (unchanged behaviour).
      if (!dto.recurrence) {
        const created = await this.blockWindow(
          tx,
          dto.unitId,
          ownerId,
          start,
          end,
          granularity,
          dto.reason,
          true,
        );
        return { blocked: created };
      }

      // Recurring weekly: repeat the window for `count` total weeks. Each
      // occurrence is best-effort — a clashing week is skipped (recorded) so
      // one collision doesn't abort the rest of the series.
      let blocked = 0;
      const skipped: { start: string; reason: string }[] = [];
      for (let week = 0; week < dto.recurrence.count; week++) {
        const wStart = start.plus({ weeks: week });
        const wEnd = end.plus({ weeks: week });

        const conflict = await this.findBlockConflict(
          tx,
          dto.unitId,
          wStart,
          wEnd,
          granularity,
        );
        if (conflict) {
          skipped.push({ start: wStart.toISO()!, reason: conflict });
          continue;
        }

        blocked += await this.blockWindow(
          tx,
          dto.unitId,
          ownerId,
          wStart,
          wEnd,
          granularity,
          dto.reason,
          false,
        );
      }

      return { blocked, weeks: dto.recurrence.count, skipped };
    });
  }

  /**
   * Insert blocked slot rows for a single [start,end) window, sliced by
   * granularity. When `throwOnConflict` is true a unique violation surfaces as a
   * 409 (single-window path); when false the caller has pre-checked conflicts
   * so a stray collision is swallowed (recurring path, defensive). Returns the
   * number of slots created.
   */
  private async blockWindow(
    tx: DbTx,
    unitId: string,
    ownerId: string,
    start: DateTime,
    end: DateTime,
    granularity: number,
    reason: string | undefined,
    throwOnConflict: boolean,
  ): Promise<number> {
    let cursor = start;
    let created = 0;
    while (cursor < end) {
      const next = cursor.plus({ minutes: granularity });
      try {
        await tx.insert(slots).values({
          id: randomUUID(),
          unitId,
          ownerId,
          startsAt: cursor.toJSDate(),
          endsAt: next.toJSDate(),
          status: 'blocked',
          blockReason: reason,
        });
        created++;
      } catch (err) {
        if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
          if (throwOnConflict) {
            throw new ConflictException(
              `Slot at ${cursor.toISO()} is already booked/blocked`,
            );
          }
          // Recurring path: pre-checked, so just skip this stray collision.
        } else {
          throw err;
        }
      }
      cursor = next;
    }
    return created;
  }

  /**
   * Pre-check whether any slice of a [start,end) window already has a Slot row
   * (booked/blocked) for the unit. Used by the recurring block path to SKIP a
   * clashing week instead of letting an insert throw a unique violation — which
   * in Postgres would abort the whole transaction. Returns a human-readable
   * reason for the first clash, or null if the window is entirely free.
   */
  private async findBlockConflict(
    tx: DbTx,
    unitId: string,
    start: DateTime,
    end: DateTime,
    granularity: number,
  ): Promise<string | null> {
    const starts: Date[] = [];
    let cursor = start;
    while (cursor < end) {
      starts.push(cursor.toJSDate());
      cursor = cursor.plus({ minutes: granularity });
    }
    if (starts.length === 0) return null;

    const existing = await tx.query.slots.findFirst({
      where: and(
        eq(slots.unitId, unitId),
        inArray(slots.startsAt, starts),
      ),
    });
    if (!existing) return null;
    return existing.status === 'blocked'
      ? 'Slot is blocked for this time.'
      : 'Slot is already booked for this time.';
  }

  /**
   * Read a unit's stored pricing grid for the editor to preload (PRD §4.2).
   * Owner/staff-scoped with the same ownership check as setPricing(). Returns
   * the rules' editable fields (id, dayType, timeBand, dateOverride,
   * minDuration, price).
   */
  async getPricing(user: RequestUser, unitId: string) {
    const ownerId = this.ownerId(user);
    return this.db.withTenant(async (tx) => {
      // Scope by ownerId explicitly (defense-in-depth): never rely on RLS alone,
      // which is bypassed when the app connects as a superuser (SEC-6).
      const unit = await tx.query.bookableUnits.findFirst({
        where: and(
          eq(bookableUnits.id, unitId),
          eq(bookableUnits.ownerId, ownerId),
        ),
      });
      if (!unit) throw new NotFoundException('Unit not found');

      const rules = await tx.query.pricingRules.findMany({
        where: eq(pricingRules.unitId, unitId),
      });
      return rules.map((r) => ({
        id: r.id,
        dayType: r.dayType,
        timeBand: r.timeBand,
        dateOverride: r.dateOverride,
        minDuration: r.minDuration,
        price: num(r.price),
      }));
    });
  }
}
