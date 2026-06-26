/**
 * `pnpm db:push` — apply the Drizzle schema + RLS policies in one command.
 *
 * The pgPolicy declarations in src/db/schema.ts reference the GUC helper
 * functions app_current_owner_id() / app_bypass_rls(). On a fresh database
 * those functions do not exist yet, so `drizzle-kit push` would fail. We first
 * run src/db/rls-setup.sql to create the functions, then spawn drizzle-kit push
 * so the schema, RLS enablement, and policies all apply together. Finally we
 * re-apply src/db/rls-policies.sql so the policy bodies match — one command sets
 * up a fresh DB: GUC functions -> schema + RLS -> policy bodies. The app connects
 * as the admin/owner role, which bypasses non-forced RLS; tenant isolation is
 * enforced in app code by ownerId/customerId, so no runtime role is created.
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

async function main(): Promise<void> {
  // DDL (CREATE FUNCTION / drizzle-kit push) needs the ADMIN role; the restricted
  // runtime DATABASE_URL role cannot create functions or alter the schema.
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_ADMIN_URL / DATABASE_URL is not set');
  }
  // Ensure the spawned drizzle-kit (which reads drizzle.config.ts) also targets admin.
  process.env.DATABASE_ADMIN_URL = databaseUrl;

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

  // drizzle-kit push creates each pgPolicy as a SHELL but drops the sql-template
  // USING/WITH CHECK body, so RLS-enabled tables would default-deny. Re-apply the
  // real policy predicates from rls-policies.sql. The app connects as the
  // admin/owner role, which bypasses (non-forced) RLS — tenant isolation rests on
  // the app-code ownerId/customerId filtering, so no dedicated runtime role is
  // created here.
  const rlsPoliciesSql = readFileSync(
    join(__dirname, '..', 'src', 'db', 'rls-policies.sql'),
    'utf8',
  );
  const adminClient = new Client({ connectionString: databaseUrl });
  await adminClient.connect();
  try {
    console.log('Applying RLS policy bodies (src/db/rls-policies.sql)...');
    await adminClient.query(rlsPoliciesSql);
  } finally {
    await adminClient.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
