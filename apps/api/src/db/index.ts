// Load .env BEFORE the pool is created. This module is evaluated at import time
// (during Nest module resolution) — earlier than ConfigModule.forRoot() runs —
// so DATABASE_URL must be loaded here, otherwise pg falls back to OS defaults.
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import * as relations from './relations';

/**
 * Shared pg connection pool. Runtime DB access uses DATABASE_URL; the
 * application connects as a NON-superuser role so Postgres RLS is enforced
 * (see src/db/rls-setup.sql + the pgPolicy declarations in schema.ts).
 */
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Drizzle client bound to the pool with the full schema + relations so the
 * relational query API (db.query.*) is available alongside the core builder.
 */
export const db = drizzle(pool, { schema: { ...schema, ...relations } });

/**
 * The transaction client type Drizzle passes to `db.transaction(cb)`. Services
 * type their `tx` param with this so tenant-scoped work composes type-safely.
 */
export type DbTx = Parameters<typeof db.transaction>[0] extends (
  tx: infer T,
) => any
  ? T
  : never;
