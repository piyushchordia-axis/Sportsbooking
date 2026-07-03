-- Runtime DB role for the app: a NON-superuser, NOBYPASSRLS role so Postgres
-- Row-Level Security is actually enforced (the app sets app.current_owner_id /
-- app.bypass_rls per request and the pgPolicy rules in schema.ts filter rows).
-- Run as an ADMIN/superuser AFTER the tables exist (db:push runs this last).
-- Idempotent + re-runnable. In production replace the password with a secret.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sportsbooking_app') THEN
    CREATE ROLE sportsbooking_app LOGIN PASSWORD 'sportsbooking_app'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO sportsbooking_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sportsbooking_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO sportsbooking_app;

-- Auto-grant the role on any tables/sequences created later (by the admin role).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sportsbooking_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO sportsbooking_app;

-- Append-only enforcement at the DB layer (defence-in-depth): the financial
-- ledger and the payments record must never be mutated or deleted by the app
-- role. The application only ever INSERTs/SELECTs these tables; revoking
-- UPDATE/DELETE makes immutability a database guarantee, not just a convention,
-- so a bug or an injection foothold cannot rewrite ledger/payment history.
-- (Admin/superuser retains full rights for migrations + test resets.)
REVOKE UPDATE, DELETE ON ledger_txns FROM sportsbooking_app;
REVOKE UPDATE, DELETE ON payments FROM sportsbooking_app;
