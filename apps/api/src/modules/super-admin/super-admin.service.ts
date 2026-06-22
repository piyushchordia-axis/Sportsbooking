import { BadRequestException, Injectable } from '@nestjs/common';
import { FeatureFlag, OwnerStatus, UserRole } from '@sportsbooking/shared';
import * as bcrypt from 'bcryptjs';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { randomUUID } from 'node:crypto';
import { asc, count, desc, eq } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { dec, money } from '../../db/money';
import {
  bookableUnits,
  gameCatalogue,
  owners,
  users,
  venueGames,
  venues,
} from '../../db/schema';
import {
  CreateGameDto,
  CreateOwnerDto,
  OwnerBrandingDto,
  UpdateGameDto,
} from './dto';

/**
 * Editable owner entitlements (FE-2). Every field is optional so the super
 * admin can PATCH any subset; omitted fields are left untouched. Lives here
 * (not dto.ts) so the change stays within the assigned files.
 */
export class UpdateOwnerDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  venueQuota?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedGameIds?: string[];

  @IsOptional()
  @IsArray()
  @IsEnum(FeatureFlag, { each: true })
  featureFlags?: FeatureFlag[];

  @IsOptional()
  @ValidateNested()
  @Type(() => OwnerBrandingDto)
  branding?: OwnerBrandingDto;

  @IsOptional()
  @IsNumber()
  setupFee?: number;

  @IsOptional()
  @IsNumber()
  amcAmount?: number;

  @IsOptional()
  @IsString()
  amcRenewalDate?: string;
}

/**
 * Super Admin operations (PRD §3): global game catalogue, owner onboarding,
 * and oversight. Runs under RLS bypass (super admin context).
 */
@Injectable()
export class SuperAdminService {
  constructor(private readonly db: DbService) {}

  // ---- Game catalogue (PRD §3.1) ----
  listGames() {
    // game_catalogue is a global (non-tenant) table: read it directly.
    return this.db.db.query.gameCatalogue.findMany({
      orderBy: asc(gameCatalogue.name),
    });
  }

  async createGame(dto: CreateGameDto) {
    return (
      await this.db.db
        .insert(gameCatalogue)
        .values({
          id: randomUUID(),
          name: dto.name,
          iconUrl: dto.iconUrl,
          slotGranularityMin: dto.slotGranularityMin,
          unitLabel: dto.unitLabel,
          minPlayers: dto.minPlayers,
          maxPlayers: dto.maxPlayers,
          defaultOpenTime: dto.defaultOpenTime ?? '06:00',
          defaultCloseTime: dto.defaultCloseTime ?? '23:00',
        })
        .returning()
    )[0];
  }

  async updateGame(id: string, dto: UpdateGameDto) {
    return (
      await this.db.db
        .update(gameCatalogue)
        .set({
          name: dto.name,
          iconUrl: dto.iconUrl,
          slotGranularityMin: dto.slotGranularityMin,
          unitLabel: dto.unitLabel,
          minPlayers: dto.minPlayers,
          maxPlayers: dto.maxPlayers,
          defaultOpenTime: dto.defaultOpenTime,
          defaultCloseTime: dto.defaultCloseTime,
        })
        .where(eq(gameCatalogue.id, id))
        .returning()
    )[0];
  }

  /**
   * Hard-delete a game-catalogue entry. The catalogue has no soft-delete
   * column, so we refuse (400) when any venue or bookable unit still
   * references the game rather than orphaning venue_games / violating FKs.
   */
  async deleteGame(id: string) {
    // venue_games / bookable_unit are tenant-scoped under RLS, so count
    // references across all tenants with the bypass context.
    const refs = await this.db.withTenantBypass(async (tx) => {
      const [venueRefs, unitRefs] = await Promise.all([
        tx
          .select({ c: count() })
          .from(venueGames)
          .where(eq(venueGames.gameId, id)),
        tx
          .select({ c: count() })
          .from(bookableUnits)
          .where(eq(bookableUnits.gameId, id)),
      ]);
      return venueRefs[0].c + unitRefs[0].c;
    });
    if (refs > 0) {
      throw new BadRequestException(
        'Cannot delete game: it is still referenced by one or more venues. Remove the game from all venues first.',
      );
    }
    return (
      await this.db.db
        .delete(gameCatalogue)
        .where(eq(gameCatalogue.id, id))
        .returning()
    )[0];
  }

