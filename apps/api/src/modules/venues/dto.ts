import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  DayType,
  OpenMatchRepaymentMode,
  TimeBand,
  UnitLabel,
} from '@sportsbooking/shared';

export class CreateVenueDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsNumber()
  geoLat?: number;

  @IsOptional()
  @IsNumber()
  geoLng?: number;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsArray()
  @IsString({ each: true })
  gameIds!: string[];

  @IsOptional()
  @IsString()
  openTime?: string;

  @IsOptional()
  @IsString()
  closeTime?: string;
}

export class CreateUnitDto {
  @IsString()
  name!: string;

  @IsEnum(UnitLabel)
  label!: UnitLabel;

  @IsUUID()
  gameId!: string;

  @IsInt()
  @Min(1)
  capacity!: number;
}

/** Partial update of a venue's editable/branding-relevant fields (PRD §4.1). */
export class UpdateVenueDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  geoLat?: number;

  @IsOptional()
  @IsNumber()
  geoLng?: number;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  openTime?: string;

  @IsOptional()
  @IsString()
  closeTime?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photos?: string[];
}

/** Partial update of a bookable unit (PRD §4.1). */
export class UpdateUnitDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(UnitLabel)
  label?: UnitLabel;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}

export class PricingRuleDto {
  @IsOptional()
  @IsEnum(DayType)
  dayType?: DayType;

  @IsOptional()
  @IsEnum(TimeBand)
  timeBand?: TimeBand;

  @IsOptional()
  @IsISO8601()
  dateOverride?: string;

  @IsOptional()
  @IsInt()
  minDuration?: number;

  @IsNumber()
  price!: number;
}

export class BlockSlotsDto {
  @IsUUID()
  unitId!: string;

  @IsISO8601()
  start!: string;

  @IsISO8601()
  end!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

/** Free BLOCKED slots in a range for an owner's unit (Grounds revamp §4.3). */
export class UnblockSlotsDto {
  @IsUUID()
  unitId!: string;

  @IsISO8601()
  start!: string;

  @IsISO8601()
  end!: string;
}

/** Paginated/filterable venue list query for the Grounds revamp list page. */
export class VenueListQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  gameId?: string;

  @IsOptional()
  @IsIn(['active', 'inactive', 'draft', 'needs_setup'])
  status?: 'active' | 'inactive' | 'draft' | 'needs_setup';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

/** Day-schedule query for a ground's per-court hourly slot grid. */
export class ScheduleQueryDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;
}

/** Apply the same pricing grid to multiple courts the owner owns. */
export class BulkPricingDto {
  @IsArray()
  @IsUUID(undefined, { each: true })
  unitIds!: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PricingRuleDto)
  rules!: PricingRuleDto[];
}

/** Partial update of a venue's policy/loyalty settings (PRD §4.1). */
export class SettingsDto {
  @IsOptional()
  @IsIn(['flexible', 'moderate', 'strict'])
  cancellationTemplate?: 'flexible' | 'moderate' | 'strict';

  @IsOptional()
  @IsNumber()
  @Min(0)
  noShowFee?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  loyaltyEarnRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  loyaltyRedeemValue?: number;

  @IsOptional()
  @IsEnum(OpenMatchRepaymentMode)
  openMatchRepaymentMode?: OpenMatchRepaymentMode;
}
