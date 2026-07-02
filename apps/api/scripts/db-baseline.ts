/**
 * `pnpm db:baseline` — mark the current migration files as already-applied on a
 * database that already HAS the schema (built by `db:push` before we moved to
 * versioned migrations). Run this ONCE per existing DB before the first
 * `db:migrate`; otherwise the migrator would try to CREATE tables that already
 * exist and fail. A FRESH database does NOT need this.
 *
 * It replicates exactly what drizzle's migrator records: it creates the
 * drizzle.__drizzle_migrations table and inserts each migration's hash +
 * folderMillis (computed via drizzle-orm's own readMigrationFiles, so the hashes
 * match what `migrate` compares against). Idempotent — re-running skips rows
 * already present, and it NEVER runs the migration SQL, so no schema/data is
 * touched. Uses the ADMIN role (DATABASE_ADMIN_URL).
 */
import 'dotenv/config';
import { join } from 'node:path';
import { Client } from 'pg';
import { readMigrationFiles } from 'drizzle-orm/migrator';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_ADMIN_URL / DATABASE_URL is not set');
  }

  const migrations = readMigrationFiles({
    migrationsFolder: join(__dirname, '..', 'drizzle'),
  });
  if (migrations.length === 0) {
    console.log('No migration files found — nothing to baseline.');
    return;
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // Same schema/table the drizzle migrator uses (default names).
    await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
    await client.query(
      `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
         id SERIAL PRIMARY KEY,
         hash text NOT NULL,
         created_at bigint
       )`,
    );

    let stamped = 0;
    for (const m of migrations) {
      const { rowCount } = await client.query(
        'SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE hash = $1',
        [m.hash],
      );
      if (rowCount) {
        console.log(`already applied: ${m.hash.slice(0, 12)}…`);
        continue;
      }
      await client.query(
        'INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)',
        [m.hash, m.folderMillis],
      );
      stamped += 1;
      console.log(`baselined:      ${m.hash.slice(0, 12)}… (${m.folderMillis})`);
    }
    console.log(
      `Baseline complete: ${stamped} migration(s) marked applied, ${migrations.length - stamped} already present. Future db:migrate will apply only NEW migrations.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
