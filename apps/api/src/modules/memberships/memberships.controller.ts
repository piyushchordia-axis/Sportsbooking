import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@sportsbooking/shared';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreatePackDto } from './dto';
import { MembershipsService } from './memberships.service';
import { WalletService } from './wallet.service';

@Controller()
@UseGuards(RolesGuard)
export class MembershipsController {
  constructor(
    private readonly memberships: MembershipsService,
    private readonly wallet: WalletService,
  ) {}

  // ---- Owner pack catalogue (PRD §4.4) ----
  @Post('packs')
  @Roles(UserRole.OWNER)
  createPack(@CurrentUser() user: RequestUser, @Body() dto: CreatePackDto) {
    return this.memberships.createPack(user, dto);
  }

  @Get('packs')
  @Roles(UserRole.OWNER, UserRole.STAFF)
  listPacks(@CurrentUser() user: RequestUser) {
    return this.memberships.listPacks(user);
  }

  // ---- Customer ----
  /** Buy a pack offered by a given owner. */
  @Post('owners/:ownerId/packs/:packId/purchase')
  @Roles(UserRole.CUSTOMER)
  purchase(
    @CurrentUser() user: RequestUser,
    @Param('ownerId') ownerId: string,
    @Param('packId') packId: string,
  ) {
    return this.memberships.purchase(ownerId, user.id, packId);
  }

  /** My wallet/ledger with a given owner (PRD §5.1). */
  @Get('owners/:ownerId/wallet')
  @Roles(UserRole.CUSTOMER)
  getWallet(@CurrentUser() user: RequestUser, @Param('ownerId') ownerId: string) {
    return this.wallet.summary(ownerId, user.id);
  }
}
