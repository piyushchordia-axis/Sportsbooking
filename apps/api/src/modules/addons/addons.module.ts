import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Module } from '@nestjs/common';
import { AddonType, UserRole } from '@sportsbooking/shared';
import {
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
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

class CreateAddonDto {
  @IsString() name!: string;
  @IsEnum(AddonType) type!: AddonType;
  @IsNumber() price!: number;
  @IsOptional() @IsInt() @Min(0) stock?: number;
}

/**
 * Per-venue add-on catalogue: equipment rental, café items, coaching sessions
 * (PRD §4.6). Add-ons attach to a booking at checkout and appear as line items.
 */
@Injectable()
export class AddonsService {
  constructor(private readonly prisma: PrismaService) {}

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
}

@Controller()
export class AddonsController {
  constructor(private readonly addons: AddonsService) {}

  @Post('venues/:venueId/addons')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
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
}

@Module({
  controllers: [AddonsController],
  providers: [AddonsService],
})
export class AddonsModule {}
