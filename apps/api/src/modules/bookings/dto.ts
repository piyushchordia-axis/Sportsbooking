import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { BookingStatus, PayMode, PaymentStatus } from '@sportsbooking/shared';

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

export class ListBookingsQueryDto {
  @IsOptional()
  @IsString()
  from?: string; // YYYY-MM-DD

  @IsOptional()
  @IsString()
  to?: string; // YYYY-MM-DD

  @IsOptional()
  @IsUUID()
  venueId?: string;

  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @IsOptional()
  @IsString()
  q?: string;
}

export class UpdateBookingStatusDto {
  // Owners/staff may only move a booking to completed, no-show, or cancelled —
  // reinstating to confirmed/pending is not part of this flow.
  @IsIn([BookingStatus.COMPLETED, BookingStatus.NO_SHOW, BookingStatus.CANCELLED])
  status!: BookingStatus;
}

export class RescheduleBookingDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartSlotDto)
  slots!: CartSlotDto[];
}

export class UpdateBookingCustomerDto {
  @IsString()
  name!: string;

  @IsString()
  mobile!: string;
}
