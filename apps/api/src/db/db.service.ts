import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { getTenant } from '../common/tenant/tenant-context';
import { db, pool, type DbTx } from './index';

/**
 * DbService enforces tenant isolation via Postgres
 * RLS. Because RLS reads `app.current_owner_id` from the DB session, and a
 * pooled connection is only guaranteed to be the same physical connection for
 * the duration of an interactive transaction, every tenant-scoped query runs
 * inside a transaction that first SETs the session vars (`withTenant`). Plain
 * `db.x` calls outside a tenant scope only succeed for global tables or under
 * bypass (super admin).
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  /** The raw drizzle client (use inside a tenant scope for global tables). */
  readonly db = db;

  async onModuleDestroy(): Promise<void> {
    await pool.end();
  }

  /**
   * Run `work` inside a transaction scoped to the current tenant. Sets the
   * RLS session vars from AsyncLocalStorage so policies filter rows.
   */
  async withTenant<T>(work: (tx: DbTx) => Promise<T>): Promise<T> {
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
  async withTenantBypass<T>(work: (tx: DbTx) => Promise<T>): Promise<T> {
    return this.runScoped(null, true, work);
  }

  /** Run `work` scoped to a specific tenant regardless of request context. */
  async withTenantId<T>(
    ownerId: string,
    work: (tx: DbTx) => Promise<T>,
  ): Promise<T> {
    return this.runScoped(ownerId, false, work);
  }

  private async runScoped<T>(
    ownerId: string | null,
    bypass: boolean,
    work: (tx: DbTx) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx) => {
      // set_config(..., true) => SET LOCAL, scoped to this transaction only.
      await tx.execute(
        sql`SELECT set_config('app.current_owner_id', ${ownerId ?? ''}, true)`,
      );
      await tx.execute(
        sql`SELECT set_config('app.bypass_rls', ${bypass ? 'on' : 'off'}, true)`,
      );
      return work(tx);
    });
  }
}
