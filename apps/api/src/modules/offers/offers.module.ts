import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  UseGuards,
} from '@nestjs/common';
import { OfferType, UserRole } from '@sportsbooking/shared';
import { Prisma } from '@prisma/client';
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
import { PrismaService } from '../../prisma/prisma.service';

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

/**
 * Offers & promotions (PRD §4.8): % or flat discounts via promo code or
 * auto-apply, with a validity window and venue/game/segment scoping.
 */
@Injectable()
export class OffersService {
  constructor(private readonly prisma: PrismaService) {}

  create(user: RequestUser, dto: CreateOfferDto) {
    return this.prisma.withTenant((tx) =>
      tx.offer.create({
        data: {
          ownerId: user.ownerId!,
          name: dto.name,
          type: dto.type,
          value: new Prisma.Decimal(dto.value),
          code: dto.code,
          autoApply: dto.autoApply ?? false,
          validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
          validTo: dto.validTo ? new Date(dto.validTo) : null,
          venueIds: dto.venueIds ?? [],
          gameIds: dto.gameIds ?? [],
          segment: dto.segment,
        },
      }),
    );
  }

  list(_user: RequestUser) {
    return this.prisma.withTenant((tx) => tx.offer.findMany());
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
}

@Module({
  controllers: [OffersController],
  providers: [OffersService],
})
export class OffersModule {}
