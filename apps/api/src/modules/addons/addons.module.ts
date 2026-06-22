import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Module } from '@nestjs/common';
import { AddonType, FeatureFlag, UserRole } from '@sportsbooking/shared';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FeatureFlagGuard } from '../../common/guards/feature-flag.guard';
import { RequireFlag } from '../../common/decorators/require-flag.decorator';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, count, eq } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { Decimal, money } from '../../db/money';
import { addons, bookingAddons } from '../../db/schema';

/** Postgres SQLSTATE for a foreign-key violation (was Prisma P2003). */
const PG_FK_VIOLATION = '23503';

/** Narrow an unknown error to a pg driver error carrying a SQLSTATE `code`. */
function pgErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

class CreateAddonDto {
  @IsString() name!: string;
  @IsEnum(AddonType) type!: AddonType;
  @IsNumber() price!: number;
  @IsOptional() @IsInt() @Min(0) stock?: number;
}

class UpdateAddonDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(AddonType) type?: AddonType;
  @IsOptional() @IsNumber() price?: number;
  // stock = null clears the cap (unlimited); omit to leave unchanged.
  @IsOptional() @IsInt() @Min(0) stock?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

class ToggleActiveDto {
  // Omit to flip the current state; provide to set it explicitly.
  @IsOptional() @IsBoolean() active?: boolean;
}

/**
 * Per-venue add-on catalogue: equipment rental, café items, coaching sessions
 * (PRD §4.6). Add-ons attach to a booking at checkout and appear as line items.
 */
@Injectable()
export class AddonsService {
  constructor(private readonly db: DbService) {}

  private ownerId(user: RequestUser): string {
    if (!user.ownerId) throw new BadRequestException('No tenant context');
    return user.ownerId;
  }

  create(user: RequestUser, venueId: string, dto: CreateAddonDto) {
    return this.db.withTenant(async (tx) => {
      const [addon] = await tx
        .insert(addons)
        .values({
          id: randomUUID(),
          ownerId: user.ownerId!,
          venueId,
          name: dto.name,
          type: dto.type,
          price: money(new Decimal(dto.price)),
          stock: dto.stock ?? null,
        })
        .returning();
      return addon;
    });
  }

  /** Public list for a venue (used at customer checkout). */
  list(venueId: string) {
    return this.db.withTenantBypass((tx) =>
      tx.query.addons.findMany({
        where: and(eq(addons.venueId, venueId), eq(addons.active, true)),
      }),
    );
  }

  /** Owner/staff fetch of a single add-on within the current tenant. */
  async get(user: RequestUser, addonId: string) {
    const ownerId = this.ownerId(user);
    // Scope by ownerId explicitly (defense-in-depth): never rely on RLS alone,
    // which a superuser DB connection bypasses.
    const addon = await this.db.withTenant((tx) =>
      tx.query.addons.findFirst({
        where: and(eq(addons.id, addonId), eq(addons.ownerId, ownerId)),
      }),
    );
    if (!addon) throw new NotFoundException('Add-on not found');
    return addon;
  }

