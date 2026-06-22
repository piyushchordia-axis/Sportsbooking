import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, count, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { DbService } from '../../db/db.service';
import type { DbTx } from '../../db';
import { Decimal, money } from '../../db/money';
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
  CreateUnitDto,
  CreateVenueDto,
  PricingRuleDto,
  SettingsDto,
  UpdateUnitDto,
  UpdateVenueDto,
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

  /** Block a range of slots for maintenance/private use (PRD §4.3). */
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

      let cursor = DateTime.fromISO(dto.start);
      const end = DateTime.fromISO(dto.end);
      const created: string[] = [];
      while (cursor < end) {
        const next = cursor.plus({ minutes: granularity });
        try {
          const slot = (
            await tx
              .insert(slots)
              .values({
                id: randomUUID(),
                unitId: dto.unitId,
                ownerId,
                startsAt: cursor.toJSDate(),
                endsAt: next.toJSDate(),
                status: 'blocked',
                blockReason: dto.reason,
              })
              .returning()
          )[0];
          created.push(slot.id);
        } catch (err) {
          if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
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
