import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PackExpiryMode, PackPricingMode } from '@sportsbooking/shared';

export class CreatePackDto {
  @IsString()
  name!: string;

  @IsInt()
  @Min(1)
  sessions!: number;

  @IsNumber()
  price!: number;

  @IsOptional()
  @IsInt()
  validityDays?: number;

  @IsEnum(PackExpiryMode)
  expiryMode!: PackExpiryMode;

  @IsEnum(PackPricingMode)
  pricingMode!: PackPricingMode;

  @IsOptional()
  @IsNumber()
  discountPct?: number;

  @IsOptional()
  @IsNumber()
  flatRate?: number;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  venueIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  unitIds?: string[];
}

export class PurchasePackDto {
  @IsUUID()
  packId!: string;
}
