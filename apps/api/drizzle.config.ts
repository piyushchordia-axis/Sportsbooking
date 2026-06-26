import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit config. Runtime DB access uses DATABASE_URL; schema changes are
 * applied with `pnpm db:push` (drizzle-kit push) which also applies the RLS
 * policies defined in-schema. `pnpm db:generate` emits SQL migrations to ./drizzle.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    // Schema changes (push/generate/studio) are DDL — use the ADMIN role.
    // Falls back to DATABASE_URL if DATABASE_ADMIN_URL is unset.
    url: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? '',
  },
  // Manage RLS policies declared in the schema (pgPolicy/enableRLS).
  entities: { roles: false },
  // Ignore the leftover Prisma migrations bookkeeping table.
  tablesFilter: ['!_prisma_migrations'],
  verbose: true,
  strict: true,
});
