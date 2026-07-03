import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FeatureFlag, UserRole } from '@sportsbooking/shared';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FeatureFlagGuard } from '../../common/guards/feature-flag.guard';
import { RequireFlag } from '../../common/decorators/require-flag.decorator';
import { CreatePackDto, PurchasePackDto, UpdatePackDto } from './dto';
import { MembershipsService } from './memberships.service';
import { WalletService } from './wallet.service';

@Controller()
@UseGuards(RolesGuard, FeatureFlagGuard)
export class MembershipsController {
  constructor(
    private readonly memberships: MembershipsService,
    private readonly wallet: WalletService,
  ) {}

  // ---- Owner pack catalogue (PRD §4.4) ----
  @Post('packs')
  @Roles(UserRole.OWNER)
  @RequireFlag(FeatureFlag.MEMBERSHIPS)
  createPack(@CurrentUser() user: RequestUser, @Body() dto: CreatePackDto) {
    return this.memberships.createPack(user, dto);
  }

  @Get('packs')
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @RequireFlag(FeatureFlag.MEMBERSHIPS)
  listPacks(@CurrentUser() user: RequestUser) {
    return this.memberships.listPacks(user);
  }

  /** Update a pack definition (catalogue fields). */
  @Patch('packs/:packId')
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @RequireFlag(FeatureFlag.MEMBERSHIPS)
  updatePack(
    @CurrentUser() user: RequestUser,
    @Param('packId') packId: string,
    @Body() dto: UpdatePackDto,
  ) {
    return this.memberships.updatePack(user, packId, dto);
  }

  /** Soft-deactivate a pack (hidden from purchase; balances preserved). */
  @Delete('packs/:packId')
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @RequireFlag(FeatureFlag.MEMBERSHIPS)
  deactivatePack(
    @CurrentUser() user: RequestUser,
    @Param('packId') packId: string,
  ) {
    return this.memberships.deactivatePack(user, packId);
  }

  // ---- Customer ----
  /** Active packs offered by an owner (for the purchase screen). */
  @Get('owners/:ownerId/packs')
  @Roles(UserRole.CUSTOMER)
  @RequireFlag(FeatureFlag.MEMBERSHIPS)
  listForOwner(@Param('ownerId') ownerId: string) {
    return this.memberships.listPacksForOwner(ownerId);
  }

  /** Packs the signed-in customer OWNS with this owner (positive, non-expired
   *  balance) — powers the "use pack" picker so only redeemable packs show. */
  @Get('owners/:ownerId/packs/owned')
  @Roles(UserRole.CUSTOMER)
  @RequireFlag(FeatureFlag.MEMBERSHIPS)
  listOwned(
    @CurrentUser() user: RequestUser,
    @Param('ownerId') ownerId: string,
  ) {
    return this.memberships.listOwnedPacks(ownerId, user.id);
  }

  /** Buy a pack offered by a given owner. */
  @Post('owners/:ownerId/packs/:packId/purchase')
  @Roles(UserRole.CUSTOMER)
  @RequireFlag(FeatureFlag.MEMBERSHIPS)
  purchase(
    @CurrentUser() user: RequestUser,
    @Param('ownerId') ownerId: string,
    @Param('packId') packId: string,
    @Body() dto: PurchasePackDto,
  ) {
    return this.memberships.purchase(ownerId, user.id, packId, {
      razorpayOrderId: dto.razorpayOrderId,
      razorpayPaymentId: dto.razorpayPaymentId,
      razorpaySignature: dto.razorpaySignature,
    });
  }

  /** My wallet/ledger with a given owner (PRD §5.1, SEC-5 per-owner lanes). */
  @Get('owners/:ownerId/wallet')
  @Roles(UserRole.CUSTOMER)
  getWallet(@CurrentUser() user: RequestUser, @Param('ownerId') ownerId: string) {
    return this.wallet.summary(user.id, ownerId);
  }

  /**
   * My aggregate wallet/ledger (SEC-5). With no `?ownerId` it sums every
   * owner's per-owner points/credit lanes into a combined view; with `?ownerId`
   * it scopes to that one owner (same as the path-param endpoint above).
   */
  @Get('wallet')
  @Roles(UserRole.CUSTOMER)
  getMyWallet(
    @CurrentUser() user: RequestUser,
    @Query('ownerId') ownerId?: string,
  ) {
    return this.wallet.summary(user.id, ownerId);
  }
}
