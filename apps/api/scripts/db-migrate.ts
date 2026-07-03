/**
 * `pnpm db:migrate` — apply versioned SQL migrations (drizzle/) plus the RLS
 * functions, policy bodies + FORCE, and the runtime role. This is the DEPLOY
 * path; it replaces `db:push --force`, which diffed schema.ts against the live
 * DB and auto-approved — so a column/table rename could be applied as a silent
 * drop. Versioned migrations apply only the reviewed SQL in drizzle/*.sql.
 *
 * One command, mirroring the old push wrapper's ordering:
 *   GUC functions (rls-setup) -> pending migrations -> policy bodies + FORCE
 *   (rls-policies) -> runtime role + grants (role-setup).
 *
 * IMPORTANT — existing databases: a DB previously built with `db:push` has the
 * schema but no drizzle migrations table, so the first `migrate` would try to
 * CREATE existing tables. Run `pnpm db:baseline` ONCE against such a DB first to
 * stamp the current schema as already-applied. A FRESH DB needs no baseline —
 * migrate runs 0000 normally.
 *
 * Uses the ADMIN role (DATABASE_ADMIN_URL) — DDL, not the restricted runtime role.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const DB_DIR = join(__dirname, '..', 'src', 'db');
const MIGRATIONS_DIR = join(__dirname, '..', 'drizzle');

async function applySqlFile(url: string, file: string, label: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    console.log(label);
    await client.query(readFileSync(file, 'utf8'));
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_ADMIN_URL / DATABASE_URL is not set');
  }

  // 1) GUC helper functions — the RLS policies reference them, so they must
  //    exist before any policy DDL in a migration runs. Idempotent.
  await applySqlFile(
    databaseUrl,
    join(DB_DIR, 'rls-setup.sql'),
    'Applying RLS GUC functions (src/db/rls-setup.sql)...',
  );

  // 2) Apply pending versioned migrations (drizzle/*.sql), tracked in
  //    drizzle.__drizzle_migrations. No-op if everything is already applied.
  console.log('Applying versioned migrations (drizzle/)...');
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }

  // 3) drizzle emits pgPolicy as a SHELL without the USING/WITH CHECK body, and
  //    does not FORCE RLS — re-apply the real predicates + FORCE. Idempotent.
  await applySqlFile(
    databaseUrl,
    join(DB_DIR, 'rls-policies.sql'),
    'Applying RLS policy bodies + FORCE (src/db/rls-policies.sql)...',
  );

  // 4) Restricted runtime role + grants (unless SKIP_APP_ROLE for a DB admin
  //    without CREATEROLE — then create sportsbooking_app manually).
  if (process.env.SKIP_APP_ROLE === 'true') {
    console.log(
      'SKIP_APP_ROLE=true — skipping the runtime role; create sportsbooking_app manually as a superuser (src/db/role-setup.sql).',
    );
  } else {
    await applySqlFile(
      databaseUrl,
      join(DB_DIR, 'role-setup.sql'),
      'Applying runtime role + grants (src/db/role-setup.sql)...',
    );
  }

  console.log('db:migrate complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
