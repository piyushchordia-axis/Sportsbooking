import {
  IsArray,
  IsEmail,
  IsEnum,
  IsHexColor,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
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

export class UpdateGameDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  iconUrl?: string;

  @IsOptional()
  @IsInt()
  @IsEnum({ 30: 30, 60: 60, 90: 90 })
  slotGranularityMin?: number;

  @IsOptional()
  @IsEnum(UnitLabel)
  unitLabel?: UnitLabel;

  @IsOptional()
  @IsInt()
  @Min(1)
  minPlayers?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxPlayers?: number;

  @IsOptional()
  @IsString()
  defaultOpenTime?: string;

  @IsOptional()
  @IsString()
  defaultCloseTime?: string;
}

/** White-label branding for an owner (PRD §4.10). All fields optional;
 *  omitted colour fields fall back to the schema defaults. */
export class OwnerBrandingDto {
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @IsOptional()
  @IsHexColor()
  secondaryColor?: string;

  @IsOptional()
  @IsHexColor()
  accentColor?: string;
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

  /**
   * The set of catalogue games this owner may use. When omitted, the owner
   * keeps the current behaviour (all games, i.e. an empty restriction set).
   * When provided, exactly these games are assigned.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedGameIds?: string[];

  @IsArray()
  @IsEnum(FeatureFlag, { each: true })
  featureFlags!: FeatureFlag[];

  /** Optional white-label branding applied to the new owner. */
  @IsOptional()
  @ValidateNested()
  @Type(() => OwnerBrandingDto)
  branding?: OwnerBrandingDto;

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
