import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { getTenant } from '../common/tenant/tenant-context';

/**
 * Prisma client that enforces tenant isolation via Postgres RLS.
 *
 * Because RLS reads `app.current_owner_id` from the DB session, and a pooled
 * connection is only guaranteed to be the same physical connection for the
 * duration of an interactive transaction, every tenant-scoped query runs inside
 * a transaction that first SETs the session vars (`withTenant`). Plain
 * `this.prisma.x.findMany()` calls outside a tenant scope only succeed for
 * global tables or under bypass (super admin).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Run `work` inside a transaction scoped to the current tenant. Sets the
   * RLS session vars from AsyncLocalStorage so policies filter rows.
   */
  async withTenant<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const tenant = getTenant();
    const ownerId = tenant?.ownerId ?? null;
    const bypass = tenant?.bypassRls ?? false;

    return this.runScoped(ownerId, bypass, work);
  }

  /**
   * Run `work` with RLS bypassed (super admin / system tasks: customer upsert,
   * cross-tenant discovery, migrations). Use sparingly and never with
   * unvalidated tenant input.
   */
  async withTenantBypass<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.runScoped(null, true, work);
  }

  /** Run `work` scoped to a specific tenant regardless of request context. */
  async withTenantId<T>(
    ownerId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.runScoped(ownerId, false, work);
  }

  private async runScoped<T>(
    ownerId: string | null,
    bypass: boolean,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      // set_config(..., true) => SET LOCAL, scoped to this transaction only.
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.current_owner_id', $1, true)`,
        ownerId ?? '',
      );
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.bypass_rls', $1, true)`,
        bypass ? 'on' : 'off',
      );
      return work(tx);
    });
  }
}
