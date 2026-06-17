import { Global, Module } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';

@Global()
@Module({
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
