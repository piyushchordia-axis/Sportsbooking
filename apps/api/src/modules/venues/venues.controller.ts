import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseArrayPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@sportsbooking/shared';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  BlockSlotsDto,
  CreateUnitDto,
  CreateVenueDto,
  PricingRuleDto,
  SettingsDto,
  UpdateUnitDto,
  UpdateVenueDto,
} from './dto';
import { VenuesService } from './venues.service';

@Controller('venues')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.STAFF)
export class VenuesController {
  constructor(private readonly venues: VenuesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.venues.listVenues(user);
  }

  @Post()
  @Roles(UserRole.OWNER)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateVenueDto) {
    return this.venues.createVenue(user, dto);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER)
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') venueId: string,
    @Body() dto: UpdateVenueDto,
  ) {
    return this.venues.updateVenue(user, venueId, dto);
  }

  @Delete(':id')
  @Roles(UserRole.OWNER)
  remove(@CurrentUser() user: RequestUser, @Param('id') venueId: string) {
    return this.venues.deleteVenue(user, venueId);
  }

  @Get(':id/settings')
  getSettings(
    @CurrentUser() user: RequestUser,
    @Param('id') venueId: string,
  ) {
    return this.venues.getSettings(user, venueId);
  }

  @Put(':id/settings')
  @Roles(UserRole.OWNER)
  updateSettings(
    @CurrentUser() user: RequestUser,
    @Param('id') venueId: string,
    @Body() dto: SettingsDto,
  ) {
    return this.venues.updateSettings(user, venueId, dto);
  }

  @Post(':id/units')
  @Roles(UserRole.OWNER)
  addUnit(
    @CurrentUser() user: RequestUser,
    @Param('id') venueId: string,
    @Body() dto: CreateUnitDto,
  ) {
    return this.venues.addUnit(user, venueId, dto);
  }

  @Patch('units/:unitId')
  @Roles(UserRole.OWNER)
  updateUnit(
    @CurrentUser() user: RequestUser,
    @Param('unitId') unitId: string,
    @Body() dto: UpdateUnitDto,
  ) {
    return this.venues.updateUnit(user, unitId, dto);
  }

  @Delete('units/:unitId')
  @Roles(UserRole.OWNER)
  removeUnit(
    @CurrentUser() user: RequestUser,
    @Param('unitId') unitId: string,
  ) {
    return this.venues.deleteUnit(user, unitId);
  }

  @Put('units/:unitId/pricing')
  @Roles(UserRole.OWNER)
  setPricing(
    @CurrentUser() user: RequestUser,
    @Param('unitId') unitId: string,
    @Body(new ParseArrayPipe({ items: PricingRuleDto }))
    rules: PricingRuleDto[],
  ) {
    return this.venues.setPricing(user, unitId, rules);
  }

  @Post('block')
  block(@CurrentUser() user: RequestUser, @Body() dto: BlockSlotsDto) {
    return this.venues.block(user, dto);
  }
}
