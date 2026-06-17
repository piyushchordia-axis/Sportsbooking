import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { LoginResponse, UserRole } from '@sportsbooking/shared';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from './jwt.strategy';
import { OtpService } from './otp.service';
import { StaffLoginDto, VerifyOtpDto } from './dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly otp: OtpService,
  ) {}

  async requestOtp(mobile: string): Promise<{ sent: true }> {
    await this.otp.issue(mobile);
    return { sent: true };
  }

  /** Customer OTP verification — find-or-create the global customer user. */
  async verifyOtp(dto: VerifyOtpDto): Promise<LoginResponse> {
    if (!this.otp.verify(dto.mobile, dto.code)) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    // Customers are global; super admin bypasses RLS to upsert by mobile.
    const user = await this.prisma.withTenantBypass(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { mobile: dto.mobile },
      });
      if (existing) return existing;
      return tx.user.create({
        data: {
          role: UserRole.CUSTOMER,
          name: dto.name ?? 'Player',
          mobile: dto.mobile,
        },
      });
    });

    return this.issueTokens({
      sub: user.id,
      role: user.role as UserRole,
      ownerId: user.ownerId,
      assignedVenueIds: user.assignedVenueIds,
    }, user.name);
  }

  /** Owner/staff email + password login (PRD §2.1). */
  async staffLogin(dto: StaffLoginDto): Promise<LoginResponse> {
    const user = await this.prisma.withTenantBypass((tx) =>
      tx.user.findUnique({ where: { email: dto.email } }),
    );
    if (!user || !user.passwordHash || !user.active) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens({
      sub: user.id,
      role: user.role as UserRole,
      ownerId: user.ownerId,
      assignedVenueIds: user.assignedVenueIds,
    }, user.name);
  }

  private issueTokens(payload: JwtPayload, name: string): LoginResponse {
    const accessToken = this.jwt.sign(payload, {
      expiresIn: Number(this.config.get('JWT_ACCESS_TTL', 900)),
    });
    const refreshToken = this.jwt.sign(
      { sub: payload.sub },
      { expiresIn: Number(this.config.get('JWT_REFRESH_TTL', 2592000)) },
    );
    return {
      accessToken,
      refreshToken,
      user: {
        id: payload.sub,
        role: payload.role,
        ownerId: payload.ownerId,
        name,
        assignedVenueIds: payload.assignedVenueIds,
      },
    };
  }
}
