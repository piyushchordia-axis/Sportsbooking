import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit config. Runtime DB access uses DATABASE_URL (restricted role);
 * DDL uses DATABASE_ADMIN_URL. Schema workflow:
 *   pnpm db:generate  -> emit a reviewed SQL migration to ./drizzle (after a
 *                        schema.ts change)
 *   pnpm db:migrate   -> apply pending migrations + RLS + runtime role (DEPLOY path)
 *   pnpm db:baseline  -> ONE-TIME on an existing push-built DB before first migrate
 *   pnpm db:push      -> dev-only fast apply (drizzle-kit push --force)
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    // Schema changes (push/generate/studio) are DDL — use the ADMIN role, not
    // the restricted runtime role. Falls back to DATABASE_URL if admin is unset.
    url: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? '',
  },
  // Manage RLS policies declared in the schema (pgPolicy/enableRLS).
  entities: { roles: false },
  // Ignore the leftover Prisma migrations bookkeeping table.
  tablesFilter: ['!_prisma_migrations'],
  verbose: true,
  strict: true,
});
