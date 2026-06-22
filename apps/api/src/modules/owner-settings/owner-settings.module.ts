import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Put,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@sportsbooking/shared';
import { IsHexColor, IsOptional, IsString } from 'class-validator';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PrismaService } from '../../prisma/prisma.service';

class UpdateBrandingDto {
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsHexColor() primaryColor?: string;
  @IsOptional() @IsHexColor() secondaryColor?: string;
  @IsOptional() @IsHexColor() accentColor?: string;
}

interface BrandingResponse {
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
}

/**
 * White-label owner branding (PRD §4.10). Lets an owner read and edit the
 * branding fields on their own Owner row — logo + color palette — which the
 * web app uses to theme the customer-facing experience.
 */
@Injectable()
export class OwnerSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Return the authenticated owner's current branding. */
  getBranding(ownerId: string): Promise<BrandingResponse> {
    return this.prisma.withTenantId(ownerId, async (tx) => {
      const owner = await tx.owner.findUniqueOrThrow({
        where: { id: ownerId },
        select: {
          logoUrl: true,
          primaryColor: true,
          secondaryColor: true,
          accentColor: true,
        },
      });
      return owner;
    });
  }

  /** Update the authenticated owner's branding (owner only). */
  updateBranding(
    ownerId: string,
    dto: UpdateBrandingDto,
  ): Promise<BrandingResponse> {
    return this.prisma.withTenantId(ownerId, async (tx) => {
      const owner = await tx.owner.update({
        where: { id: ownerId },
        data: {
          logoUrl: dto.logoUrl,
          primaryColor: dto.primaryColor,
          secondaryColor: dto.secondaryColor,
          accentColor: dto.accentColor,
        },
        select: {
          logoUrl: true,
          primaryColor: true,
          secondaryColor: true,
          accentColor: true,
        },
      });
      return owner;
    });
  }
}

@Controller('me/branding')
export class OwnerSettingsController {
  constructor(private readonly ownerSettings: OwnerSettingsService) {}

  /** Read the authenticated owner's branding (PRD §4.10). */
  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  getBranding(@CurrentUser() user: RequestUser) {
    const ownerId = user.ownerId;
    if (!ownerId) throw new BadRequestException('No tenant context');
    return this.ownerSettings.getBranding(ownerId);
  }

  /** Update the authenticated owner's branding (owner only). */
  @Put()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  updateBranding(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateBrandingDto,
  ) {
    const ownerId = user.ownerId;
    if (!ownerId) throw new BadRequestException('No tenant context');
    return this.ownerSettings.updateBranding(ownerId, dto);
  }
}

@Module({
  controllers: [OwnerSettingsController],
  providers: [OwnerSettingsService],
})
export class OwnerSettingsModule {}
