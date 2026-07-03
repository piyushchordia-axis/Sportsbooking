import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@sportsbooking/shared';
import type { Request, Response } from 'express';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  LogoutDto,
  PasswordResetDto,
  PasswordResetRequestDto,
  RefreshTokenDto,
  RequestOtpDto,
  StaffLoginDto,
  VerifyOtpDto,
} from './dto';

/** httpOnly cookie that carries the refresh token (M4). Scoped to the auth path
 *  so it is only ever sent to /api/auth/refresh and /api/auth/logout. */
const REFRESH_COOKIE = 'rt';
const REFRESH_COOKIE_PATH = '/api/auth';

// Per-route limits to blunt brute-force, layered on the generous global
// throttler. Windows are in ms. These are deliberately NAT-friendly (many
// legitimate players can share one venue-wifi IP) while still capping an
// attacker to dozens of guesses/min — the real brute-force defences are bcrypt
// + the per-mobile OTP lockout (H2), not these coarse IP limits.
const LOGIN_THROTTLE = { default: { limit: 40, ttl: 60_000 } };
const OTP_VERIFY_THROTTLE = { default: { limit: 40, ttl: 60_000 } };
const OTP_REQUEST_THROTTLE = { default: { limit: 20, ttl: 60_000 } };
const RESET_THROTTLE = { default: { limit: 15, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  private readonly refreshTtlMs: number;
  private readonly cookieSecure: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService,
  ) {
    this.refreshTtlMs =
      Number(config.get('JWT_REFRESH_TTL', 2592000)) * 1000;
    this.cookieSecure = config.get('NODE_ENV') === 'production';
  }

  /** Persist the refresh token in an httpOnly cookie (never JS-readable). */
  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: this.refreshTtlMs,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  }

  /** Prefer the httpOnly cookie; fall back to the body for non-browser clients. */
  private readRefreshToken(req: Request, bodyToken?: string): string {
    return (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? bodyToken ?? '';
  }

  /** Customer: request OTP to mobile (PRD §2.1). */
  @Public()
  @Throttle(OTP_REQUEST_THROTTLE)
  @Post('otp/request')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.mobile);
  }

  /** Customer: verify OTP → tokens (find-or-create player). */
  @Public()
  @Throttle(OTP_VERIFY_THROTTLE)
  @Post('otp/verify')
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyOtp(dto);
    this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  /** Owner / staff: email + password login. */
  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('login')
  async staffLogin(
    @Body() dto: StaffLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.staffLogin(dto);
    this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  /** Rotate a valid (non-revoked) refresh token into fresh tokens. The token is
   *  taken from the httpOnly cookie (body is a fallback for non-browser clients). */
  @Public()
  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.refresh(
      this.readRefreshToken(req, dto.refreshToken),
    );
    this.setRefreshCookie(res, tokens.refreshToken);
    return tokens;
  }

  /** Revoke a refresh token (logout). Public: it self-authenticates by verifying
   *  the presented refresh token, so an expired access token can still log out. */
  @Public()
  @HttpCode(200)
  @Post('logout')
  async logout(
    @Body() dto: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.logout(this.readRefreshToken(req, dto.refreshToken));
    this.clearRefreshCookie(res);
    return result;
  }

  /** Change own password (owner/staff/admin only; customers are OTP-only). */
  @Roles(UserRole.OWNER, UserRole.STAFF, UserRole.SUPER_ADMIN)
  @UseGuards(RolesGuard)
  @HttpCode(200)
  @Post('password')
  changePassword(
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  /** Forgot-password: request a single-use reset token (always { sent: true }). */
  @Public()
  @Throttle(RESET_THROTTLE)
  @HttpCode(200)
  @Post('password/reset-request')
  requestPasswordReset(@Body() dto: PasswordResetRequestDto) {
    return this.auth.requestPasswordReset(dto.email);
  }

  /** Forgot-password: consume a reset token and set a new password. */
  @Public()
  @Throttle(RESET_THROTTLE)
  @HttpCode(200)
  @Post('password/reset')
  resetPassword(@Body() dto: PasswordResetDto) {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }
}
