import { Global, Module } from '@nestjs/common';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
import { WalletService } from './wallet.service';

@Global()
@Module({
  controllers: [MembershipsController],
  providers: [MembershipsService, WalletService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
