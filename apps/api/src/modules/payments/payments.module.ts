import { Global, Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentService } from './payment.service';
import { PaymentLedgerService } from './payment-ledger.service';

@Global()
@Module({
  controllers: [PaymentsController],
  providers: [PaymentService, PaymentLedgerService],
  exports: [PaymentService, PaymentLedgerService],
})
export class PaymentsModule {}
