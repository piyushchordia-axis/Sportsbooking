import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { AvailabilityService } from './availability.service';
import { BookingsService } from './bookings.service';
import { AvailabilityQueryDto, CreateBookingDto } from './dto';

@Controller()
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly availability: AvailabilityService,
  ) {}

  /** Live availability + resolved per-court price (PRD §5.2). Public discovery. */
  @Public()
  @Get('availability')
  calendar(@Query() q: AvailabilityQueryDto) {
    return this.availability.calendar(q.unitId, q.date);
  }

  /**
   * Create a booking — single / multi-slot (PRD §6.1). Optional auth: an
   * authenticated customer books as themselves; a guest/walk-in is captured
   * from the `customer` payload.
   */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('bookings')
  create(
    @Body() dto: CreateBookingDto,
    @CurrentUser() user: RequestUser | undefined,
  ) {
    return this.bookings.create(dto, user);
  }
}
