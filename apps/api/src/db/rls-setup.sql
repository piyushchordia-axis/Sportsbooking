-- GUC helper functions for Postgres RLS (multi-tenancy).
-- The pgPolicy/RLS blocks in schema.ts reference these two functions, so a fresh
-- database must define them BEFORE the policies are pushed (drizzle-kit push).
-- Definitions are copied verbatim from apps/api/prisma/sql/rls.sql.

-- Helper: current tenant from session var (NULL-safe). Returns text because
-- Prisma String ids map to `text` columns (not native uuid).
CREATE OR REPLACE FUNCTION app_current_owner_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_owner_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.bypass_rls', true), 'off') = 'on'
$$;
