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
  Max,
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

/** Max occurrences in a single weekly series (PRD §5.2 v1 cap). */
export const MAX_RECURRENCE_COUNT = 12;

export class RecurrenceDto {
  // v1 supports weekly only; modelled as an enum-of-one so adding daily/monthly
  // later is a non-breaking extension.
  @IsIn(['weekly'])
  frequency!: 'weekly';

  /** total occurrences INCLUDING the first; 2..MAX_RECURRENCE_COUNT */
  @IsInt()
  @Min(2)
  @Max(MAX_RECURRENCE_COUNT)
  count!: number;
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

  /**
   * Optional weekly recurrence (PRD §5.2 v1). Absent → a single booking
   * (behaviour unchanged). Present → a weekly series; only AT_VENUE pay mode is
   * supported (PREPAY + recurrence is rejected by the service).
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => RecurrenceDto)
  recurrence?: RecurrenceDto;
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

// ---------------------------------------------------------------------------
// Pure slot-validation helpers (Security M1)
//
// Booking creation accepts arbitrary client start/end ISO timestamps. The DB
// only enforces UNIQUE(unitId, startsAt), so 10:00-11:00 and 10:30-11:30 on the
// same court both succeed (different start instants, overlapping intervals). The
// helpers below are the PURE, DB-free parts of the server-side defence: grid
// alignment against the unit's operating window + granularity, and intra-request
// overlap detection. They are unit-tested in booking-validation.spec.ts.
// ---------------------------------------------------------------------------

/** Parse a "HH:MM" wall-clock string to minutes-from-midnight, or null. */
export function parseClockToMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

/** A requested slot reduced to the wall-clock minutes the grid is checked in. */
export interface GridSlot {
  /** minutes-from-midnight of the slot start (local wall clock) */
  startMin: number;
  /** minutes-from-midnight of the slot end (local wall clock) */
  endMin: number;
}

export interface GridWindow {
  /** minutes-from-midnight the unit opens (grid anchor) */
  openMin: number;
  /** minutes-from-midnight the unit closes */
  closeMin: number;
  /** slot granularity in minutes (one step of the grid) */
  granularityMin: number;
}

/**
 * Validate one slot against the unit's operating grid (mirrors how
 * availability.service slices [open, close] into granularity steps). A slot is
 * valid iff:
 *  (a) start lies on the grid: (start - open) is a non-negative multiple of the
 *      granularity,
 *  (b) its length is exactly one granularity step,
 *  (c) start >= open and end <= close (within operating hours).
 * Returns null when valid, or a human-readable reason string otherwise.
 */
export function validateSlotOnGrid(
  slot: GridSlot,
  window: GridWindow,
): string | null {
  const { startMin, endMin } = slot;
  const { openMin, closeMin, granularityMin } = window;
  if (granularityMin <= 0) return 'Invalid slot granularity for this court.';
  if (endMin <= startMin) return 'Slot end must be after its start.';
  if (startMin < openMin || endMin > closeMin) {
    return 'Slot falls outside the operating hours for this court.';
  }
  if ((startMin - openMin) % granularityMin !== 0) {
    return 'Slot start is not aligned to this court’s booking grid.';
  }
  if (endMin - startMin !== granularityMin) {
    return 'Slot length must equal one booking step for this court.';
  }
  return null;
}

/** A requested slot reduced to a unit + half-open [start, end) instant range. */
export interface IntervalSlot {
  unitId: string;
  /** epoch ms of the slot start */
  startMs: number;
  /** epoch ms of the slot end */
  endMs: number;
}

/**
 * Detect an overlap WITHIN a single request: two slots on the SAME unit whose
 * half-open [start, end) intervals intersect (startA < endB && endA > startB).
 * Returns the index of the first slot that overlaps an earlier one, or null when
 * the request is internally consistent. O(n^2) is fine for the tiny slot counts
 * a cart carries.
 */
export function findIntraRequestOverlap(slots: IntervalSlot[]): number | null {
  for (let i = 1; i < slots.length; i++) {
    const a = slots[i];
    for (let j = 0; j < i; j++) {
      const b = slots[j];
      if (a.unitId !== b.unitId) continue;
      if (a.startMs < b.endMs && a.endMs > b.startMs) return i;
    }
  }
  return null;
}
