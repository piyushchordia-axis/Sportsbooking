import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@sportsbooking/shared';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaymentService } from '../payments/payment.service';
import { AvailabilityService } from './availability.service';
import { BookingsService } from './bookings.service';
import {
  AvailabilityQueryDto,
  ConfirmPaymentDto,
  CreateBookingDto,
  ListBookingsQueryDto,
  RescheduleBookingDto,
  UpdateBookingCustomerDto,
  UpdateBookingStatusDto,
} from './dto';

@Controller()
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly availability: AvailabilityService,
    private readonly payments: PaymentService,
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

  /** Razorpay prepay confirmation — verify signature then settle. */
  @Public()
  @Post('bookings/:id/confirm-payment')
  confirmPayment(@Param('id') id: string, @Body() dto: ConfirmPaymentDto) {
    const ok = this.payments.verifyPaymentSignature(
      dto.razorpayOrderId,
      dto.razorpayPaymentId,
      dto.razorpaySignature,
    );
    if (!ok) throw new BadRequestException('Invalid payment signature');
    return this.bookings.markPaid(id);
  }

  /** Staff/owner marks a pay-at-venue booking settled on the ground (PRD §7). */
  @Post('bookings/:id/settle')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  settle(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.bookings.markPaid(id, user);
  }

  /** Cancel a booking per the owner's policy (PRD §5.4). */
  @Post('bookings/:id/cancel')
  @UseGuards(OptionalJwtAuthGuard)
  @Public()
  cancel(@Param('id') id: string) {
    return this.bookings.cancel(id);
  }

  /** Owner/staff bookings directory with filters (PRD §4.3). */
  @Get('bookings')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  list(@CurrentUser() user: RequestUser, @Query() q: ListBookingsQueryDto) {
    return this.bookings.listForOwner(user, q);
  }

  /** Owner/staff: mark a booking completed / no-show / cancelled (PRD §4.3). */
  @Post('bookings/:id/status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateBookingStatusDto,
  ) {
    return this.bookings.updateStatus(id, user, dto.status);
  }

  /** Owner/staff: reschedule a booking to new slot(s) (PRD §4.3). */
  @Post('bookings/:id/reschedule')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  reschedule(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: RescheduleBookingDto,
  ) {
    return this.bookings.reschedule(id, user, dto.slots);
  }

  /** Owner/staff: edit the customer name/mobile on a booking (PRD §4.3). */
  @Post('bookings/:id/customer')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  updateCustomer(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateBookingCustomerDto,
  ) {
    return this.bookings.updateCustomer(id, user, dto);
  }
}
