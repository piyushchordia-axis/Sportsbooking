import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { RequestOtpDto, StaffLoginDto, VerifyOtpDto } from './dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Customer: request OTP to mobile (PRD §2.1). */
  @Public()
  @Post('otp/request')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.mobile);
  }

  /** Customer: verify OTP → tokens (find-or-create player). */
  @Public()
  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto);
  }

  /** Owner / staff: email + password login. */
  @Public()
  @Post('login')
  staffLogin(@Body() dto: StaffLoginDto) {
    return this.auth.staffLogin(dto);
  }
}
