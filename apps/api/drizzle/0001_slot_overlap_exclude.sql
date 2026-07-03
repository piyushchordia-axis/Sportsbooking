-- Custom SQL migration file, put your code below! --
--
-- Race-safe double-booking protection at the DB layer.
--
-- The app checks for overlaps before inserting (findSlotConflict), but that is
-- check-then-act: under concurrency two requests can both pass the check and
-- insert overlapping slots. The existing UNIQUE(unitId, startsAt) only catches
-- an EXACT same-start race, not a partial overlap (10:00-11:00 vs 10:30-11:30)
-- between different-duration slots. This GiST EXCLUDE constraint makes overlap
-- impossible for the same unit — the true backstop behind the app-level check.
--
-- Ranges are half-open [startsAt, endsAt): adjacent slots (…-11:00 and 11:00-…)
-- do NOT overlap and stay bookable. Columns are `timestamp without time zone`,
-- so tsrange (not tstzrange) is used. btree_gist provides the `=` opclass for
-- the scalar unitId inside a GiST index; it is a trusted extension.
--
-- NOTE (existing databases): if any overlapping slot rows already exist, ADD
-- CONSTRAINT fails (transactionally — nothing is changed). Resolve/delete the
-- overlaps first, then re-run the migration.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "slots"
  ADD CONSTRAINT "slots_unit_no_overlap"
  EXCLUDE USING gist ("unitId" WITH =, tsrange("startsAt", "endsAt") WITH &&);