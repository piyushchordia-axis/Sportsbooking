import {
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { DayType, TimeBand, UnitLabel } from '@sportsbooking/shared';

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