  /** Update mutable fields of an add-on (name/type/price/stock/active). */
  async update(user: RequestUser, addonId: string, dto: UpdateAddonDto) {
    const ownerId = this.ownerId(user);
    return this.db.withTenant(async (tx) => {
      // Scope by ownerId explicitly (defense-in-depth): never rely on RLS alone.
      const existing = await tx.query.addons.findFirst({
        where: and(eq(addons.id, addonId), eq(addons.ownerId, ownerId)),
      });
      if (!existing) throw new NotFoundException('Add-on not found');

      const data: Partial<typeof addons.$inferInsert> = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.type !== undefined) data.type = dto.type;
      if (dto.price !== undefined) data.price = money(new Decimal(dto.price));
      if (dto.stock !== undefined) data.stock = dto.stock; // null => unlimited
      if (dto.active !== undefined) data.active = dto.active;

      const [updated] = await tx
        .update(addons)
        .set(data)
        .where(eq(addons.id, addonId))
        .returning();
      return updated;
    });
  }

  /** Toggle (or explicitly set) the active flag — soft deactivation. */
  async setActive(user: RequestUser, addonId: string, active?: boolean) {
    const ownerId = this.ownerId(user);
    return this.db.withTenant(async (tx) => {
      // Scope by ownerId explicitly (defense-in-depth): never rely on RLS alone.
      const existing = await tx.query.addons.findFirst({
        where: and(eq(addons.id, addonId), eq(addons.ownerId, ownerId)),
      });
      if (!existing) throw new NotFoundException('Add-on not found');
      const next = active ?? !existing.active;
      const [updated] = await tx
        .update(addons)
        .set({ active: next })
        .where(eq(addons.id, addonId))
        .returning();
      return updated;
    });
  }

  /**
   * Hard-delete an add-on when it is a leaf (no booking line items reference
   * it). If it is referenced by booking history, deactivate instead so the
   * historical line items remain intact, and report the outcome.
   */
  async remove(user: RequestUser, addonId: string) {
    const ownerId = this.ownerId(user);
    return this.db.withTenant(async (tx) => {
      // Scope by ownerId explicitly (defense-in-depth): never rely on RLS alone.
      const existing = await tx.query.addons.findFirst({
        where: and(eq(addons.id, addonId), eq(addons.ownerId, ownerId)),
      });
      if (!existing) throw new NotFoundException('Add-on not found');

      const [{ c: referenced }] = await tx
        .select({ c: count() })
        .from(bookingAddons)
        .where(eq(bookingAddons.addonId, addonId));
      if (referenced > 0) {
        const [addon] = await tx
          .update(addons)
          .set({ active: false })
          .where(eq(addons.id, addonId))
          .returning();
        return { deleted: false, deactivated: true, addon };
      }

      try {
        await tx.delete(addons).where(eq(addons.id, addonId));
      } catch (err) {
        // Guard against a concurrent FK reference slipping in between the
        // count and the delete — surface a 400 rather than a raw driver error.
        if (pgErrorCode(err) === PG_FK_VIOLATION) {
          throw new BadRequestException(
            'Add-on is referenced by a booking and cannot be deleted; deactivate it instead',
          );
        }
        throw err;
      }
      return { deleted: true, deactivated: false };
    });
  }
}

@Controller()
export class AddonsController {
  constructor(private readonly addons: AddonsService) {}

  @Post('venues/:venueId/addons')
  @UseGuards(RolesGuard, FeatureFlagGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @RequireFlag(FeatureFlag.ADDONS)
  create(
    @CurrentUser() user: RequestUser,
    @Param('venueId') venueId: string,
    @Body() dto: CreateAddonDto,
  ) {
    return this.addons.create(user, venueId, dto);
  }

  @Public()
  @Get('venues/:venueId/addons')
  list(@Param('venueId') venueId: string) {
    return this.addons.list(venueId);
  }

  @Get('addons/:addonId')
  @UseGuards(RolesGuard, FeatureFlagGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @RequireFlag(FeatureFlag.ADDONS)
  get(
    @CurrentUser() user: RequestUser,
    @Param('addonId') addonId: string,
  ) {
    return this.addons.get(user, addonId);
  }

  @Patch('addons/:addonId')
  @UseGuards(RolesGuard, FeatureFlagGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @RequireFlag(FeatureFlag.ADDONS)
  update(
    @CurrentUser() user: RequestUser,
    @Param('addonId') addonId: string,
    @Body() dto: UpdateAddonDto,
  ) {
    return this.addons.update(user, addonId, dto);
  }

  @Patch('addons/:addonId/active')
  @UseGuards(RolesGuard, FeatureFlagGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @RequireFlag(FeatureFlag.ADDONS)
  setActive(
    @CurrentUser() user: RequestUser,
    @Param('addonId') addonId: string,
    @Body() dto: ToggleActiveDto,
  ) {
    return this.addons.setActive(user, addonId, dto.active);
  }

  @Delete('addons/:addonId')
  @UseGuards(RolesGuard, FeatureFlagGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @RequireFlag(FeatureFlag.ADDONS)
  remove(
    @CurrentUser() user: RequestUser,
    @Param('addonId') addonId: string,
  ) {
    return this.addons.remove(user, addonId);
  }
}

@Module({
  controllers: [AddonsController],
  providers: [AddonsService],
})
export class AddonsModule {}
