import {
  IsArray,
  IsBoolean,
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

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdatePackDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sessions?: number;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsInt()
  validityDays?: number;

  @IsOptional()
  @IsEnum(PackExpiryMode)
  expiryMode?: PackExpiryMode;

  @IsOptional()
  @IsEnum(PackPricingMode)
  pricingMode?: PackPricingMode;

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

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class PurchasePackDto {
  // The pack id is taken from the route path param; keep it optional here so an
  // empty purchase body (dev flow / no real handshake yet) still validates
  // under the global whitelist+forbidNonWhitelisted ValidationPipe.
  @IsOptional()
  @IsUUID()
  packId?: string;

  /** Razorpay order id returned by createOrder (mock in dev). */
  @IsOptional()
  @IsString()
  razorpayOrderId?: string;

  /** Razorpay payment id from the client handshake. */
  @IsOptional()
  @IsString()
  razorpayPaymentId?: string;

  /** Razorpay payment signature to verify before crediting. */
  @IsOptional()
  @IsString()
  razorpaySignature?: string;
}
