import {
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { FeatureFlag, UnitLabel } from '@sportsbooking/shared';

export class CreateGameDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  iconUrl?: string;

  @IsInt()
  @IsEnum({ 30: 30, 60: 60, 90: 90 })
  slotGranularityMin!: number;

  @IsEnum(UnitLabel)
  unitLabel!: UnitLabel;

  @IsInt()
  @Min(1)
  minPlayers!: number;

  @IsInt()
  @Min(1)
  maxPlayers!: number;

  @IsOptional()
  @IsString()
  defaultOpenTime?: string;

  @IsOptional()
  @IsString()
  defaultCloseTime?: string;
}

export class CreateOwnerDto {
  @IsString()
  name!: string;

  @IsEmail()
  contactEmail!: string;

  @IsOptional()
  @IsString()
  contactMobile?: string;

  /** initial owner-admin login password */
  @IsString()
  @MinLength(8)
  adminPassword!: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  venueQuota!: number;

  @IsArray()
  @IsString({ each: true })
  allowedGameIds!: string[];

  @IsArray()
  @IsEnum(FeatureFlag, { each: true })
  featureFlags!: FeatureFlag[];

  @IsOptional()
  @IsNumber()
  setupFee?: number;

  @IsOptional()
  @IsNumber()
  amcAmount?: number;

  @IsOptional()
  @IsString()
  amcRenewalDate?: string;
}
