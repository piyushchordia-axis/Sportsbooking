-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_admin', 'owner', 'staff', 'customer');

-- CreateEnum
CREATE TYPE "OwnerStatus" AS ENUM ('active', 'suspended', 'pending');

-- CreateEnum
CREATE TYPE "UnitLabel" AS ENUM ('court', 'turf', 'lane', 'net');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('open', 'booked', 'blocked');

-- CreateEnum
CREATE TYPE "DayType" AS ENUM ('weekday', 'weekend');

-- CreateEnum
CREATE TYPE "TimeBand" AS ENUM ('morning', 'afternoon', 'evening');

-- CreateEnum
CREATE TYPE "PayMode" AS ENUM ('prepay', 'at_venue');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid', 'awaiting_venue_settlement', 'settled_at_venue', 'refunded', 'failed');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('confirmed', 'cancelled', 'completed', 'no_show');

-- CreateEnum
CREATE TYPE "PackExpiryMode" AS ENUM ('forfeit', 'rollover', 'none');

-- CreateEnum
CREATE TYPE "PackPricingMode" AS ENUM ('flat', 'discount');

-- CreateEnum
CREATE TYPE "LedgerTxnType" AS ENUM ('pack_buy', 'pack_debit', 'pack_refund', 'points_earn', 'points_redeem', 'referral_reward', 'no_show_fee', 'cash_refund', 'open_match_settle');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('pending', 'rewarded', 'expired');

-- CreateEnum
CREATE TYPE "OpenMatchStatus" AS ENUM ('open', 'full', 'cancelled', 'completed');

-- CreateEnum
CREATE TYPE "OpenMatchRepaymentMode" AS ENUM ('info', 'ledger');

-- CreateEnum
CREATE TYPE "JoinRequestStatus" AS ENUM ('requested', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "AddonType" AS ENUM ('rental', 'cafe', 'coaching');

-- CreateEnum
CREATE TYPE "TournamentFormat" AS ENUM ('knockout', 'league', 'round_robin');

-- CreateEnum
CREATE TYPE "RegistrationType" AS ENUM ('solo', 'team');

-- CreateEnum
CREATE TYPE "FeeBasis" AS ENUM ('per_player', 'per_team');

-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('percent', 'flat');

-- CreateEnum
CREATE TYPE "SkillLevel" AS ENUM ('beginner', 'advanced_beginner', 'advanced', 'pro');

-- CreateTable
CREATE TABLE "game_catalogue" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iconUrl" TEXT,
    "slotGranularityMin" INTEGER NOT NULL DEFAULT 60,
    "unitLabel" "UnitLabel" NOT NULL DEFAULT 'court',
    "minPlayers" INTEGER NOT NULL DEFAULT 2,
    "maxPlayers" INTEGER NOT NULL DEFAULT 4,
    "defaultOpenTime" TEXT NOT NULL DEFAULT '06:00',
    "defaultCloseTime" TEXT NOT NULL DEFAULT '23:00',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_catalogue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactMobile" TEXT,
    "status" "OwnerStatus" NOT NULL DEFAULT 'pending',
    "venueQuota" INTEGER NOT NULL DEFAULT 1,
    "allowedGameIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "featureFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#0EA5E9',
    "secondaryColor" TEXT NOT NULL DEFAULT '#0F172A',
    "accentColor" TEXT NOT NULL DEFAULT '#22C55E',
    "setupFee" DECIMAL(12,2),
    "amcAmount" DECIMAL(12,2),
    "amcRenewalDate" TIMESTAMP(3),
    "loyaltyEarnRate" DECIMAL(6,4) NOT NULL DEFAULT 0.05,
    "loyaltyRedeemValue" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "referralReward" DECIMAL(10,2) NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "mobile" TEXT,
    "passwordHash" TEXT,
    "assignedVenueIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_customers" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVisitAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bookingCount" INTEGER NOT NULL DEFAULT 0,
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "owner_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_profiles" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "games" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skillLevel" "SkillLevel" NOT NULL DEFAULT 'beginner',
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venues" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "geoLat" DOUBLE PRECISION,
    "geoLng" DOUBLE PRECISION,
    "address" TEXT,
    "city" TEXT,
    "contactPhone" TEXT,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "openTime" TEXT NOT NULL DEFAULT '06:00',
    "closeTime" TEXT NOT NULL DEFAULT '23:00',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venue_games" (
    "venueId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,

    CONSTRAINT "venue_games_pkey" PRIMARY KEY ("venueId","gameId")
);

