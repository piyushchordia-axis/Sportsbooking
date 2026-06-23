import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

/**
 * Canonical Indian mobile: "+91" then a 10-digit number starting 6–9
 * (single-region launch). Enforced identically on the client (normalizeMobile)
 * so the OTP key is consistent no matter which login path is used — a bare
 * 10-digit and a +91-prefixed number must never resolve to two accounts.
 */
const IN_MOBILE = /^\+91[6-9]\d{9}$/;
const IN_MOBILE_MSG = 'Enter a valid 10-digit Indian mobile number.';

export class RequestOtpDto {
  @Matches(IN_MOBILE, { message: IN_MOBILE_MSG })
  mobile!: string;
}

export class VerifyOtpDto {
  @Matches(IN_MOBILE, { message: IN_MOBILE_MSG })
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

export class RefreshTokenDto {
  // Optional: browser clients carry the refresh token in the httpOnly cookie;
  // the body is only used by non-browser clients (back-compat).
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class LogoutDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class PasswordResetRequestDto {
  @IsEmail()
  email!: string;
}

export class PasswordResetDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
