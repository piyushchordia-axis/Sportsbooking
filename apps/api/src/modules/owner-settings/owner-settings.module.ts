import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
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
import { StorageService } from '../storage/storage.service';

/**
 * Accepted raster logo image types → file extension. SVG is intentionally
 * excluded: stored SVGs can carry inline scripts and become a stored-XSS
 * vector when served from our origin.
 */
const LOGO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
/** Max logo size (also capped by the multer limit on the route). */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/**
 * Sniff the actual file bytes (magic numbers) and return the canonical MIME
 * type, ignoring the client-supplied mimetype. Returns null if the bytes do
 * not match a supported raster image signature.
 */
function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF: "GIF87a" or "GIF89a"
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return 'image/gif';
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

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
  constructor(
    private readonly db: DbService,
    private readonly storage: StorageService,
  ) {}

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

  /**
   * Upload a new logo to object storage and persist its public URL, replacing
   * any previous logo we stored. Validates type + size before storing.
   */
  async uploadLogo(
    ownerId: string,
    file?: Express.Multer.File,
  ): Promise<BrandingResponse> {
    if (!file) throw new BadRequestException('No file uploaded');
    if (file.size > MAX_LOGO_BYTES) {
      throw new BadRequestException('Logo must be 2 MB or smaller');
    }
    // Trust the actual bytes, not the client-supplied mimetype.
    const mime = sniffImageMime(file.buffer);
    const ext = mime ? LOGO_TYPES[mime] : undefined;
    if (!mime || !ext) {
      throw new BadRequestException('Logo must be a PNG, JPG, WebP or GIF image');
    }

    const previous = await this.getBranding(ownerId);
    const { url } = await this.storage.upload(
      `logos/${ownerId}/${randomUUID()}.${ext}`,
      file.buffer,
      mime,
    );
    const updated = await this.updateBranding(ownerId, { logoUrl: url });

    // Best-effort cleanup of the prior logo if it was one we stored.
    const oldKey = this.storage.keyFromUrl(previous.logoUrl);
    if (oldKey) void this.storage.delete(oldKey);

    return updated;
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

  /** Upload a logo image (multipart 'file'); stores it and returns the branding. */
  @Post('logo')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  uploadLogo(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const ownerId = user.ownerId;
    if (!ownerId) throw new BadRequestException('No tenant context');
    return this.ownerSettings.uploadLogo(ownerId, file);
  }
}

@Module({
  controllers: [OwnerSettingsController],
  providers: [OwnerSettingsService],
})
export class OwnerSettingsModule {}
