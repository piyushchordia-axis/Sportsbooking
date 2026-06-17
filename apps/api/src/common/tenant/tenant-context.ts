import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped tenant context propagated via AsyncLocalStorage.
 * Populated by TenantMiddleware from the authenticated JWT, and consumed by
 * PrismaService to set the Postgres session vars that drive RLS (PRD §7).
 */
export interface TenantStore {
  ownerId: string | null;
  /** super_admin (and system jobs) bypass RLS */
  bypassRls: boolean;
  userId: string | null;
  role: string | null;
}

export const tenantStorage = new AsyncLocalStorage<TenantStore>();

export function getTenant(): TenantStore | undefined {
  return tenantStorage.getStore();
}

export function runWithTenant<T>(store: TenantStore, fn: () => T): T {
  return tenantStorage.run(store, fn);
}
