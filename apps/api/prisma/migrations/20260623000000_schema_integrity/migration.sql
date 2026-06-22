-- Schema referential-integrity hardening (DB-1 .. DB-6).
-- Adds missing foreign keys on denormalized columns, tightens two existing
-- onDelete behaviours, and creates missing covering indexes for FK columns.
--
-- Hand-written to match prisma/schema.prisma exactly. Apply ONCE forward.
-- For the two changed constraints (DB-4, DB-5) the old constraint is dropped
-- before the new one is added.

-- ---------------------------------------------------------------------------
-- DB-1: Booking.venueId had no FK -> add one (RESTRICT).
-- ---------------------------------------------------------------------------
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- DB-2: Tournament.gameId had no FK -> add one to game_catalogue (RESTRICT).
-- ---------------------------------------------------------------------------
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "game_catalogue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- DB-3: Denormalized ownerId columns had no FK -> add owners FK (RESTRICT)
--       on slots, bookable_units, pricing_rules, bookings, open_matches,
--       tournaments, player_profiles.
-- ---------------------------------------------------------------------------
ALTER TABLE "slots" ADD CONSTRAINT "slots_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookable_units" ADD CONSTRAINT "bookable_units_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "open_matches" ADD CONSTRAINT "open_matches_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- DB-4: tournaments_venueId_fkey was ON DELETE CASCADE -> change to RESTRICT.
-- ---------------------------------------------------------------------------
ALTER TABLE "tournaments" DROP CONSTRAINT "tournaments_venueId_fkey";
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- DB-5: slots_bookingId_fkey was ON DELETE SET NULL -> change to CASCADE
--       (deleting a booking frees its slot instead of leaving a ghost row).
-- ---------------------------------------------------------------------------
ALTER TABLE "slots" DROP CONSTRAINT "slots_bookingId_fkey";
ALTER TABLE "slots" ADD CONSTRAINT "slots_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- DB-6: missing covering indexes on FK columns.
-- ---------------------------------------------------------------------------
CREATE INDEX "booking_addons_bookingId_idx" ON "booking_addons"("bookingId");
CREATE INDEX "booking_addons_addonId_idx" ON "booking_addons"("addonId");
CREATE INDEX "tournament_participants_tournamentId_idx" ON "tournament_participants"("tournamentId");
CREATE INDEX "slots_bookingId_idx" ON "slots"("bookingId");
CREATE INDEX "bookings_packId_idx" ON "bookings"("packId");
CREATE INDEX "bookings_offerId_idx" ON "bookings"("offerId");
