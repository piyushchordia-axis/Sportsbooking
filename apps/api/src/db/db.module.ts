import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';

/**
 * Global module exposing the tenant-aware Drizzle client. Mirrors the Prisma
 * module so services can inject DbService anywhere during the migration.
 */
@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
