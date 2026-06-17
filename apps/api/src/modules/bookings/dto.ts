import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { PayMode } from '@sportsbooking/shared';

export class CartSlotDto {
  @IsUUID()
  unitId!: string;

  @IsISO8601()
  start!: string;

  @IsISO8601()
  end!: string;
}

export class CustomerCaptureDto {
  @IsString()
  name!: string;

  @IsString()
  mobile!: string;

  @IsBoolean()
  consent!: boolean;
}

export class CreateBookingDto {
  @IsUUID()
  venueId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartSlotDto)
  slots!: CartSlotDto[];

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  addonIds?: string[];

  @IsEnum(PayMode)
  payMode!: PayMode;

  @IsOptional()
  @IsUUID()
  packId?: string;

  @IsOptional()
  @IsString()
  offerCode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  pointsToRedeem?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerCaptureDto)
  customer?: CustomerCaptureDto;

  /** client-supplied idempotency key for safe retries (PRD §7) */
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class ConfirmPaymentDto {
  @IsString()
  razorpayOrderId!: string;

  @IsString()
  razorpayPaymentId!: string;

  @IsString()
  razorpaySignature!: string;
}

export class AvailabilityQueryDto {
  @IsUUID()
  unitId!: string;

  @IsString()
  date!: string; // YYYY-MM-DD
}