-- CreateTable
CREATE TABLE "venue_settings" (
    "venueId" TEXT NOT NULL,
    "cancellationTemplate" TEXT NOT NULL DEFAULT 'flexible',
    "noShowFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "loyaltyEarnRate" DECIMAL(6,4),
    "loyaltyRedeemValue" DECIMAL(10,2),
    "openMatchRepaymentMode" "OpenMatchRepaymentMode" NOT NULL DEFAULT 'info',

    CONSTRAINT "venue_settings_pkey" PRIMARY KEY ("venueId")
);

-- CreateTable
CREATE TABLE "bookable_units" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" "UnitLabel" NOT NULL DEFAULT 'court',
    "gameId" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookable_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "dayType" "DayType",
    "timeBand" "TimeBand",
    "dateOverride" DATE,
    "minDuration" INTEGER,
    "price" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slots" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "SlotStatus" NOT NULL DEFAULT 'booked',
    "blockReason" TEXT,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'confirmed',
    "payMode" "PayMode" NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "packId" TEXT,
    "offerId" TEXT,
    "pointsRedeemed" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "noShowFeeApplied" BOOLEAN NOT NULL DEFAULT false,
    "seriesId" TEXT,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_addons" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "addonId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "booking_addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_packs" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "validityDays" INTEGER,
    "expiryMode" "PackExpiryMode" NOT NULL DEFAULT 'forfeit',
    "pricingMode" "PackPricingMode" NOT NULL DEFAULT 'flat',
    "discountPct" DECIMAL(5,2),
    "flatRate" DECIMAL(10,2),
    "venueIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unitIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_txns" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "LedgerTxnType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "lane" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_txns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId" TEXT,
    "code" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'pending',
    "rewardReleasedOnFirstPaid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addons" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AddonType" NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "stock" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "open_matches" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "openSpots" INTEGER NOT NULL,
    "skillMin" "SkillLevel" NOT NULL DEFAULT 'beginner',
    "skillMax" "SkillLevel" NOT NULL DEFAULT 'pro',
    "repaymentMode" "OpenMatchRepaymentMode" NOT NULL DEFAULT 'info',
    "status" "OpenMatchStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "open_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "open_match_join_requests" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'requested',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "open_match_join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournaments" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "format" "TournamentFormat" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "capacity" INTEGER NOT NULL,
    "regType" "RegistrationType" NOT NULL,
    "feeBasis" "FeeBasis" NOT NULL,
    "fee" DECIMAL(10,2) NOT NULL,
    "regCloseAt" TIMESTAMP(3),
    "refundAllowedAfterClose" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_participants" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "teamName" TEXT,
    "captainName" TEXT NOT NULL,
    "captainMobile" TEXT NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OfferType" NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "code" TEXT,
    "autoApply" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "venueIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gameIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "segment" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "actorId" TEXT NOT NULL,
    "actorRole" "UserRole" NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_catalogue_name_key" ON "game_catalogue"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_mobile_key" ON "users"("mobile");

-- CreateIndex
CREATE INDEX "users_ownerId_idx" ON "users"("ownerId");

-- CreateIndex
CREATE INDEX "owner_customers_ownerId_idx" ON "owner_customers"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "owner_customers_ownerId_customerId_key" ON "owner_customers"("ownerId", "customerId");

-- CreateIndex
CREATE INDEX "player_profiles_ownerId_idx" ON "player_profiles"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "player_profiles_ownerId_customerId_key" ON "player_profiles"("ownerId", "customerId");

-- CreateIndex
CREATE INDEX "venues_ownerId_idx" ON "venues"("ownerId");

-- CreateIndex
CREATE INDEX "venues_city_idx" ON "venues"("city");