  // ---- Owner onboarding (PRD §3.2) ----
  async createOwner(dto: CreateOwnerDto) {
    return this.db.withTenantBypass(async (tx) => {
      const owner = (
        await tx
          .insert(owners)
          .values({
            id: randomUUID(),
            name: dto.name,
            contactEmail: dto.contactEmail,
            contactMobile: dto.contactMobile,
            status: OwnerStatus.ACTIVE,
            venueQuota: dto.venueQuota,
            // When allowedGameIds is omitted, keep the current behaviour (all
            // games => empty restriction set, the schema default). When provided,
            // assign exactly that set.
            allowedGameIds: dto.allowedGameIds ?? undefined,
            featureFlags: dto.featureFlags,
            // White-label branding (PRD §4.10). Omitted colour fields fall back
            // to the schema defaults via `undefined`.
            logoUrl: dto.branding?.logoUrl,
            primaryColor: dto.branding?.primaryColor ?? undefined,
            secondaryColor: dto.branding?.secondaryColor ?? undefined,
            accentColor: dto.branding?.accentColor ?? undefined,
            setupFee:
              dto.setupFee !== undefined ? money(dec(dto.setupFee)) : undefined,
            amcAmount:
              dto.amcAmount !== undefined
                ? money(dec(dto.amcAmount))
                : undefined,
            amcRenewalDate: dto.amcRenewalDate
              ? new Date(dto.amcRenewalDate)
              : undefined,
            updatedAt: new Date(),
          })
          .returning()
      )[0];

      // Provision the owner-admin login (PRD §3.2 step 5).
      await tx.insert(users).values({
        id: randomUUID(),
        role: UserRole.OWNER,
        ownerId: owner.id,
        name: `${dto.name} Admin`,
        email: dto.contactEmail,
        passwordHash: await bcrypt.hash(dto.adminPassword, 10),
      });

      return owner;
    });
  }

  // ---- Oversight (PRD §3.3) ----
  async listOwners() {
    return this.db.withTenantBypass(async (tx) => {
      const ownerRows = await tx.query.owners.findMany({
        orderBy: desc(owners.createdAt),
      });
      // Count venues per owner in one grouped query.
      const venueCounts = await tx
        .select({ ownerId: venues.ownerId, c: count() })
        .from(venues)
        .groupBy(venues.ownerId);
      const countByOwner = new Map(
        venueCounts.map((v) => [v.ownerId, v.c]),
      );
      const now = Date.now();
      return ownerRows.map((o) => ({
        id: o.id,
        name: o.name,
        status: o.status,
        contactEmail: o.contactEmail,
        logoUrl: o.logoUrl,
        venueQuota: o.venueQuota,
        venueCount: countByOwner.get(o.id) ?? 0,
        allowedGameIds: o.allowedGameIds,
        featureFlags: o.featureFlags,
        amcRenewalDate: o.amcRenewalDate?.toISOString() ?? null,
        // Surface overdue AMC so the admin UI can flag/suspend the operator
        // (no cron — manual status PATCH remains the action). PRD §3.3.
        amcOverdue: o.amcRenewalDate ? o.amcRenewalDate.getTime() < now : false,
      }));
    });
  }

  /**
   * Edit owner entitlements after onboarding (FE-2). Applies any provided
   * subset of fields; omitted fields are left untouched. Scoped by ownerId
   * under the RLS-bypass context. Returns the same shape as listOwners entries.
   */
  async updateOwner(ownerId: string, dto: UpdateOwnerDto) {
    return this.db.withTenantBypass(async (tx) => {
      const data: Partial<typeof owners.$inferInsert> = {};

      if (dto.venueQuota !== undefined) data.venueQuota = dto.venueQuota;
      if (dto.allowedGameIds !== undefined)
        data.allowedGameIds = dto.allowedGameIds;
      if (dto.featureFlags !== undefined) data.featureFlags = dto.featureFlags;
      if (dto.setupFee !== undefined) data.setupFee = money(dec(dto.setupFee));
      if (dto.amcAmount !== undefined) data.amcAmount = money(dec(dto.amcAmount));
      if (dto.amcRenewalDate !== undefined)
        data.amcRenewalDate = dto.amcRenewalDate
          ? new Date(dto.amcRenewalDate)
          : null;

      if (dto.branding) {
        if (dto.branding.logoUrl !== undefined)
          data.logoUrl = dto.branding.logoUrl;
        if (dto.branding.primaryColor !== undefined)
          data.primaryColor = dto.branding.primaryColor;
        if (dto.branding.secondaryColor !== undefined)
          data.secondaryColor = dto.branding.secondaryColor;
        if (dto.branding.accentColor !== undefined)
          data.accentColor = dto.branding.accentColor;
      }

      // Owner.updatedAt is maintained in app code; bump it on every write.
      data.updatedAt = new Date();

      const o = (
        await tx
          .update(owners)
          .set(data)
          .where(eq(owners.id, ownerId))
          .returning()
      )[0];

      const venueRows = await tx
        .select({ c: count() })
        .from(venues)
        .where(eq(venues.ownerId, ownerId));
      const venueCount = venueRows[0].c;

      const now = Date.now();
      return {
        id: o.id,
        name: o.name,
        status: o.status,
        contactEmail: o.contactEmail,
        logoUrl: o.logoUrl,
        venueQuota: o.venueQuota,
        venueCount,
        allowedGameIds: o.allowedGameIds,
        featureFlags: o.featureFlags,
        amcRenewalDate: o.amcRenewalDate?.toISOString() ?? null,
        amcOverdue: o.amcRenewalDate ? o.amcRenewalDate.getTime() < now : false,
      };
    });
  }

  async setOwnerStatus(ownerId: string, status: string) {
    if (!Object.values(OwnerStatus).includes(status as OwnerStatus)) {
      throw new BadRequestException(
        `Invalid owner status '${status}'. Allowed values: ${Object.values(
          OwnerStatus,
        ).join(', ')}.`,
      );
    }
    return this.db.withTenantBypass(
      async (tx) =>
        (
          await tx
            .update(owners)
            .set({ status: status as OwnerStatus, updatedAt: new Date() })
            .where(eq(owners.id, ownerId))
            .returning()
        )[0],
    );
  }
}
