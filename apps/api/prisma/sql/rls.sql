-- Row-Level Security policies (PRD §7 multi-tenancy).
-- Applied AFTER `prisma migrate deploy` creates the tables.
-- Strategy: every tenant-scoped table has an owner_id column. Each request sets
--   SET LOCAL app.current_owner_id = '<uuid>';
--   SET LOCAL app.bypass_rls = 'on';   -- super admin / migrations only
-- and these policies filter rows by that session variable.
--
-- The application connects as a NON-superuser role so RLS is enforced; a
-- separate admin connection (DATABASE_ADMIN_URL) is used for migrations.

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

-- Apply a standard owner_id policy to a table.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'owners', 'users', 'owner_customers', 'player_profiles',
    'venues', 'bookable_units', 'pricing_rules', 'slots',
    'bookings', 'membership_packs', 'ledger_txns', 'referrals',
    'addons', 'open_matches', 'tournaments', 'offers', 'audit_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    -- "owners" filters on id; everything else on owner_id.
    IF t = 'owners' THEN
      EXECUTE format($p$
        CREATE POLICY tenant_isolation ON %I
        USING (app_bypass_rls() OR id = app_current_owner_id())
        WITH CHECK (app_bypass_rls() OR id = app_current_owner_id());
      $p$, t);
    ELSIF t = 'users' THEN
      -- users is a mixed table: customers and super_admin are GLOBAL
      -- ("ownerId" IS NULL and shared across tenants); owner/staff are
      -- tenant-scoped. Global rows are readable/insertable in any context.
      EXECUTE format($p$
        CREATE POLICY tenant_isolation ON %I
        USING (app_bypass_rls() OR "ownerId" IS NULL OR "ownerId" = app_current_owner_id())
        WITH CHECK (app_bypass_rls() OR "ownerId" IS NULL OR "ownerId" = app_current_owner_id());
      $p$, t);
    ELSE
      -- Prisma maps the `ownerId` field to a camelCase column (no @map), so it
      -- must be double-quoted in SQL.
      EXECUTE format($p$
        CREATE POLICY tenant_isolation ON %I
        USING (app_bypass_rls() OR "ownerId" = app_current_owner_id())
        WITH CHECK (app_bypass_rls() OR "ownerId" = app_current_owner_id());
      $p$, t);
    END IF;
  END LOOP;
END $$;

-- Note: tables WITHOUT owner_id (game_catalogue, venue_games, venue_settings,
-- booking_addons, tournament_participants, open_match_join_requests) are
-- reached only via owner-scoped parents; game_catalogue is intentionally
-- global (managed by super admin). Add child policies later if accessed directly.