-- CreateIndex
CREATE INDEX "bookable_units_venueId_idx" ON "bookable_units"("venueId");

-- CreateIndex
CREATE INDEX "bookable_units_ownerId_idx" ON "bookable_units"("ownerId");

-- CreateIndex
CREATE INDEX "pricing_rules_unitId_idx" ON "pricing_rules"("unitId");

-- CreateIndex
CREATE INDEX "pricing_rules_ownerId_idx" ON "pricing_rules"("ownerId");

-- CreateIndex
CREATE INDEX "slots_unitId_startsAt_idx" ON "slots"("unitId", "startsAt");

-- CreateIndex
CREATE INDEX "slots_ownerId_idx" ON "slots"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "slots_unitId_startsAt_key" ON "slots"("unitId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_idempotencyKey_key" ON "bookings"("idempotencyKey");

-- CreateIndex
CREATE INDEX "bookings_ownerId_idx" ON "bookings"("ownerId");

-- CreateIndex
CREATE INDEX "bookings_venueId_idx" ON "bookings"("venueId");

-- CreateIndex
CREATE INDEX "bookings_customerId_idx" ON "bookings"("customerId");

-- CreateIndex
CREATE INDEX "bookings_seriesId_idx" ON "bookings"("seriesId");

-- CreateIndex
CREATE INDEX "membership_packs_ownerId_idx" ON "membership_packs"("ownerId");

-- CreateIndex
CREATE INDEX "ledger_txns_ownerId_idx" ON "ledger_txns"("ownerId");

-- CreateIndex
CREATE INDEX "ledger_txns_customerId_lane_idx" ON "ledger_txns"("customerId", "lane");

-- CreateIndex
CREATE INDEX "referrals_ownerId_idx" ON "referrals"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_ownerId_code_key" ON "referrals"("ownerId", "code");

-- CreateIndex
CREATE INDEX "addons_venueId_idx" ON "addons"("venueId");

-- CreateIndex
CREATE INDEX "addons_ownerId_idx" ON "addons"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "open_matches_bookingId_key" ON "open_matches"("bookingId");

-- CreateIndex
CREATE INDEX "open_matches_ownerId_idx" ON "open_matches"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "open_match_join_requests_matchId_playerId_key" ON "open_match_join_requests"("matchId", "playerId");

-- CreateIndex
CREATE INDEX "tournaments_ownerId_idx" ON "tournaments"("ownerId");

-- CreateIndex
CREATE INDEX "tournaments_venueId_idx" ON "tournaments"("venueId");

-- CreateIndex
CREATE INDEX "offers_ownerId_idx" ON "offers"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "offers_ownerId_code_key" ON "offers"("ownerId", "code");

-- CreateIndex
CREATE INDEX "audit_logs_ownerId_idx" ON "audit_logs"("ownerId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_customers" ADD CONSTRAINT "owner_customers_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_customers" ADD CONSTRAINT "owner_customers_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_games" ADD CONSTRAINT "venue_games_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_games" ADD CONSTRAINT "venue_games_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "game_catalogue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_settings" ADD CONSTRAINT "venue_settings_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookable_units" ADD CONSTRAINT "bookable_units_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookable_units" ADD CONSTRAINT "bookable_units_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "game_catalogue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "bookable_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "bookable_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_packId_fkey" FOREIGN KEY ("packId") REFERENCES "membership_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_addons" ADD CONSTRAINT "booking_addons_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_addons" ADD CONSTRAINT "booking_addons_addonId_fkey" FOREIGN KEY ("addonId") REFERENCES "addons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_packs" ADD CONSTRAINT "membership_packs_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_txns" ADD CONSTRAINT "ledger_txns_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_txns" ADD CONSTRAINT "ledger_txns_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_refereeId_fkey" FOREIGN KEY ("refereeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addons" ADD CONSTRAINT "addons_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_matches" ADD CONSTRAINT "open_matches_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_matches" ADD CONSTRAINT "open_matches_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_match_join_requests" ADD CONSTRAINT "open_match_join_requests_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "open_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_match_join_requests" ADD CONSTRAINT "open_match_join_requests_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
