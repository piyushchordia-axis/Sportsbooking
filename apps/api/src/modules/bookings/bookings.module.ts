import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { AvailabilityService } from './availability.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [PricingModule],
  controllers: [BookingsController],
  providers: [BookingsService, AvailabilityService],
})
export class BookingsModule {}
