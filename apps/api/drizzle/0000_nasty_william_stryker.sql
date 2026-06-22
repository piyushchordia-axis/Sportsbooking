-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."AddonType" AS ENUM('rental', 'cafe', 'coaching');--> statement-breakpoint
CREATE TYPE "public"."BookingStatus" AS ENUM('confirmed', 'cancelled', 'completed', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."DayType" AS ENUM('weekday', 'weekend');--> statement-breakpoint
CREATE TYPE "public"."FeeBasis" AS ENUM('per_player', 'per_team');--> statement-breakpoint
CREATE TYPE "public"."JoinRequestStatus" AS ENUM('requested', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."LedgerTxnType" AS ENUM('pack_buy', 'pack_debit', 'pack_refund', 'points_earn', 'points_redeem', 'referral_reward', 'no_show_fee', 'cash_refund', 'open_match_settle');--> statement-breakpoint
CREATE TYPE "public"."OfferType" AS ENUM('percent', 'flat');--> statement-breakpoint
CREATE TYPE "public"."OpenMatchRepaymentMode" AS ENUM('info', 'ledger');--> statement-breakpoint
CREATE TYPE "public"."OpenMatchStatus" AS ENUM('open', 'full', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."OwnerStatus" AS ENUM('active', 'suspended', 'pending');--> statement-breakpoint
CREATE TYPE "public"."PackExpiryMode" AS ENUM('forfeit', 'rollover', 'none');--> statement-breakpoint
CREATE TYPE "public"."PackPricingMode" AS ENUM('flat', 'discount');--> statement-breakpoint
CREATE TYPE "public"."PayMode" AS ENUM('prepay', 'at_venue');--> statement-breakpoint
CREATE TYPE "public"."PaymentStatus" AS ENUM('pending', 'paid', 'awaiting_venue_settlement', 'settled_at_venue', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ReferralStatus" AS ENUM('pending', 'rewarded', 'expired');--> statement-breakpoint
CREATE TYPE "public"."RegistrationType" AS ENUM('solo', 'team');--> statement-breakpoint
CREATE TYPE "public"."SkillLevel" AS ENUM('beginner', 'advanced_beginner', 'advanced', 'pro');--> statement-breakpoint
CREATE TYPE "public"."SlotStatus" AS ENUM('open', 'booked', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."TimeBand" AS ENUM('morning', 'afternoon', 'evening');--> statement-breakpoint
CREATE TYPE "public"."TournamentFormat" AS ENUM('knockout', 'league', 'round_robin');--> statement-breakpoint
CREATE TYPE "public"."UnitLabel" AS ENUM('court', 'turf', 'lane', 'net');--> statement-breakpoint
CREATE TYPE "public"."UserRole" AS ENUM('super_admin', 'owner', 'staff', 'customer');--> statement-breakpoint
CREATE TABLE "_prisma_migrations" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"finished_at" timestamp with time zone,
	"migration_name" varchar(255) NOT NULL,
	"logs" text,
	"rolled_back_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_steps_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_catalogue" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"iconUrl" text,
	"slotGranularityMin" integer DEFAULT 60 NOT NULL,
	"unitLabel" "UnitLabel" DEFAULT 'court' NOT NULL,
	"minPlayers" integer DEFAULT 2 NOT NULL,
	"maxPlayers" integer DEFAULT 4 NOT NULL,
	"defaultOpenTime" text DEFAULT '06:00' NOT NULL,
	"defaultCloseTime" text DEFAULT '23:00' NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contactEmail" text NOT NULL,
	"contactMobile" text,
	"status" "OwnerStatus" DEFAULT 'pending' NOT NULL,
	"venueQuota" integer DEFAULT 1 NOT NULL,
	"allowedGameIds" text[] DEFAULT '{"RAY"}',
	"featureFlags" text[] DEFAULT '{"RAY"}',
	"logoUrl" text,
	"primaryColor" text DEFAULT '#0EA5E9' NOT NULL,
	"secondaryColor" text DEFAULT '#0F172A' NOT NULL,
	"accentColor" text DEFAULT '#22C55E' NOT NULL,
	"setupFee" numeric(12, 2),
	"amcAmount" numeric(12, 2),
	"amcRenewalDate" timestamp(3),
	"loyaltyEarnRate" numeric(6, 4) DEFAULT '0.05' NOT NULL,
	"loyaltyRedeemValue" numeric(10, 2) DEFAULT '1' NOT NULL,
	"referralReward" numeric(10, 2) DEFAULT '100' NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owners" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "open_match_join_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"matchId" text NOT NULL,
	"playerId" text NOT NULL,
	"status" "JoinRequestStatus" DEFAULT 'requested' NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "open_match_join_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"role" "UserRole" NOT NULL,
	"ownerId" text,
	"name" text NOT NULL,
	"email" text,
	"mobile" text,
	"passwordHash" text,
	"assignedVenueIds" text[] DEFAULT '{"RAY"}',
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tournament_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"tournamentId" text NOT NULL,
	"teamName" text,
	"captainName" text NOT NULL,
	"captainMobile" text NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"razorpayOrderId" text,
	"razorpayPaymentId" text,
	"idempotencyKey" text
);
--> statement-breakpoint
ALTER TABLE "tournament_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "owner_customers" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"customerId" text NOT NULL,
	"firstSeenAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"lastVisitAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"bookingCount" integer DEFAULT 0 NOT NULL,
	"consent" boolean DEFAULT false NOT NULL,
	"optedOut" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owner_customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "player_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"customerId" text NOT NULL,
	"name" text NOT NULL,
	"mobile" text NOT NULL,
	"games" text[] DEFAULT '{"RAY"}',
	"skillLevel" "SkillLevel" DEFAULT 'beginner' NOT NULL,
	"consent" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "venues" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"name" text NOT NULL,
	"geoLat" double precision,
	"geoLng" double precision,
	"address" text,
	"city" text,
	"contactPhone" text,
	"photos" text[] DEFAULT '{"RAY"}',
	"openTime" text DEFAULT '06:00' NOT NULL,
	"closeTime" text DEFAULT '23:00' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "venues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bookable_units" (
	"id" text PRIMARY KEY NOT NULL,
	"venueId" text NOT NULL,
	"ownerId" text NOT NULL,
	"name" text NOT NULL,
	"label" "UnitLabel" DEFAULT 'court' NOT NULL,
	"gameId" text NOT NULL,
	"capacity" integer DEFAULT 4 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookable_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"unitId" text NOT NULL,
	"ownerId" text NOT NULL,
	"dayType" "DayType",
	"timeBand" "TimeBand",
	"dateOverride" date,
	"minDuration" integer,
	"price" numeric(10, 2) NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pricing_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "slots" (
	"id" text PRIMARY KEY NOT NULL,
	"unitId" text NOT NULL,
	"ownerId" text NOT NULL,
	"startsAt" timestamp(3) NOT NULL,
	"endsAt" timestamp(3) NOT NULL,
	"status" "SlotStatus" DEFAULT 'booked' NOT NULL,
	"blockReason" text,
	"bookingId" text,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "slots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "venue_settings" (
	"venueId" text PRIMARY KEY NOT NULL,
	"cancellationTemplate" text DEFAULT 'flexible' NOT NULL,
	"noShowFee" numeric(10, 2) DEFAULT '0' NOT NULL,
	"loyaltyEarnRate" numeric(6, 4),
	"loyaltyRedeemValue" numeric(10, 2),
	"openMatchRepaymentMode" "OpenMatchRepaymentMode" DEFAULT 'info' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "venue_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "booking_addons" (
	"id" text PRIMARY KEY NOT NULL,
	"bookingId" text NOT NULL,
	"addonId" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unitPrice" numeric(10, 2) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_addons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"venueId" text NOT NULL,
	"customerId" text NOT NULL,
	"status" "BookingStatus" DEFAULT 'confirmed' NOT NULL,
	"payMode" "PayMode" NOT NULL,
	"paymentStatus" "PaymentStatus" DEFAULT 'pending' NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"discount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"packId" text,
	"offerId" text,
	"pointsRedeemed" numeric(12, 2) DEFAULT '0' NOT NULL,
	"noShowFeeApplied" boolean DEFAULT false NOT NULL,
	"seriesId" text,
	"razorpayOrderId" text,
	"razorpayPaymentId" text,
	"idempotencyKey" text,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "membership_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"name" text NOT NULL,
	"sessions" integer NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"validityDays" integer,
	"expiryMode" "PackExpiryMode" DEFAULT 'forfeit' NOT NULL,
	"pricingMode" "PackPricingMode" DEFAULT 'flat' NOT NULL,
	"discountPct" numeric(5, 2),
	"flatRate" numeric(10, 2),
	"venueIds" text[] DEFAULT '{"RAY"}',
	"unitIds" text[] DEFAULT '{"RAY"}',
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "membership_packs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ledger_txns" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"customerId" text NOT NULL,
	"type" "LedgerTxnType" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"balanceAfter" numeric(12, 2) NOT NULL,
	"lane" text NOT NULL,
	"refType" text,
	"refId" text,
	"note" text,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_txns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"referrerId" text NOT NULL,
	"refereeId" text,
	"code" text NOT NULL,
	"status" "ReferralStatus" DEFAULT 'pending' NOT NULL,
	"rewardReleasedOnFirstPaid" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "referrals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "addons" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"venueId" text NOT NULL,
	"name" text NOT NULL,
	"type" "AddonType" NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"stock" integer,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "addons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "open_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"bookingId" text NOT NULL,
	"hostId" text NOT NULL,
	"openSpots" integer NOT NULL,
	"skillMin" "SkillLevel" DEFAULT 'beginner' NOT NULL,
	"skillMax" "SkillLevel" DEFAULT 'pro' NOT NULL,
	"repaymentMode" "OpenMatchRepaymentMode" DEFAULT 'info' NOT NULL,
	"status" "OpenMatchStatus" DEFAULT 'open' NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "open_matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"venueId" text NOT NULL,
	"name" text NOT NULL,
	"gameId" text NOT NULL,
	"format" "TournamentFormat" NOT NULL,
	"startDate" date NOT NULL,
	"endDate" date NOT NULL,
	"capacity" integer NOT NULL,
	"regType" "RegistrationType" NOT NULL,
	"feeBasis" "FeeBasis" NOT NULL,
	"fee" numeric(10, 2) NOT NULL,
	"regCloseAt" timestamp(3),
	"refundAllowedAfterClose" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tournaments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "offers" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"name" text NOT NULL,
	"type" "OfferType" NOT NULL,
	"value" numeric(10, 2) NOT NULL,
	"code" text,
	"autoApply" boolean DEFAULT false NOT NULL,
	"validFrom" timestamp(3),
	"validTo" timestamp(3),
	"venueIds" text[] DEFAULT '{"RAY"}',
	"gameIds" text[] DEFAULT '{"RAY"}',
	"segment" text,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text,
	"actorId" text NOT NULL,
	"actorRole" "UserRole" NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entityId" text,
	"metadata" jsonb,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "venue_games" (
	"venueId" text NOT NULL,
	"gameId" text NOT NULL,
	CONSTRAINT "venue_games_pkey" PRIMARY KEY("venueId","gameId")
);
--> statement-breakpoint
ALTER TABLE "venue_games" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "open_match_join_requests" ADD CONSTRAINT "open_match_join_requests_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "public"."open_matches"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "open_match_join_requests" ADD CONSTRAINT "open_match_join_requests_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."owners"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "owner_customers" ADD CONSTRAINT "owner_customers_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "owner_customers" ADD CONSTRAINT "owner_customers_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "bookable_units" ADD CONSTRAINT "bookable_units_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "bookable_units" ADD CONSTRAINT "bookable_units_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "public"."game_catalogue"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "bookable_units" ADD CONSTRAINT "bookable_units_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "public"."bookable_units"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "public"."bookable_units"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "venue_settings" ADD CONSTRAINT "venue_settings_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "booking_addons" ADD CONSTRAINT "booking_addons_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "booking_addons" ADD CONSTRAINT "booking_addons_addonId_fkey" FOREIGN KEY ("addonId") REFERENCES "public"."addons"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_packId_fkey" FOREIGN KEY ("packId") REFERENCES "public"."membership_packs"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "public"."offers"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "membership_packs" ADD CONSTRAINT "membership_packs_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ledger_txns" ADD CONSTRAINT "ledger_txns_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ledger_txns" ADD CONSTRAINT "ledger_txns_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_refereeId_fkey" FOREIGN KEY ("refereeId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "addons" ADD CONSTRAINT "addons_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "open_matches" ADD CONSTRAINT "open_matches_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "open_matches" ADD CONSTRAINT "open_matches_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "open_matches" ADD CONSTRAINT "open_matches_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "public"."game_catalogue"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."owners"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "venue_games" ADD CONSTRAINT "venue_games_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "venue_games" ADD CONSTRAINT "venue_games_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "public"."game_catalogue"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "game_catalogue_name_key" ON "game_catalogue" USING btree ("name" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "open_match_join_requests_matchId_playerId_key" ON "open_match_join_requests" USING btree ("matchId" text_ops,"playerId" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "users_mobile_key" ON "users" USING btree ("mobile" text_ops);--> statement-breakpoint
CREATE INDEX "users_ownerId_idx" ON "users" USING btree ("ownerId" text_ops);--> statement-breakpoint
CREATE INDEX "tournament_participants_tournamentId_idx" ON "tournament_participants" USING btree ("tournamentId" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "owner_customers_ownerId_customerId_key" ON "owner_customers" USING btree ("ownerId" text_ops,"customerId" text_ops);--> statement-breakpoint
CREATE INDEX "owner_customers_ownerId_idx" ON "owner_customers" USING btree ("ownerId" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "player_profiles_ownerId_customerId_key" ON "player_profiles" USING btree ("ownerId" text_ops,"customerId" text_ops);--> statement-breakpoint
CREATE INDEX "player_profiles_ownerId_idx" ON "player_profiles" USING btree ("ownerId" text_ops);--> statement-breakpoint
CREATE INDEX "venues_city_idx" ON "venues" USING btree ("city" text_ops);--> statement-breakpoint
CREATE INDEX "venues_ownerId_idx" ON "venues" USING btree ("ownerId" text_ops);--> statement-breakpoint
CREATE INDEX "bookable_units_ownerId_idx" ON "bookable_units" USING btree ("ownerId" text_ops);--> statement-breakpoint
CREATE INDEX "bookable_units_venueId_idx" ON "bookable_units" USING btree ("venueId" text_ops);--> statement-breakpoint
CREATE INDEX "pricing_rules_ownerId_idx" ON "pricing_rules" USING btree ("ownerId" text_ops);--> statement-breakpoint
CREATE INDEX "pricing_rules_unitId_idx" ON "pricing_rules" USING btree ("unitId" text_ops);--> statement-breakpoint
CREATE INDEX "slots_bookingId_idx" ON "slots" USING btree ("bookingId" text_ops);--> statement-breakpoint
CREATE INDEX "slots_ownerId_idx" ON "slots" USING btree ("ownerId" text_ops);--> statement-breakpoint
CREATE INDEX "slots_unitId_startsAt_idx" ON "slots" USING btree ("unitId" text_ops,"startsAt" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "slots_unitId_startsAt_key" ON "slots" USING btree ("unitId" timestamp_ops,"startsAt" text_ops);--> statement-breakpoint
CREATE INDEX "booking_addons_addonId_idx" ON "booking_addons" USING btree ("addonId" text_ops);--> statement-breakpoint
CREATE INDEX "booking_addons_bookingId_idx" ON "booking_addons" USING btree ("bookingId" text_ops);--> statement-breakpoint
CREATE INDEX "bookings_customerId_idx" ON "bookings" USING btree ("customerId" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_idempotencyKey_key" ON "bookings" USING btree ("idempotencyKey" text_ops);--> statement-breakpoint
CREATE INDEX "bookings_offerId_idx" ON "bookings" USING btree ("offerId" text_ops);--> statement-breakpoint
CREATE INDEX "bookings_ownerId_idx" ON "bookings" USING btree ("ownerId" text_ops);--> statement-breakpoint
CREATE INDEX "bookings_packId_idx" ON "bookings" USING btree ("packId" text_ops);--> statement-breakpoint
CREATE INDEX "bookings_seriesId_idx" ON "bookings" USING btree ("seriesId" text_ops);--> statement-breakpoint
CREATE INDEX "bookings_venueId_idx" ON "bookings" USING btree ("venueId" text_ops);--> statement-breakpoint
CREATE INDEX "membership_packs_ownerId_idx" ON "membership_packs" USING btree ("ownerId" text_ops);--> statement-breakpoint
CREATE INDEX "ledger_txns_customerId_lane_idx" ON "ledger_txns" USING btree ("customerId" text_ops,"lane" text_ops);--> statement-breakpoint
CREATE INDEX "ledger_txns_ownerId_idx" ON "ledger_txns" USING btree ("ownerId" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_ownerId_code_key" ON "referrals" USING btree ("ownerId" text_ops,"code" text_ops);--> statement-breakpoint
CREATE INDEX "referrals_ownerId_idx" ON "referrals" USING btree ("ownerId" text_ops);--> statement-breakpoint
CREATE INDEX "addons_ownerId_idx" ON "addons" USING btree ("ownerId" text_ops);--> statement-breakpoint
CREATE INDEX "addons_venueId_idx" ON "addons" USING btree ("venueId" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "open_matches_bookingId_key" ON "open_matches" USING btree ("bookingId" text_ops);--> statement-breakpoint
CREATE INDEX "open_matches_ownerId_idx" ON "open_matches" USING btree ("ownerId" text_ops);--> statement-breakpoint
CREATE INDEX "tournaments_ownerId_idx" ON "tournaments" USING btree ("ownerId" text_ops);--> statement-breakpoint
CREATE INDEX "tournaments_venueId_idx" ON "tournaments" USING btree ("venueId" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "offers_ownerId_code_key" ON "offers" USING btree ("ownerId" text_ops,"code" text_ops);--> statement-breakpoint
CREATE INDEX "offers_ownerId_idx" ON "offers" USING btree ("ownerId" text_ops);--> statement-breakpoint
CREATE INDEX "audit_logs_ownerId_idx" ON "audit_logs" USING btree ("ownerId" text_ops);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "owners" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR (id = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR (id = app_current_owner_id())));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "open_match_join_requests" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM open_matches m
  WHERE ((m.id = open_match_join_requests."matchId") AND (m."ownerId" = app_current_owner_id())))))) WITH CHECK ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM open_matches m
  WHERE ((m.id = open_match_join_requests."matchId") AND (m."ownerId" = app_current_owner_id()))))));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "users" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" IS NULL) OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" IS NULL) OR ("ownerId" = app_current_owner_id())));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tournament_participants" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM tournaments t
  WHERE ((t.id = tournament_participants."tournamentId") AND (t."ownerId" = app_current_owner_id())))))) WITH CHECK ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM tournaments t
  WHERE ((t.id = tournament_participants."tournamentId") AND (t."ownerId" = app_current_owner_id()))))));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "owner_customers" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "player_profiles" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "venues" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bookable_units" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "pricing_rules" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "slots" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "venue_settings" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_settings."venueId") AND (v."ownerId" = app_current_owner_id())))))) WITH CHECK ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_settings."venueId") AND (v."ownerId" = app_current_owner_id()))))));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "booking_addons" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = booking_addons."bookingId") AND (b."ownerId" = app_current_owner_id())))))) WITH CHECK ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = booking_addons."bookingId") AND (b."ownerId" = app_current_owner_id()))))));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bookings" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "membership_packs" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ledger_txns" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "referrals" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "addons" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "open_matches" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tournaments" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "offers" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_logs" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR ("ownerId" = app_current_owner_id()))) WITH CHECK ((app_bypass_rls() OR ("ownerId" = app_current_owner_id())));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "venue_games" AS PERMISSIVE FOR ALL TO public USING ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_games."venueId") AND (v."ownerId" = app_current_owner_id())))))) WITH CHECK ((app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_games."venueId") AND (v."ownerId" = app_current_owner_id()))))));
*/