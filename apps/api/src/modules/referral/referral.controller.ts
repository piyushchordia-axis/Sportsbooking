import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@sportsbooking/shared';
import { IsString } from 'class-validator';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferralService } from './referral.service';

class ApplyReferralDto {
  @IsString()
  code!: string;
}

@Controller('referral')
@UseGuards(RolesGuard)
@Roles(UserRole.CUSTOMER)
export class ReferralController {
  constructor(
    private readonly referral: ReferralService,
    private readonly prisma: PrismaService,
  ) {}

  /** My referral code for a given owner. */
  @Get('code/:ownerId')
  myCode(@CurrentUser() user: RequestUser, @Param('ownerId') ownerId: string) {
    return this.prisma.withTenantId(ownerId, (tx) =>
      this.referral.myCode(tx, ownerId, user.id).then((code) => ({ code })),
    );
  }

  /** Apply someone else's code (links me as referee). */
  @Post('apply/:ownerId')
  apply(
    @CurrentUser() user: RequestUser,
    @Param('ownerId') ownerId: string,
    @Body() dto: ApplyReferralDto,
  ) {
    return this.prisma
      .withTenantId(ownerId, (tx) =>
        this.referral.apply(tx, ownerId, dto.code, user.id),
      )
      .then(() => ({ applied: true }));
  }
}
