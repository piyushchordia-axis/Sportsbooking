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
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  private ownerId(user: RequestUser): string {
    if (!user.ownerId) throw new BadRequestException('No tenant context');
    return user.ownerId;
  }

  create(user: RequestUser, venueId: string, dto: CreateAddonDto) {
    return this.prisma.withTenant((tx) =>
      tx.addon.create({
        data: {
          ownerId: user.ownerId!,
          venueId,
          name: dto.name,
          type: dto.type,
          price: new Prisma.Decimal(dto.price),
          stock: dto.stock ?? null,
        },
      }),
    );
  }

  /** Public list for a venue (used at customer checkout). */
  list(venueId: string) {
    return this.prisma.withTenantBypass((tx) =>
      tx.addon.findMany({ where: { venueId, active: true } }),
    );
  }

  /** Owner/staff fetch of a single add-on within the current tenant. */
  async get(user: RequestUser, addonId: string) {
    const ownerId = this.ownerId(user);
    // Scope by ownerId explicitly (defense-in-depth): never rely on RLS alone,
    // which a superuser DB connection bypasses.
    const addon = await this.prisma.withTenant((tx) =>
      tx.addon.findFirst({ where: { id: addonId, ownerId } }),
    );
    if (!addon) throw new NotFoundException('Add-on not found');
    return addon;
  }

  /** Update mutable fields of an add-on (name/type/price/stock/active). */
  async update(user: RequestUser, addonId: string, dto: UpdateAddonDto) {
    const ownerId = this.ownerId(user);
    return this.prisma.withTenant(async (tx) => {
      // Scope by ownerId explicitly (defense-in-depth): never rely on RLS alone.
      const existing = await tx.addon.findFirst({
        where: { id: addonId, ownerId },
      });
      if (!existing) throw new NotFoundException('Add-on not found');

      const data: Prisma.AddonUpdateInput = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.type !== undefined) data.type = dto.type;
      if (dto.price !== undefined) data.price = new Prisma.Decimal(dto.price);
      if (dto.stock !== undefined) data.stock = dto.stock; // null => unlimited
      if (dto.active !== undefined) data.active = dto.active;

      return tx.addon.update({ where: { id: addonId }, data });
    });
  }

  /** Toggle (or explicitly set) the active flag — soft deactivation. */
  async setActive(user: RequestUser, addonId: string, active?: boolean) {
    const ownerId = this.ownerId(user);
    return this.prisma.withTenant(async (tx) => {
      // Scope by ownerId explicitly (defense-in-depth): never rely on RLS alone.
      const existing = await tx.addon.findFirst({
        where: { id: addonId, ownerId },
      });
      if (!existing) throw new NotFoundException('Add-on not found');
      const next = active ?? !existing.active;
      return tx.addon.update({
        where: { id: addonId },
        data: { active: next },
      });
    });
  }

  /**
   * Hard-delete an add-on when it is a leaf (no booking line items reference
   * it). If it is referenced by booking history, deactivate instead so the
   * historical line items remain intact, and report the outcome.
   */
  async remove(user: RequestUser, addonId: string) {
    const ownerId = this.ownerId(user);
    return this.prisma.withTenant(async (tx) => {
      // Scope by ownerId explicitly (defense-in-depth): never rely on RLS alone.
      const existing = await tx.addon.findFirst({
        where: { id: addonId, ownerId },
      });
      if (!existing) throw new NotFoundException('Add-on not found');

      const referenced = await tx.bookingAddon.count({ where: { addonId } });
      if (referenced > 0) {
        const addon = await tx.addon.update({
          where: { id: addonId },
          data: { active: false },
        });
        return { deleted: false, deactivated: true, addon };
      }

      try {
        await tx.addon.delete({ where: { id: addonId } });
      } catch (err) {
        // Guard against a concurrent FK reference slipping in between the
        // count and the delete — surface a 400 rather than a raw Prisma error.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2003'
        ) {
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
