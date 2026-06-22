/**
 * `pnpm db:set-app-password` — rotate the restricted runtime role's password to
 * match DATABASE_URL.
 *
 * role-setup.sql (run by db:push) bootstraps `sportsbooking_app` with a
 * placeholder password equal to its name. In production we generate a strong
 * secret, put it in DATABASE_URL, and run this right after db:push to ALTER the
 * role to that secret — so the live runtime password is never the weak default.
 * Connects as the ADMIN role (DATABASE_ADMIN_URL). Idempotent + re-runnable.
 *
 * (ALTER ROLE ... PASSWORD does not accept bind parameters — it's a utility
 * statement — so the literal is inlined with single quotes escaped. The value
 * comes from our own env, not user input.)
 */
import 'dotenv/config';
import { Client } from 'pg';

function parseUserPassword(url: string): { user: string; password: string } {
  const m = /^[^:]+:\/\/([^:@/]+):([^@]+)@/.exec(url);
  if (!m) {
    throw new Error('DATABASE_URL must be of the form scheme://user:password@...');
  }
  return { user: decodeURIComponent(m[1]), password: decodeURIComponent(m[2]) };
}

async function main(): Promise<void> {
  const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  const appUrl = process.env.DATABASE_URL;
  if (!adminUrl || !appUrl) {
    throw new Error('DATABASE_ADMIN_URL and DATABASE_URL must both be set');
  }
  const { user, password } = parseUserPassword(appUrl);

  const ident = `"${user.replace(/"/g, '""')}"`;
  const literal = `'${password.replace(/'/g, "''")}'`;

  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`ALTER ROLE ${ident} WITH PASSWORD ${literal}`);
    console.log(`Rotated password for runtime role ${user}.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
