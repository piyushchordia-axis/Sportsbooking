-- RLS policies (USING / WITH CHECK bodies) for every tenant table.
-- drizzle-kit push creates the policy SHELL but omits the sql-template
-- USING/WITH CHECK expression, so db:push applies this file right after push
-- to (re)create the policies with their real predicates. Idempotent.
-- Generated from the canonical policy set; keep in sync with schema.ts pgPolicy.

ALTER TABLE "addons" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "addons";
CREATE POLICY "tenant_isolation" ON "addons" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "audit_logs";
CREATE POLICY "tenant_isolation" ON "audit_logs" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "bookable_units" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "bookable_units";
CREATE POLICY "tenant_isolation" ON "bookable_units" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "booking_addons" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "booking_addons";
CREATE POLICY "tenant_isolation" ON "booking_addons" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = booking_addons."bookingId") AND (b."ownerId" = app_current_owner_id())))))) WITH CHECK ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = booking_addons."bookingId") AND (b."ownerId" = app_current_owner_id()))))));

ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "bookings";
CREATE POLICY "tenant_isolation" ON "bookings" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "ledger_txns" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "ledger_txns";
CREATE POLICY "tenant_isolation" ON "ledger_txns" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "membership_packs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "membership_packs";
CREATE POLICY "tenant_isolation" ON "membership_packs" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "offers" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "offers";
CREATE POLICY "tenant_isolation" ON "offers" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "open_match_join_requests" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "open_match_join_requests";
CREATE POLICY "tenant_isolation" ON "open_match_join_requests" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM open_matches m
  WHERE ((m.id = open_match_join_requests."matchId") AND (m."ownerId" = app_current_owner_id())))))) WITH CHECK ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM open_matches m
  WHERE ((m.id = open_match_join_requests."matchId") AND (m."ownerId" = app_current_owner_id()))))));

ALTER TABLE "open_matches" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "open_matches";
CREATE POLICY "tenant_isolation" ON "open_matches" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "owner_customers" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "owner_customers";
CREATE POLICY "tenant_isolation" ON "owner_customers" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "owners" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "owners";
CREATE POLICY "tenant_isolation" ON "owners" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR (id = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR (id = app_current_owner_id())));

ALTER TABLE "player_profiles" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "player_profiles";
CREATE POLICY "tenant_isolation" ON "player_profiles" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "pricing_rules" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "pricing_rules";
CREATE POLICY "tenant_isolation" ON "pricing_rules" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "referrals" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "referrals";
CREATE POLICY "tenant_isolation" ON "referrals" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "slots" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "slots";
CREATE POLICY "tenant_isolation" ON "slots" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "tournament_participants" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "tournament_participants";
CREATE POLICY "tenant_isolation" ON "tournament_participants" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM tournaments t
  WHERE ((t.id = tournament_participants."tournamentId") AND (t."ownerId" = app_current_owner_id())))))) WITH CHECK ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM tournaments t
  WHERE ((t.id = tournament_participants."tournamentId") AND (t."ownerId" = app_current_owner_id()))))));

ALTER TABLE "tournaments" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "tournaments";
CREATE POLICY "tenant_isolation" ON "tournaments" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "users";
CREATE POLICY "tenant_isolation" ON "users" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" IS NULL) OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" IS NULL) OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "venue_games" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "venue_games";
CREATE POLICY "tenant_isolation" ON "venue_games" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_games."venueId") AND (v."ownerId" = app_current_owner_id())))))) WITH CHECK ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_games."venueId") AND (v."ownerId" = app_current_owner_id()))))));

ALTER TABLE "venue_settings" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "venue_settings";
CREATE POLICY "tenant_isolation" ON "venue_settings" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_settings."venueId") AND (v."ownerId" = app_current_owner_id())))))) WITH CHECK ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_settings."venueId") AND (v."ownerId" = app_current_owner_id()))))));

ALTER TABLE "venues" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "venues";
CREATE POLICY "tenant_isolation" ON "venues" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

