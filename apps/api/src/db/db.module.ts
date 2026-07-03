import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';

/**
 * Global module exposing the tenant-aware Drizzle client so services can
 * inject DbService anywhere.
 */
@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
