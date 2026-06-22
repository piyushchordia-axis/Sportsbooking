import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OfferType, UserRole } from '@sportsbooking/shared';
import { and, count, eq } from 'drizzle-orm';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DbService } from '../../db/db.service';
import { bookings, offers } from '../../db/schema';
import { dec, money } from '../../db/money';

class CreateOfferDto {
  @IsString() name!: string;
  @IsEnum(OfferType) type!: OfferType;
  @IsNumber() value!: number;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsBoolean() autoApply?: boolean;
  @IsOptional() @IsISO8601() validFrom?: string;
  @IsOptional() @IsISO8601() validTo?: string;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) venueIds?: string[];
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) gameIds?: string[];
  @IsOptional() @IsString() segment?: string;
}

class UpdateOfferDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(OfferType) type?: OfferType;
  @IsOptional() @IsNumber() value?: number;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsBoolean() autoApply?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsISO8601() validFrom?: string;
  @IsOptional() @IsISO8601() validTo?: string;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) venueIds?: string[];
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) gameIds?: string[];
  @IsOptional() @IsString() segment?: string;
}

/**
 * Offers & promotions (PRD §4.8): % or flat discounts via promo code or
 * auto-apply, with a validity window and venue/game/segment scoping.
 */
@Injectable()
export class OffersService {
  constructor(private readonly db: DbService) {}

  create(user: RequestUser, dto: CreateOfferDto) {
    return this.db.withTenant(async (tx) => {
      return (
        await tx
          .insert(offers)
          .values({
            id: randomUUID(),
            ownerId: user.ownerId!,
            name: dto.name,
            type: dto.type,
            value: money(dec(dto.value)),
            code: dto.code,
            autoApply: dto.autoApply ?? false,
            validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
            validTo: dto.validTo ? new Date(dto.validTo) : null,
            venueIds: dto.venueIds ?? [],
            gameIds: dto.gameIds ?? [],
            segment: dto.segment,
          })
          .returning()
      )[0];
    });
  }

  list(_user: RequestUser) {
    return this.db.withTenant((tx) => tx.query.offers.findMany());
  }

  /** Update any field of an offer, tenant-scoped. */
  async update(user: RequestUser, id: string, dto: UpdateOfferDto) {
    const ownerId = user.ownerId!;
    return this.db.withTenant(async (tx) => {
      const existing = await tx.query.offers.findFirst({
        where: and(eq(offers.id, id), eq(offers.ownerId, ownerId)),
      });
      if (!existing) throw new NotFoundException('Offer not found');

      const data: Partial<typeof offers.$inferInsert> = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.type !== undefined) data.type = dto.type;
      if (dto.value !== undefined) data.value = money(dec(dto.value));
      if (dto.code !== undefined) data.code = dto.code;
      if (dto.autoApply !== undefined) data.autoApply = dto.autoApply;
      if (dto.active !== undefined) data.active = dto.active;
      if (dto.validFrom !== undefined) {
        data.validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
      }
      if (dto.validTo !== undefined) {
        data.validTo = dto.validTo ? new Date(dto.validTo) : null;
      }
      if (dto.venueIds !== undefined) data.venueIds = dto.venueIds;
      if (dto.gameIds !== undefined) data.gameIds = dto.gameIds;
      if (dto.segment !== undefined) data.segment = dto.segment;

      return (
        await tx.update(offers).set(data).where(eq(offers.id, id)).returning()
      )[0];
    });
  }

  /**
   * Soft-deactivate an offer (preferred): keeps the row so past bookings that
   * reference it stay intact (PRD §4.8). Auto-apply/code matching elsewhere
   * should filter on `active`.
   */
  async deactivate(user: RequestUser, id: string) {
    const ownerId = user.ownerId!;
    return this.db.withTenant(async (tx) => {
      const existing = await tx.query.offers.findFirst({
        where: and(eq(offers.id, id), eq(offers.ownerId, ownerId)),
      });
      if (!existing) throw new NotFoundException('Offer not found');
      return (
        await tx
          .update(offers)
          .set({ active: false })
          .where(eq(offers.id, id))
          .returning()
      )[0];
    });
  }

  /**
   * Delete an offer. Soft-deactivates by default; only hard-deletes when no
   * booking references the offer. Returns 400 (never a raw FK error) if the
   * offer is referenced by past bookings.
   */
  async remove(user: RequestUser, id: string, hard = false) {
    const ownerId = user.ownerId!;
    return this.db.withTenant(async (tx) => {
      const existing = await tx.query.offers.findFirst({
        where: and(eq(offers.id, id), eq(offers.ownerId, ownerId)),
      });
      if (!existing) throw new NotFoundException('Offer not found');

      if (!hard) {
        return (
          await tx
            .update(offers)
            .set({ active: false })
            .where(eq(offers.id, id))
            .returning()
        )[0];
      }

      const refs = (
        await tx
          .select({ c: count() })
          .from(bookings)
          .where(eq(bookings.offerId, id))
      )[0].c;
      if (refs > 0) {
        throw new BadRequestException(
          'Offer is referenced by existing bookings; deactivate it instead of deleting',
        );
      }
      await tx.delete(offers).where(eq(offers.id, id));
      return { deleted: true };
    });
  }
}

@Controller('offers')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER)
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateOfferDto) {
    return this.offers.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.offers.list(user);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.STAFF)
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateOfferDto,
  ) {
    return this.offers.update(user, id, dto);
  }

  @Post(':id/deactivate')
  @Roles(UserRole.OWNER, UserRole.STAFF)
  deactivate(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.offers.deactivate(user, id);
  }

  @Delete(':id')
  @Roles(UserRole.OWNER, UserRole.STAFF)
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Query('hard') hardParam?: string,
  ) {
    // Soft-deactivate (preferred) so past bookings referencing the offer stay
    // intact. Use ?hard=true to purge an unreferenced offer for good.
    const hard = String(hardParam ?? '').toLowerCase() === 'true';
    return this.offers.remove(user, id, hard);
  }
}

@Module({
  controllers: [OffersController],
  providers: [OffersService],
})
export class OffersModule {}
