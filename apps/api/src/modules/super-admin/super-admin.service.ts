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
import { PrismaService } from '../../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

  // ---- Game catalogue (PRD §3.1) ----
  listGames() {
    return this.prisma.gameCatalogue.findMany({ orderBy: { name: 'asc' } });
  }

  createGame(dto: CreateGameDto) {
    return this.prisma.gameCatalogue.create({
      data: {
        name: dto.name,
        iconUrl: dto.iconUrl,
        slotGranularityMin: dto.slotGranularityMin,
        unitLabel: dto.unitLabel,
        minPlayers: dto.minPlayers,
        maxPlayers: dto.maxPlayers,
        defaultOpenTime: dto.defaultOpenTime ?? '06:00',
        defaultCloseTime: dto.defaultCloseTime ?? '23:00',
      },
    });
  }

  updateGame(id: string, dto: UpdateGameDto) {
    return this.prisma.gameCatalogue.update({
      where: { id },
      data: {
        name: dto.name,
        iconUrl: dto.iconUrl,
        slotGranularityMin: dto.slotGranularityMin,
        unitLabel: dto.unitLabel,
        minPlayers: dto.minPlayers,
        maxPlayers: dto.maxPlayers,
        defaultOpenTime: dto.defaultOpenTime,
        defaultCloseTime: dto.defaultCloseTime,
      },
    });
  }

  /**
   * Hard-delete a game-catalogue entry. The catalogue has no soft-delete
   * column, so we refuse (400) when any venue or bookable unit still
   * references the game rather than orphaning venue_games / violating FKs.
   */
  async deleteGame(id: string) {
    // venue_games / bookable_unit are tenant-scoped under RLS, so count
    // references across all tenants with the bypass context.
    const refs = await this.prisma.withTenantBypass(async (tx) => {
      const [venueRefs, unitRefs] = await Promise.all([
        tx.venueGame.count({ where: { gameId: id } }),
        tx.bookableUnit.count({ where: { gameId: id } }),
      ]);
      return venueRefs + unitRefs;
    });
    if (refs > 0) {
      throw new BadRequestException(
        'Cannot delete game: it is still referenced by one or more venues. Remove the game from all venues first.',
      );
    }
    return this.prisma.gameCatalogue.delete({ where: { id } });
  }

  // ---- Owner onboarding (PRD §3.2) ----
  async createOwner(dto: CreateOwnerDto) {
    return this.prisma.withTenantBypass(async (tx) => {
      const owner = await tx.owner.create({
        data: {
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
          setupFee: dto.setupFee,
          amcAmount: dto.amcAmount,
          amcRenewalDate: dto.amcRenewalDate
            ? new Date(dto.amcRenewalDate)
            : undefined,
        },
      });

      // Provision the owner-admin login (PRD §3.2 step 5).
      await tx.user.create({
        data: {
          role: UserRole.OWNER,
          ownerId: owner.id,
          name: `${dto.name} Admin`,
          email: dto.contactEmail,
          passwordHash: await bcrypt.hash(dto.adminPassword, 10),
        },
      });

      return owner;
    });
  }

  // ---- Oversight (PRD §3.3) ----
  async listOwners() {
    return this.prisma.withTenantBypass(async (tx) => {
      const owners = await tx.owner.findMany({
        include: { _count: { select: { venues: true } } },
        orderBy: { createdAt: 'desc' },
      });
      const now = Date.now();
      return owners.map((o) => ({
        id: o.id,
        name: o.name,
        status: o.status,
        contactEmail: o.contactEmail,
        logoUrl: o.logoUrl,
        venueQuota: o.venueQuota,
        venueCount: o._count.venues,
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
    return this.prisma.withTenantBypass(async (tx) => {
      const data: Record<string, unknown> = {};

      if (dto.venueQuota !== undefined) data.venueQuota = dto.venueQuota;
      if (dto.allowedGameIds !== undefined)
        data.allowedGameIds = dto.allowedGameIds;
      if (dto.featureFlags !== undefined) data.featureFlags = dto.featureFlags;
      if (dto.setupFee !== undefined) data.setupFee = dto.setupFee;
      if (dto.amcAmount !== undefined) data.amcAmount = dto.amcAmount;
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

      const o = await tx.owner.update({
        where: { id: ownerId },
        data,
        include: { _count: { select: { venues: true } } },
      });

      const now = Date.now();
      return {
        id: o.id,
        name: o.name,
        status: o.status,
        contactEmail: o.contactEmail,
        logoUrl: o.logoUrl,
        venueQuota: o.venueQuota,
        venueCount: o._count.venues,
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
    return this.prisma.withTenantBypass((tx) =>
      tx.owner.update({
        where: { id: ownerId },
        data: { status: status as OwnerStatus },
      }),
    );
  }
}
