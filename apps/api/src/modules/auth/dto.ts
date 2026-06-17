import {
  IsBoolean,
  IsEmail,
  IsMobilePhone,
  IsOptional,
  IsString,
  Length,
  MinLength,
} from 'class-validator';

export class RequestOtpDto {
  @IsMobilePhone('en-IN')
  mobile!: string;
}

export class VerifyOtpDto {
  @IsMobilePhone('en-IN')
  mobile!: string;

  @IsString()
  @Length(4, 6)
  code!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  consent?: boolean;
}

export class StaffLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
