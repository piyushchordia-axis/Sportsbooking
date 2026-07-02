-- RLS policies (USING / WITH CHECK bodies) for every tenant table.
-- drizzle-kit push creates the policy SHELL but omits the sql-template
-- USING/WITH CHECK expression, so db:push applies this file right after push
-- to (re)create the policies with their real predicates. Idempotent.
-- Generated from the canonical policy set; keep in sync with schema.ts pgPolicy.
--
-- Each table is both ENABLEd and FORCEd. FORCE matters because the DDL/seed role
-- also OWNS these tables, and a table owner is exempt from its own (non-forced)
-- RLS — FORCE closes that gap so isolation holds even if something connects as
-- the owner. The runtime app connects as the non-owner `sportsbooking_app` role
-- (src/db/role-setup.sql), for which ENABLE alone already enforces RLS. The seed
-- and admin tasks set app.bypass_rls='on' to opt out where they need to.

ALTER TABLE "addons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "addons" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "addons";
CREATE POLICY "tenant_isolation" ON "addons" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "audit_logs";
CREATE POLICY "tenant_isolation" ON "audit_logs" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "bookable_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bookable_units" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "bookable_units";
CREATE POLICY "tenant_isolation" ON "bookable_units" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "booking_addons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_addons" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "booking_addons";
CREATE POLICY "tenant_isolation" ON "booking_addons" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = booking_addons."bookingId") AND (b."ownerId" = app_current_owner_id())))))) WITH CHECK ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = booking_addons."bookingId") AND (b."ownerId" = app_current_owner_id()))))));

ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bookings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "bookings";
CREATE POLICY "tenant_isolation" ON "bookings" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "ledger_txns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_txns" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "ledger_txns";
CREATE POLICY "tenant_isolation" ON "ledger_txns" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "membership_packs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership_packs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "membership_packs";
CREATE POLICY "tenant_isolation" ON "membership_packs" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "offer_redemptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offer_redemptions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "offer_redemptions";
CREATE POLICY "tenant_isolation" ON "offer_redemptions" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "offers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offers" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "offers";
CREATE POLICY "tenant_isolation" ON "offers" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "open_match_join_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "open_match_join_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "open_match_join_requests";
CREATE POLICY "tenant_isolation" ON "open_match_join_requests" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM open_matches m
  WHERE ((m.id = open_match_join_requests."matchId") AND (m."ownerId" = app_current_owner_id())))))) WITH CHECK ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM open_matches m
  WHERE ((m.id = open_match_join_requests."matchId") AND (m."ownerId" = app_current_owner_id()))))));

ALTER TABLE "open_matches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "open_matches" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "open_matches";
CREATE POLICY "tenant_isolation" ON "open_matches" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "owner_customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "owner_customers" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "owner_customers";
CREATE POLICY "tenant_isolation" ON "owner_customers" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "owners" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "owners" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "owners";
CREATE POLICY "tenant_isolation" ON "owners" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR (id = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR (id = app_current_owner_id())));

ALTER TABLE "player_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "player_profiles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "player_profiles";
CREATE POLICY "tenant_isolation" ON "player_profiles" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "pricing_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pricing_rules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "pricing_rules";
CREATE POLICY "tenant_isolation" ON "pricing_rules" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "referrals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "referrals" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "referrals";
CREATE POLICY "tenant_isolation" ON "referrals" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "slots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "slots" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "slots";
CREATE POLICY "tenant_isolation" ON "slots" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "tournament_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tournament_participants" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "tournament_participants";
CREATE POLICY "tenant_isolation" ON "tournament_participants" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM tournaments t
  WHERE ((t.id = tournament_participants."tournamentId") AND (t."ownerId" = app_current_owner_id())))))) WITH CHECK ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM tournaments t
  WHERE ((t.id = tournament_participants."tournamentId") AND (t."ownerId" = app_current_owner_id()))))));

ALTER TABLE "tournaments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tournaments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "tournaments";
CREATE POLICY "tenant_isolation" ON "tournaments" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "users";
CREATE POLICY "tenant_isolation" ON "users" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" IS NULL) OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" IS NULL) OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "venue_games" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "venue_games" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "venue_games";
CREATE POLICY "tenant_isolation" ON "venue_games" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_games."venueId") AND (v."ownerId" = app_current_owner_id())))))) WITH CHECK ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_games."venueId") AND (v."ownerId" = app_current_owner_id()))))));

ALTER TABLE "venue_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "venue_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "venue_settings";
CREATE POLICY "tenant_isolation" ON "venue_settings" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_settings."venueId") AND (v."ownerId" = app_current_owner_id())))))) WITH CHECK ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_settings."venueId") AND (v."ownerId" = app_current_owner_id()))))));

ALTER TABLE "venues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "venues" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "venues";
CREATE POLICY "tenant_isolation" ON "venues" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "notifications";
CREATE POLICY "tenant_isolation" ON "notifications" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "payments";
CREATE POLICY "tenant_isolation" ON "payments" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "tournament_matches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tournament_matches" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "tournament_matches";
CREATE POLICY "tenant_isolation" ON "tournament_matches" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));

ALTER TABLE "saved_venues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_venues" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "saved_venues";
CREATE POLICY "tenant_isolation" ON "saved_venues" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));
