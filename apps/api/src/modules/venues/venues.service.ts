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
 * Schema defaults for VenueSettings (mirrors prisma defaults), used when no
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
      // Only allow games the owner is entitled to (PRD §2.2). An EMPTY
      // allowedGameIds means "all catalogue games allowed" (see
      // super-admin.service), so only enforce the filter when it's non-empty.
      if (owner.allowedGameIds.length > 0) {
        const disallowed = dto.gameIds.filter(
          (g) => !owner.allowedGameIds.includes(g),
        );
        if (disallowed.length) {
          throw new BadRequestException('Game not in owner entitlement');
        }
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

  /** Update a venue's editable fields (PRD §4.1). Tenant-scoped. */
  async updateVenue(user: RequestUser, venueId: string, dto: UpdateVenueDto) {
    const ownerId = this.ownerId(user);
    return this.prisma.withTenant(async (tx) => {
      // Scope by ownerId explicitly (defense-in-depth): never rely on RLS alone,
      // which is bypassed when the app connects as a superuser.
      const venue = await tx.venue.findFirst({ where: { id: venueId, ownerId } });
      if (!venue) throw new NotFoundException('Venue not found');
      return tx.venue.update({
        where: { id: venueId },
        data: {
          name: dto.name,
          geoLat: dto.geoLat,
          geoLng: dto.geoLng,
          address: dto.address,
          city: dto.city,
          contactPhone: dto.contactPhone,
          openTime: dto.openTime,
          closeTime: dto.closeTime,
          photos: dto.photos,
        },
        include: { games: true, settings: true, units: true },
      });
    });
  }

  /**
   * Delete a venue. Soft-deactivates (active=false) when it has any units or
   * bookings (historical dependents); otherwise hard-deletes the leaf row
   * (PRD §4.1). Never cascades bookings/ledger.
   */
  async deleteVenue(user: RequestUser, venueId: string) {
    const ownerId = this.ownerId(user);
    return this.prisma.withTenant(async (tx) => {
      const venue = await tx.venue.findFirst({ where: { id: venueId, ownerId } });
      if (!venue) throw new NotFoundException('Venue not found');

      const [unitCount, bookingCount] = await Promise.all([
        tx.bookableUnit.count({ where: { venueId } }),
        tx.booking.count({ where: { venueId } }),
      ]);

      if (unitCount > 0 || bookingCount > 0) {
        const updated = await tx.venue.update({
          where: { id: venueId },
          data: { active: false },
        });
        return { deactivated: true, venue: updated };
      }

      // Leaf venue: only the cascade-safe venue_games / settings rows attach.
      try {
        await tx.venue.delete({ where: { id: venueId } });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2003'
        ) {
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
    return this.prisma.withTenant(async (tx) => {
      // Ensure the venue belongs to this owner before attaching a unit.
      const venue = await tx.venue.findFirst({ where: { id: venueId, ownerId } });
      if (!venue) throw new NotFoundException('Venue not found');
      return tx.bookableUnit.create({
        data: {
          venueId,
          ownerId,
          name: dto.name,
          label: dto.label,
          gameId: dto.gameId,
          capacity: dto.capacity,
        },
      });
    });
  }

  /** Update a bookable unit's name/label/capacity (PRD §4.1). Tenant-scoped. */
  async updateUnit(user: RequestUser, unitId: string, dto: UpdateUnitDto) {
    const ownerId = this.ownerId(user);
    return this.prisma.withTenant(async (tx) => {
      const unit = await tx.bookableUnit.findFirst({ where: { id: unitId, ownerId } });
      if (!unit) throw new NotFoundException('Unit not found');
      return tx.bookableUnit.update({
        where: { id: unitId },
        data: {
          name: dto.name,
          label: dto.label,
          capacity: dto.capacity,
        },
      });
    });
  }

  /**
   * Delete a bookable unit. Soft-deactivates (active=false) when the unit has
   * any slots/bookings; otherwise hard-deletes the leaf row (PRD §4.1).
   * Never cascades bookings/ledger.
   */
  async deleteUnit(user: RequestUser, unitId: string) {
    const ownerId = this.ownerId(user);
    return this.prisma.withTenant(async (tx) => {
      const unit = await tx.bookableUnit.findFirst({ where: { id: unitId, ownerId } });
      if (!unit) throw new NotFoundException('Unit not found');

      // A Slot row exists once a unit is booked or blocked; any slot means the
      // unit carries history we must not orphan.
      const slotCount = await tx.slot.count({ where: { unitId } });
      if (slotCount > 0) {
        const updated = await tx.bookableUnit.update({
          where: { id: unitId },
          data: { active: false },
        });
        return { deactivated: true, unit: updated };
      }

      // Leaf unit: only pricing rules attach, which cascade safely.
      try {
        await tx.bookableUnit.delete({ where: { id: unitId } });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2003'
        ) {
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
    return this.prisma.withTenant(async (tx) => {
      const unit = await tx.bookableUnit.findFirst({ where: { id: unitId, ownerId } });
      if (!unit) throw new NotFoundException('Unit not found');
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

  /**
   * Read a venue's settings, tenant-scoped. Falls back to schema defaults when
   * no settings row exists yet (PRD §4.1). Surfaces cancellation-template help
   * text so callers can explain the policy.
   */
  async getSettings(user: RequestUser, venueId: string) {
    const ownerId = this.ownerId(user);
    return this.prisma.withTenant(async (tx) => {
      const venue = await tx.venue.findFirst({ where: { id: venueId, ownerId } });
      if (!venue) throw new NotFoundException('Venue not found');

      const settings = await tx.venueSettings.findUnique({
        where: { venueId },
      });

      const resolved = settings
        ? {
            cancellationTemplate: settings.cancellationTemplate,
            noShowFee: settings.noShowFee.toNumber(),
            loyaltyEarnRate: settings.loyaltyEarnRate?.toNumber() ?? null,
            loyaltyRedeemValue: settings.loyaltyRedeemValue?.toNumber() ?? null,
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
   * are written; decimals are coerced to Prisma.Decimal.
   */
  async updateSettings(user: RequestUser, venueId: string, dto: SettingsDto) {
    const ownerId = this.ownerId(user);
    return this.prisma.withTenant(async (tx) => {
      const venue = await tx.venue.findFirst({ where: { id: venueId, ownerId } });
      if (!venue) throw new NotFoundException('Venue not found');

      const writable: {
        cancellationTemplate?: string;
        noShowFee?: Prisma.Decimal;
        loyaltyEarnRate?: Prisma.Decimal;
        loyaltyRedeemValue?: Prisma.Decimal;
        openMatchRepaymentMode?: OpenMatchRepaymentMode;
      } = {};
      if (dto.cancellationTemplate !== undefined) {
        writable.cancellationTemplate = dto.cancellationTemplate;
      }
      if (dto.noShowFee !== undefined) {
        writable.noShowFee = new Prisma.Decimal(dto.noShowFee);
      }
      if (dto.loyaltyEarnRate !== undefined) {
        writable.loyaltyEarnRate = new Prisma.Decimal(dto.loyaltyEarnRate);
      }
      if (dto.loyaltyRedeemValue !== undefined) {
        writable.loyaltyRedeemValue = new Prisma.Decimal(dto.loyaltyRedeemValue);
      }
      if (dto.openMatchRepaymentMode !== undefined) {
        writable.openMatchRepaymentMode = dto.openMatchRepaymentMode;
      }

      const settings = await tx.venueSettings.upsert({
        where: { venueId },
        create: { venueId, ...writable },
        update: writable,
      });

      return {
        venueId,
        cancellationTemplate: settings.cancellationTemplate,
        noShowFee: settings.noShowFee.toNumber(),
        loyaltyEarnRate: settings.loyaltyEarnRate?.toNumber() ?? null,
        loyaltyRedeemValue: settings.loyaltyRedeemValue?.toNumber() ?? null,
        openMatchRepaymentMode: settings.openMatchRepaymentMode,
        cancellationTemplateHelp:
          CANCELLATION_TEMPLATE_HELP[settings.cancellationTemplate] ?? null,
      };
    });
  }

  /** Block a range of slots for maintenance/private use (PRD §4.3). */
  async block(user: RequestUser, dto: BlockSlotsDto) {
    const ownerId = this.ownerId(user);
    return this.prisma.withTenant(async (tx) => {
      // Scope by ownerId explicitly (defense-in-depth): never rely on RLS alone,
      // which is bypassed when the app connects as a superuser. Prevents blocking
      // another tenant's unit (SEC-6).
      const unit = await tx.bookableUnit.findFirst({
        where: { id: dto.unitId, ownerId },
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
