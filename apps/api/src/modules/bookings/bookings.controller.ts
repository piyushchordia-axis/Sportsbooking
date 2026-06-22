import {
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

  /**
   * Razorpay prepay confirmation (SEC-12). Requires AUTHENTICATION — the global
   * JwtAuthGuard applies (no @Public) so a caller must present a token. The
   * consumer books after login-at-checkout and the owner offline-booking flow is
   * authenticated, so a token is always present. The service additionally
   * verifies the booking belongs to the caller (owning customer, or the
   * booking's tenant owner/staff) before settling, so a valid token for an
   * unrelated account cannot settle someone else's booking even under the dev
   * mock-signature path. Delegates to the service so the presented order id is
   * verified against the order stored on the booking *and* the signature is
   * checked — settling is idempotent.
   */
  @Post('bookings/:id/confirm-payment')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF, UserRole.CUSTOMER)
  confirmPayment(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: ConfirmPaymentDto,
  ) {
    return this.bookings.confirmPayment(
      id,
      {
        razorpayOrderId: dto.razorpayOrderId,
        razorpayPaymentId: dto.razorpayPaymentId,
        razorpaySignature: dto.razorpaySignature,
      },
      user,
    );
  }

  /** Staff/owner marks a pay-at-venue booking settled on the ground (PRD §7). */
  @Post('bookings/:id/settle')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  settle(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.bookings.markPaid(id, user);
  }

  /**
   * Cancel a booking per the owner's policy (PRD §5.4). Requires auth: the
   * service authorizes the caller (owning customer, or the booking's tenant
   * owner/staff) and enforces cancellability for customers.
   */
  @Post('bookings/:id/cancel')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF, UserRole.CUSTOMER)
  cancel(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.bookings.cancel(id, user);
  }

  /** Owner/staff bookings directory with filters (PRD §4.3). */
  @Get('bookings')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  list(@CurrentUser() user: RequestUser, @Query() q: ListBookingsQueryDto) {
    return this.bookings.listForOwner(user, q);
  }

  /**
   * Customer's own booking history (PRD BOOK-12): upcoming + past, newest
   * first. Declared before the `:id` route so the static path wins. Scoped to
   * the caller via customerId = user.id in the service.
   */
  @Get('bookings/mine')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CUSTOMER)
  mine(@CurrentUser() user: RequestUser) {
    return this.bookings.listForCustomer(user);
  }

  /**
   * Fetch a single booking. Allowed for the booking's owner/staff (staff within
   * their assigned venues) or the owning customer — enforced in the service.
   */
  @Get('bookings/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF, UserRole.CUSTOMER)
  getOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.bookings.getOne(id, user);
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
