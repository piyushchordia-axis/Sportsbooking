/**
 * `pnpm db:push` — apply the Drizzle schema + RLS policies in one command.
 *
 * The pgPolicy declarations in src/db/schema.ts reference the GUC helper
 * functions app_current_owner_id() / app_bypass_rls(). On a fresh database
 * those functions do not exist yet, so `drizzle-kit push` would fail. We first
 * run src/db/rls-setup.sql to create the functions, then spawn drizzle-kit push
 * so the schema, RLS enablement, and policies all apply together.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const rlsSetupSql = readFileSync(
    join(__dirname, '..', 'src', 'db', 'rls-setup.sql'),
    'utf8',
  );

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    console.log('Applying RLS GUC functions (src/db/rls-setup.sql)...');
    await client.query(rlsSetupSql);
  } finally {
    await client.end();
  }

  // --force auto-approves so `db:push` applies changes without an interactive
  // prompt (works in CI / non-TTY). Pass --strict via `pnpm db:push -- --strict`
  // when you want a manual confirmation step instead.
  console.log('Running drizzle-kit push...');
  const extra = process.argv.slice(2);
  const args = ['exec', 'drizzle-kit', 'push', ...(extra.length ? extra : ['--force'])];
  const result = spawnSync('pnpm', args, {
    stdio: 'inherit',
    cwd: join(__dirname, '..'),
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
