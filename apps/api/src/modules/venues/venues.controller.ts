import {
  Body,
  Controller,
  Get,
  Param,
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

  @Post(':id/units')
  @Roles(UserRole.OWNER)
  addUnit(
    @CurrentUser() user: RequestUser,
    @Param('id') venueId: string,
    @Body() dto: CreateUnitDto,
  ) {
    return this.venues.addUnit(user, venueId, dto);
  }

  @Put('units/:unitId/pricing')
  @Roles(UserRole.OWNER)
  setPricing(
    @CurrentUser() user: RequestUser,
    @Param('unitId') unitId: string,
    @Body() rules: PricingRuleDto[],
  ) {
    return this.venues.setPricing(user, unitId, rules);
  }

  @Post('block')
  block(@CurrentUser() user: RequestUser, @Body() dto: BlockSlotsDto) {
    return this.venues.block(user, dto);
  }
}
