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
import { eq } from 'drizzle-orm';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DbService } from '../../db/db.service';
import { owners } from '../../db/schema';

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
  constructor(private readonly db: DbService) {}

  /** Return the authenticated owner's current branding. */
  getBranding(ownerId: string): Promise<BrandingResponse> {
    return this.db.withTenantId(ownerId, async (tx) => {
      const owner = await tx.query.owners.findFirst({
        where: eq(owners.id, ownerId),
        columns: {
          logoUrl: true,
          primaryColor: true,
          secondaryColor: true,
          accentColor: true,
        },
      });
      if (!owner) throw new BadRequestException('Owner not found');
      return owner;
    });
  }

  /** Update the authenticated owner's branding (owner only). */
  updateBranding(
    ownerId: string,
    dto: UpdateBrandingDto,
  ): Promise<BrandingResponse> {
    return this.db.withTenantId(ownerId, async (tx) => {
      const data: Partial<typeof owners.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (dto.logoUrl !== undefined) data.logoUrl = dto.logoUrl;
      if (dto.primaryColor !== undefined) data.primaryColor = dto.primaryColor;
      if (dto.secondaryColor !== undefined)
        data.secondaryColor = dto.secondaryColor;
      if (dto.accentColor !== undefined) data.accentColor = dto.accentColor;

      const [owner] = await tx
        .update(owners)
        .set(data)
        .where(eq(owners.id, ownerId))
        .returning({
          logoUrl: owners.logoUrl,
          primaryColor: owners.primaryColor,
          secondaryColor: owners.secondaryColor,
          accentColor: owners.accentColor,
        });
      if (!owner) throw new BadRequestException('Owner not found');
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
