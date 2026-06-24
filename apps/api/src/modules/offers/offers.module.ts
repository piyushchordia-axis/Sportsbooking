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
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DbService } from '../../db/db.service';
import { bookings, offers } from '../../db/schema';
import { customerSegments } from '../../db/segments';
import { dec, money } from '../../db/money';

/** Customer-facing offers-inbox row (PRD §5.4). */
interface OfferInboxItem {
  id: string;
  name: string;
  type: OfferType;
  value: number;
  code: string | null;
  autoApply: boolean;
  validFrom: Date | null;
  validTo: Date | null;
}

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
  // Guardrails (omit/null = no limit).
  @IsOptional() @IsNumber() @Min(0) minOrderValue?: number;
  @IsOptional() @IsNumber() @Min(0) maxDiscount?: number;
  @IsOptional() @IsInt() @Min(1) usageLimit?: number;
  @IsOptional() @IsInt() @Min(1) perUserLimit?: number;
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
  // Guardrails (null clears the limit).
  @IsOptional() @IsNumber() @Min(0) minOrderValue?: number | null;
  @IsOptional() @IsNumber() @Min(0) maxDiscount?: number | null;
  @IsOptional() @IsInt() @Min(1) usageLimit?: number | null;
  @IsOptional() @IsInt() @Min(1) perUserLimit?: number | null;
}

/** Defense-in-depth value bounds (the admin form clamps too): percent must be
 *  1–100, a flat amount must be greater than zero. */
function assertOfferValue(type: OfferType, value: number): void {
  if (type === OfferType.PERCENT) {
    if (!(value >= 1 && value <= 100)) {
      throw new BadRequestException('Percent discount must be between 1 and 100.');
    }
  } else if (!(value > 0)) {
    throw new BadRequestException('Flat discount must be greater than zero.');
  }
}

/**
 * Offers & promotions (PRD §4.8): % or flat discounts via promo code or
 * auto-apply, with a validity window, venue/game/segment scoping, and usage
 * guardrails (min order, max discount cap, total + per-customer caps).
 */
@Injectable()
export class OffersService {
  constructor(private readonly db: DbService) {}

  create(user: RequestUser, dto: CreateOfferDto) {
    assertOfferValue(dto.type, dto.value);
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
            minOrderValue:
              dto.minOrderValue != null ? money(dec(dto.minOrderValue)) : null,
            maxDiscount:
              dto.maxDiscount != null ? money(dec(dto.maxDiscount)) : null,
            usageLimit: dto.usageLimit ?? null,
            perUserLimit: dto.perUserLimit ?? null,
          })
          .returning()
      )[0];
    });
  }

  list(_user: RequestUser) {
    return this.db.withTenant((tx) => tx.query.offers.findMany());
  }

  /**
   * Customer offers inbox (PRD §5.4): the offers currently valid on this
   * owner's storefront, scoped to the signed-in customer's marketing segment.
   * Customers carry no owner context, so this runs under withTenantBypass with
   * an explicit ownerId filter. Only active offers whose validity window
   * includes now are returned; a segment-targeted offer is included only when
   * the customer matches that segment (segments derived from ownerCustomers the
   * same way bookings.service does — lapsed = no visit in 60d, regulars = 5+).
   */
  async inbox(customerId: string, ownerId: string): Promise<OfferInboxItem[]> {
    return this.db.withTenantBypass(async (tx) => {
      const now = new Date();

      // Customer's segments — shared with offer scoping (bookings.service) so the
      // inbox advertises exactly what resolveOffer will honour.
      const segments = await customerSegments(tx, ownerId, customerId);

      const rows = await tx.query.offers.findMany({
        where: and(eq(offers.ownerId, ownerId), eq(offers.active, true)),
      });

      return rows
        .filter((o) => {
          if (o.validFrom && o.validFrom > now) return false;
          if (o.validTo && o.validTo < now) return false;
          // Non-segmented offers are always included; segmented offers only
          // when the customer is in that segment.
          if (o.segment && !segments.includes(o.segment)) return false;
          return true;
        })
        .map((o) => ({
          id: o.id,
          name: o.name,
          type: o.type as OfferType,
          value: dec(o.value).toNumber(),
          code: o.code,
          autoApply: o.autoApply,
          validFrom: o.validFrom,
          validTo: o.validTo,
        }));
    });
  }

  /** Update any field of an offer, tenant-scoped. */
  async update(user: RequestUser, id: string, dto: UpdateOfferDto) {
    const ownerId = user.ownerId!;
    return this.db.withTenant(async (tx) => {
      const existing = await tx.query.offers.findFirst({
        where: and(eq(offers.id, id), eq(offers.ownerId, ownerId)),
      });
      if (!existing) throw new NotFoundException('Offer not found');

      // Validate the discount value against the resolved type (new or existing).
      if (dto.value !== undefined) {
        assertOfferValue((dto.type ?? existing.type) as OfferType, dto.value);
      }

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
      if (dto.minOrderValue !== undefined) {
        data.minOrderValue =
          dto.minOrderValue != null ? money(dec(dto.minOrderValue)) : null;
      }
      if (dto.maxDiscount !== undefined) {
        data.maxDiscount =
          dto.maxDiscount != null ? money(dec(dto.maxDiscount)) : null;
      }
      if (dto.usageLimit !== undefined) data.usageLimit = dto.usageLimit;
      if (dto.perUserLimit !== undefined) data.perUserLimit = dto.perUserLimit;

      return (
        await tx
          .update(offers)
          .set(data)
          .where(and(eq(offers.id, id), eq(offers.ownerId, ownerId)))
          .returning()
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
          .where(and(eq(offers.id, id), eq(offers.ownerId, ownerId)))
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
            .where(and(eq(offers.id, id), eq(offers.ownerId, ownerId)))
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
      await tx
        .delete(offers)
        .where(and(eq(offers.id, id), eq(offers.ownerId, ownerId)));
      return { deleted: true };
    });
  }
}

@Controller('offers')
@UseGuards(RolesGuard)
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  /**
   * Customer offers inbox (PRD §5.4). Customer-only — the owner CRUD routes
   * below stay OWNER/STAFF-scoped via their own method-level @Roles.
   */
  @Get('inbox')
  @Roles(UserRole.CUSTOMER)
  inbox(@CurrentUser() user: RequestUser, @Query('ownerId') ownerId: string) {
    if (!ownerId) throw new BadRequestException('ownerId is required');
    return this.offers.inbox(user.id, ownerId);
  }

  @Post()
  @Roles(UserRole.OWNER)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateOfferDto) {
    return this.offers.create(user, dto);
  }

  @Get()
  @Roles(UserRole.OWNER)
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
