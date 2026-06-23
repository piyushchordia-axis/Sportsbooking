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
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@sportsbooking/shared';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  BlockSlotsDto,
  BulkPricingDto,
  CreateUnitDto,
  CreateVenueDto,
  PricingRuleDto,
  ScheduleQueryDto,
  SettingsDto,
  UnblockSlotsDto,
  UpdateUnitDto,
  UpdateVenueDto,
  VenueListQueryDto,
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

  /**
   * Paginated/filterable ground list for the Grounds revamp list page.
   * Declared before the `:id` routes so the literal path wins.
   */
  @Get('list')
  listPaginated(
    @CurrentUser() user: RequestUser,
    @Query() query: VenueListQueryDto,
  ) {
    return this.venues.listVenuesPaginated(user, query);
  }

  @Post()
  @Roles(UserRole.OWNER)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateVenueDto) {
    return this.venues.createVenue(user, dto);
  }

  /** Free blocked slots in a range for the owner's unit (Grounds revamp). */
  @Post('unblock')
  unblock(@CurrentUser() user: RequestUser, @Body() dto: UnblockSlotsDto) {
    return this.venues.unblock(user, dto);
  }

  /** Single shaped venue for the Grounds detail page. */
  @Get(':id')
  getOne(@CurrentUser() user: RequestUser, @Param('id') venueId: string) {
    return this.venues.getVenue(user, venueId);
  }

  /** Best-effort headline metrics for a ground's detail page. */
  @Get(':id/overview')
  overview(@CurrentUser() user: RequestUser, @Param('id') venueId: string) {
    return this.venues.getOverview(user, venueId);
  }

  /** Per-court hourly slot grid for a ground on a given day. */
  @Get(':id/schedule')
  schedule(
    @CurrentUser() user: RequestUser,
    @Param('id') venueId: string,
    @Query() query: ScheduleQueryDto,
  ) {
    return this.venues.getSchedule(user, venueId, query);
  }

  /** Apply one pricing grid to multiple courts of a ground (Grounds revamp). */
  @Post(':id/bulk-pricing')
  @Roles(UserRole.OWNER)
  bulkPricing(
    @CurrentUser() user: RequestUser,
    @Param('id') venueId: string,
    @Body() dto: BulkPricingDto,
  ) {
    return this.venues.bulkPricing(user, venueId, dto);
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

  /** Upload a venue photo (multipart 'file') — stored in S3/R2 (or local dev
   *  disk) and appended to the venue's photos. Returns the updated venue. */
  @Post(':id/photos')
  @Roles(UserRole.OWNER)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  addPhoto(
    @CurrentUser() user: RequestUser,
    @Param('id') venueId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.venues.addPhoto(user, venueId, file);
  }

  /** Remove a venue photo by its URL. */
  @Delete(':id/photos')
  @Roles(UserRole.OWNER)
  removePhoto(
    @CurrentUser() user: RequestUser,
    @Param('id') venueId: string,
    @Query('url') url: string,
  ) {
    return this.venues.removePhoto(user, venueId, url);
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

  /** Read a court's stored pricing grid (to preload the editor). */
  @Get('units/:unitId/pricing')
  @Roles(UserRole.OWNER, UserRole.STAFF)
  getPricing(
    @CurrentUser() user: RequestUser,
    @Param('unitId') unitId: string,
  ) {
    return this.venues.getPricing(user, unitId);
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
