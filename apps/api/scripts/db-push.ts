/**
 * `pnpm db:push` — apply the Drizzle schema + RLS policies in one command.
 *
 * The pgPolicy declarations in src/db/schema.ts reference the GUC helper
 * functions app_current_owner_id() / app_bypass_rls(). On a fresh database
 * those functions do not exist yet, so `drizzle-kit push` would fail. We first
 * run src/db/rls-setup.sql to create the functions, then spawn drizzle-kit push
 * so the schema, RLS enablement, and policies all apply together. Next we
 * re-apply src/db/rls-policies.sql so the policy bodies + FORCE match, then
 * src/db/role-setup.sql to (idempotently) create the restricted runtime role
 * `sportsbooking_app` and its grants. One command sets up a fresh DB:
 * GUC functions -> schema + RLS -> policy bodies + FORCE -> runtime role + grants.
 * The running API connects as that non-owner role so RLS is actually enforced;
 * the app-code ownerId filtering is the first layer, RLS is the backstop.
 *
 * SKIP_APP_ROLE=true skips the role step (for a DB admin without CREATEROLE) —
 * then create sportsbooking_app manually as a superuser (see role-setup.sql).
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
  // real policy predicates + FORCE from rls-policies.sql, then create the
  // restricted runtime role + grants (idempotent) so the app (DATABASE_URL) works
  // under enforced RLS as a non-owner role.
  const rlsPoliciesSql = readFileSync(
    join(__dirname, '..', 'src', 'db', 'rls-policies.sql'),
    'utf8',
  );
  // SKIP_APP_ROLE=true skips creating sportsbooking_app + its grants — for a DB
  // admin that lacks CREATEROLE. Create the role manually as a superuser
  // (src/db/role-setup.sql) so the app still connects as a non-owner role.
  const skipAppRole = process.env.SKIP_APP_ROLE === 'true';
  const roleSetupSql = skipAppRole
    ? ''
    : readFileSync(join(__dirname, '..', 'src', 'db', 'role-setup.sql'), 'utf8');
  const adminClient = new Client({ connectionString: databaseUrl });
  await adminClient.connect();
  try {
    console.log('Applying RLS policy bodies + FORCE (src/db/rls-policies.sql)...');
    await adminClient.query(rlsPoliciesSql);
    if (skipAppRole) {
      console.log(
        'SKIP_APP_ROLE=true — skipping the runtime role; create sportsbooking_app manually as a superuser (src/db/role-setup.sql) and point DATABASE_URL at it.',
      );
    } else {
      console.log('Applying runtime role + grants (src/db/role-setup.sql)...');
      await adminClient.query(roleSetupSql);
    }
  } finally {
    await adminClient.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
