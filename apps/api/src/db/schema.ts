import { pgTable, timestamp, text, integer, uniqueIndex, pgPolicy, numeric, foreignKey, index, boolean, doublePrecision, date, jsonb, primaryKey, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const addonType = pgEnum("AddonType", ['rental', 'cafe', 'coaching'])
export const bookingStatus = pgEnum("BookingStatus", ['confirmed', 'cancelled', 'completed', 'no_show'])
export const dayType = pgEnum("DayType", ['weekday', 'weekend'])
export const feeBasis = pgEnum("FeeBasis", ['per_player', 'per_team'])
export const joinRequestStatus = pgEnum("JoinRequestStatus", ['requested', 'approved', 'rejected'])
export const ledgerTxnType = pgEnum("LedgerTxnType", ['pack_buy', 'pack_debit', 'pack_refund', 'points_earn', 'points_redeem', 'referral_reward', 'no_show_fee', 'cash_refund', 'open_match_settle'])
export const offerType = pgEnum("OfferType", ['percent', 'flat'])
export const openMatchRepaymentMode = pgEnum("OpenMatchRepaymentMode", ['info', 'ledger'])
export const openMatchStatus = pgEnum("OpenMatchStatus", ['open', 'full', 'cancelled', 'completed'])
export const ownerStatus = pgEnum("OwnerStatus", ['active', 'suspended', 'pending'])
export const packExpiryMode = pgEnum("PackExpiryMode", ['forfeit', 'rollover', 'none'])
export const packPricingMode = pgEnum("PackPricingMode", ['flat', 'discount'])
export const payMode = pgEnum("PayMode", ['prepay', 'at_venue'])
export const paymentStatus = pgEnum("PaymentStatus", ['pending', 'paid', 'awaiting_venue_settlement', 'settled_at_venue', 'refunded', 'failed'])
export const referralStatus = pgEnum("ReferralStatus", ['pending', 'rewarded', 'expired'])
export const registrationType = pgEnum("RegistrationType", ['solo', 'team'])
export const skillLevel = pgEnum("SkillLevel", ['beginner', 'advanced_beginner', 'advanced', 'pro'])
export const slotStatus = pgEnum("SlotStatus", ['open', 'booked', 'blocked'])
export const timeBand = pgEnum("TimeBand", ['morning', 'afternoon', 'evening'])
export const tournamentFormat = pgEnum("TournamentFormat", ['knockout', 'league', 'round_robin'])
export const unitLabel = pgEnum("UnitLabel", ['court', 'turf', 'lane', 'net'])
export const userRole = pgEnum("UserRole", ['super_admin', 'owner', 'staff', 'customer'])


export const gameCatalogue = pgTable("game_catalogue", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	iconUrl: text(),
	slotGranularityMin: integer().default(60).notNull(),
	unitLabel: unitLabel().default('court').notNull(),
	minPlayers: integer().default(2).notNull(),
	maxPlayers: integer().default(4).notNull(),
	defaultOpenTime: text().default('06:00').notNull(),
	defaultCloseTime: text().default('23:00').notNull(),
	createdAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	uniqueIndex("game_catalogue_name_key").using("btree", table.name.asc().nullsLast()),
]);

export const owners = pgTable("owners", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	contactEmail: text().notNull(),
	contactMobile: text(),
	status: ownerStatus().default('pending').notNull(),
	venueQuota: integer().default(1).notNull(),
	allowedGameIds: text().array().default(["RAY"]),
	featureFlags: text().array().default(["RAY"]),
	logoUrl: text(),
	primaryColor: text().default('#0EA5E9').notNull(),
	secondaryColor: text().default('#0F172A').notNull(),
	accentColor: text().default('#22C55E').notNull(),
	setupFee: numeric({ precision: 12, scale:  2 }),
	amcAmount: numeric({ precision: 12, scale:  2 }),
	amcRenewalDate: timestamp({ precision: 3, mode: 'date' }),
	loyaltyEarnRate: numeric({ precision: 6, scale:  4 }).default('0.05').notNull(),
	loyaltyRedeemValue: numeric({ precision: 10, scale:  2 }).default('1').notNull(),
	referralReward: numeric({ precision: 10, scale:  2 }).default('100').notNull(),
	createdAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'date' }).notNull(),
}, (table) => [
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR (id = app_current_owner_id()))`, withCheck: sql`(app_bypass_rls() OR (id = app_current_owner_id()))`  }),
]);

export const openMatchJoinRequests = pgTable("open_match_join_requests", {
	id: text().primaryKey().notNull(),
	matchId: text().notNull(),
	playerId: text().notNull(),
	status: joinRequestStatus().default('requested').notNull(),
	createdAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	uniqueIndex("open_match_join_requests_matchId_playerId_key").using("btree", table.matchId.asc().nullsLast(), table.playerId.asc().nullsLast()),
	foreignKey({
			columns: [table.matchId],
			foreignColumns: [openMatches.id],
			name: "open_match_join_requests_matchId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.playerId],
			foreignColumns: [users.id],
			name: "open_match_join_requests_playerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM open_matches m
  WHERE ((m.id = open_match_join_requests."matchId") AND (m."ownerId" = app_current_owner_id())))))`, withCheck: sql`(app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM open_matches m
  WHERE ((m.id = open_match_join_requests."matchId") AND (m."ownerId" = app_current_owner_id())))))`  }),
]);

export const users = pgTable("users", {
	id: text().primaryKey().notNull(),
	role: userRole().notNull(),
	ownerId: text(),
	name: text().notNull(),
	email: text(),
	mobile: text(),
	passwordHash: text(),
	assignedVenueIds: text().array().default(["RAY"]),
	active: boolean().default(true).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	uniqueIndex("users_email_key").using("btree", table.email.asc().nullsLast()),
	uniqueIndex("users_mobile_key").using("btree", table.mobile.asc().nullsLast()),
	index("users_ownerId_idx").using("btree", table.ownerId.asc().nullsLast()),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [owners.id],
			name: "users_ownerId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR ("ownerId" IS NULL) OR ("ownerId" = app_current_owner_id()))`, withCheck: sql`(app_bypass_rls() OR ("ownerId" IS NULL) OR ("ownerId" = app_current_owner_id()))`  }),
]);

export const tournamentParticipants = pgTable("tournament_participants", {
	id: text().primaryKey().notNull(),
	tournamentId: text().notNull(),
	teamName: text(),
	captainName: text().notNull(),
	captainMobile: text().notNull(),
	paid: boolean().default(false).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	razorpayOrderId: text(),
	razorpayPaymentId: text(),
	idempotencyKey: text(),
}, (table) => [
	index("tournament_participants_tournamentId_idx").using("btree", table.tournamentId.asc().nullsLast()),
	foreignKey({
			columns: [table.tournamentId],
			foreignColumns: [tournaments.id],
			name: "tournament_participants_tournamentId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM tournaments t
  WHERE ((t.id = tournament_participants."tournamentId") AND (t."ownerId" = app_current_owner_id())))))`, withCheck: sql`(app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM tournaments t
  WHERE ((t.id = tournament_participants."tournamentId") AND (t."ownerId" = app_current_owner_id())))))`  }),
]);

export const ownerCustomers = pgTable("owner_customers", {
	id: text().primaryKey().notNull(),
	ownerId: text().notNull(),
	customerId: text().notNull(),
	firstSeenAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	lastVisitAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	bookingCount: integer().default(0).notNull(),
	consent: boolean().default(false).notNull(),
	optedOut: boolean().default(false).notNull(),
}, (table) => [
	uniqueIndex("owner_customers_ownerId_customerId_key").using("btree", table.ownerId.asc().nullsLast(), table.customerId.asc().nullsLast()),
	index("owner_customers_ownerId_idx").using("btree", table.ownerId.asc().nullsLast()),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [owners.id],
			name: "owner_customers_ownerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [users.id],
			name: "owner_customers_customerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`, withCheck: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`  }),
]);

export const playerProfiles = pgTable("player_profiles", {
	id: text().primaryKey().notNull(),
	ownerId: text().notNull(),
	customerId: text().notNull(),
	name: text().notNull(),
	mobile: text().notNull(),
	games: text().array().default(["RAY"]),
	skillLevel: skillLevel().default('beginner').notNull(),
	consent: boolean().default(false).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	uniqueIndex("player_profiles_ownerId_customerId_key").using("btree", table.ownerId.asc().nullsLast(), table.customerId.asc().nullsLast()),
	index("player_profiles_ownerId_idx").using("btree", table.ownerId.asc().nullsLast()),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [users.id],
			name: "player_profiles_customerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [owners.id],
			name: "player_profiles_ownerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`, withCheck: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`  }),
]);

export const venues = pgTable("venues", {
	id: text().primaryKey().notNull(),
	ownerId: text().notNull(),
	name: text().notNull(),
	geoLat: doublePrecision(),
	geoLng: doublePrecision(),
	address: text(),
	city: text(),
	contactPhone: text(),
	photos: text().array().default(["RAY"]),
	openTime: text().default('06:00').notNull(),
	closeTime: text().default('23:00').notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("venues_city_idx").using("btree", table.city.asc().nullsLast()),
	index("venues_ownerId_idx").using("btree", table.ownerId.asc().nullsLast()),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [owners.id],
			name: "venues_ownerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`, withCheck: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`  }),
]);

export const bookableUnits = pgTable("bookable_units", {
	id: text().primaryKey().notNull(),
	venueId: text().notNull(),
	ownerId: text().notNull(),
	name: text().notNull(),
	label: unitLabel().default('court').notNull(),
	gameId: text().notNull(),
	capacity: integer().default(4).notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("bookable_units_ownerId_idx").using("btree", table.ownerId.asc().nullsLast()),
	index("bookable_units_venueId_idx").using("btree", table.venueId.asc().nullsLast()),
	foreignKey({
			columns: [table.venueId],
			foreignColumns: [venues.id],
			name: "bookable_units_venueId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [gameCatalogue.id],
			name: "bookable_units_gameId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [owners.id],
			name: "bookable_units_ownerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`, withCheck: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`  }),
]);

export const pricingRules = pgTable("pricing_rules", {
	id: text().primaryKey().notNull(),
	unitId: text().notNull(),
	ownerId: text().notNull(),
	dayType: dayType(),
	timeBand: timeBand(),
	dateOverride: date(),
	minDuration: integer(),
	price: numeric({ precision: 10, scale:  2 }).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("pricing_rules_ownerId_idx").using("btree", table.ownerId.asc().nullsLast()),
	index("pricing_rules_unitId_idx").using("btree", table.unitId.asc().nullsLast()),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [bookableUnits.id],
			name: "pricing_rules_unitId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [owners.id],
			name: "pricing_rules_ownerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`, withCheck: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`  }),
]);

export const slots = pgTable("slots", {
	id: text().primaryKey().notNull(),
	unitId: text().notNull(),
	ownerId: text().notNull(),
	startsAt: timestamp({ precision: 3, mode: 'date' }).notNull(),
	endsAt: timestamp({ precision: 3, mode: 'date' }).notNull(),
	status: slotStatus().default('booked').notNull(),
	blockReason: text(),
	bookingId: text(),
	createdAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("slots_bookingId_idx").using("btree", table.bookingId.asc().nullsLast()),
	index("slots_ownerId_idx").using("btree", table.ownerId.asc().nullsLast()),
	index("slots_unitId_startsAt_idx").using("btree", table.unitId.asc().nullsLast(), table.startsAt.asc().nullsLast()),
	uniqueIndex("slots_unitId_startsAt_key").using("btree", table.unitId.asc().nullsLast(), table.startsAt.asc().nullsLast()),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [bookableUnits.id],
			name: "slots_unitId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [owners.id],
			name: "slots_ownerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.bookingId],
			foreignColumns: [bookings.id],
			name: "slots_bookingId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`, withCheck: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`  }),
]);

export const venueSettings = pgTable("venue_settings", {
	venueId: text().primaryKey().notNull(),
	cancellationTemplate: text().default('flexible').notNull(),
	noShowFee: numeric({ precision: 10, scale:  2 }).default('0').notNull(),
	loyaltyEarnRate: numeric({ precision: 6, scale:  4 }),
	loyaltyRedeemValue: numeric({ precision: 10, scale:  2 }),
	openMatchRepaymentMode: openMatchRepaymentMode().default('info').notNull(),
}, (table) => [
	foreignKey({
			columns: [table.venueId],
			foreignColumns: [venues.id],
			name: "venue_settings_venueId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_settings."venueId") AND (v."ownerId" = app_current_owner_id())))))`, withCheck: sql`(app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_settings."venueId") AND (v."ownerId" = app_current_owner_id())))))`  }),
]);

export const bookingAddons = pgTable("booking_addons", {
	id: text().primaryKey().notNull(),
	bookingId: text().notNull(),
	addonId: text().notNull(),
	quantity: integer().default(1).notNull(),
	unitPrice: numeric({ precision: 10, scale:  2 }).notNull(),
}, (table) => [
	index("booking_addons_addonId_idx").using("btree", table.addonId.asc().nullsLast()),
	index("booking_addons_bookingId_idx").using("btree", table.bookingId.asc().nullsLast()),
	foreignKey({
			columns: [table.bookingId],
			foreignColumns: [bookings.id],
			name: "booking_addons_bookingId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.addonId],
			foreignColumns: [addons.id],
			name: "booking_addons_addonId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = booking_addons."bookingId") AND (b."ownerId" = app_current_owner_id())))))`, withCheck: sql`(app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = booking_addons."bookingId") AND (b."ownerId" = app_current_owner_id())))))`  }),
]);

export const bookings = pgTable("bookings", {
	id: text().primaryKey().notNull(),
	ownerId: text().notNull(),
	venueId: text().notNull(),
	customerId: text().notNull(),
	status: bookingStatus().default('confirmed').notNull(),
	payMode: payMode().notNull(),
	paymentStatus: paymentStatus().default('pending').notNull(),
	subtotal: numeric({ precision: 12, scale:  2 }).notNull(),
	discount: numeric({ precision: 12, scale:  2 }).default('0').notNull(),
	total: numeric({ precision: 12, scale:  2 }).notNull(),
	packId: text(),
	offerId: text(),
	pointsRedeemed: numeric({ precision: 12, scale:  2 }).default('0').notNull(),
	noShowFeeApplied: boolean().default(false).notNull(),
	seriesId: text(),
	razorpayOrderId: text(),
	razorpayPaymentId: text(),
	idempotencyKey: text(),
	createdAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("bookings_customerId_idx").using("btree", table.customerId.asc().nullsLast()),
	uniqueIndex("bookings_idempotencyKey_key").using("btree", table.idempotencyKey.asc().nullsLast()),
	index("bookings_offerId_idx").using("btree", table.offerId.asc().nullsLast()),
	index("bookings_ownerId_idx").using("btree", table.ownerId.asc().nullsLast()),
	index("bookings_packId_idx").using("btree", table.packId.asc().nullsLast()),
	index("bookings_seriesId_idx").using("btree", table.seriesId.asc().nullsLast()),
	index("bookings_venueId_idx").using("btree", table.venueId.asc().nullsLast()),
	foreignKey({
			columns: [table.packId],
			foreignColumns: [membershipPacks.id],
			name: "bookings_packId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.offerId],
			foreignColumns: [offers.id],
			name: "bookings_offerId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [users.id],
			name: "bookings_customerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.venueId],
			foreignColumns: [venues.id],
			name: "bookings_venueId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [owners.id],
			name: "bookings_ownerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`, withCheck: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`  }),
]);

export const membershipPacks = pgTable("membership_packs", {
	id: text().primaryKey().notNull(),
	ownerId: text().notNull(),
	name: text().notNull(),
	sessions: integer().notNull(),
	price: numeric({ precision: 10, scale:  2 }).notNull(),
	validityDays: integer(),
	expiryMode: packExpiryMode().default('forfeit').notNull(),
	pricingMode: packPricingMode().default('flat').notNull(),
	discountPct: numeric({ precision: 5, scale:  2 }),
	flatRate: numeric({ precision: 10, scale:  2 }),
	venueIds: text().array().default(["RAY"]),
	unitIds: text().array().default(["RAY"]),
	active: boolean().default(true).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("membership_packs_ownerId_idx").using("btree", table.ownerId.asc().nullsLast()),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [owners.id],
			name: "membership_packs_ownerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`, withCheck: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`  }),
]);

export const ledgerTxns = pgTable("ledger_txns", {
	id: text().primaryKey().notNull(),
	ownerId: text().notNull(),
	customerId: text().notNull(),
	type: ledgerTxnType().notNull(),
	amount: numeric({ precision: 12, scale:  2 }).notNull(),
	balanceAfter: numeric({ precision: 12, scale:  2 }).notNull(),
	lane: text().notNull(),
	refType: text(),
	refId: text(),
	note: text(),
	createdAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("ledger_txns_customerId_lane_idx").using("btree", table.customerId.asc().nullsLast(), table.lane.asc().nullsLast()),
	index("ledger_txns_ownerId_idx").using("btree", table.ownerId.asc().nullsLast()),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [owners.id],
			name: "ledger_txns_ownerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [users.id],
			name: "ledger_txns_customerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`, withCheck: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`  }),
]);

export const referrals = pgTable("referrals", {
	id: text().primaryKey().notNull(),
	ownerId: text().notNull(),
	referrerId: text().notNull(),
	refereeId: text(),
	code: text().notNull(),
	status: referralStatus().default('pending').notNull(),
	rewardReleasedOnFirstPaid: boolean().default(false).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	uniqueIndex("referrals_ownerId_code_key").using("btree", table.ownerId.asc().nullsLast(), table.code.asc().nullsLast()),
	index("referrals_ownerId_idx").using("btree", table.ownerId.asc().nullsLast()),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [owners.id],
			name: "referrals_ownerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.referrerId],
			foreignColumns: [users.id],
			name: "referrals_referrerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.refereeId],
			foreignColumns: [users.id],
			name: "referrals_refereeId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`, withCheck: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`  }),
]);

export const addons = pgTable("addons", {
	id: text().primaryKey().notNull(),
	ownerId: text().notNull(),
	venueId: text().notNull(),
	name: text().notNull(),
	type: addonType().notNull(),
	price: numeric({ precision: 10, scale:  2 }).notNull(),
	stock: integer(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("addons_ownerId_idx").using("btree", table.ownerId.asc().nullsLast()),
	index("addons_venueId_idx").using("btree", table.venueId.asc().nullsLast()),
	foreignKey({
			columns: [table.venueId],
			foreignColumns: [venues.id],
			name: "addons_venueId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`, withCheck: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`  }),
]);

export const openMatches = pgTable("open_matches", {
	id: text().primaryKey().notNull(),
	ownerId: text().notNull(),
	bookingId: text().notNull(),
	hostId: text().notNull(),
	openSpots: integer().notNull(),
	skillMin: skillLevel().default('beginner').notNull(),
	skillMax: skillLevel().default('pro').notNull(),
	repaymentMode: openMatchRepaymentMode().default('info').notNull(),
	status: openMatchStatus().default('open').notNull(),
	createdAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	uniqueIndex("open_matches_bookingId_key").using("btree", table.bookingId.asc().nullsLast()),
	index("open_matches_ownerId_idx").using("btree", table.ownerId.asc().nullsLast()),
	foreignKey({
			columns: [table.bookingId],
			foreignColumns: [bookings.id],
			name: "open_matches_bookingId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.hostId],
			foreignColumns: [users.id],
			name: "open_matches_hostId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [owners.id],
			name: "open_matches_ownerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`, withCheck: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`  }),
]);

export const tournaments = pgTable("tournaments", {
	id: text().primaryKey().notNull(),
	ownerId: text().notNull(),
	venueId: text().notNull(),
	name: text().notNull(),
	gameId: text().notNull(),
	format: tournamentFormat().notNull(),
	startDate: date().notNull(),
	endDate: date().notNull(),
	capacity: integer().notNull(),
	regType: registrationType().notNull(),
	feeBasis: feeBasis().notNull(),
	fee: numeric({ precision: 10, scale:  2 }).notNull(),
	regCloseAt: timestamp({ precision: 3, mode: 'date' }),
	refundAllowedAfterClose: boolean().default(false).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("tournaments_ownerId_idx").using("btree", table.ownerId.asc().nullsLast()),
	index("tournaments_venueId_idx").using("btree", table.venueId.asc().nullsLast()),
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [gameCatalogue.id],
			name: "tournaments_gameId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [owners.id],
			name: "tournaments_ownerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.venueId],
			foreignColumns: [venues.id],
			name: "tournaments_venueId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`, withCheck: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`  }),
]);

export const offers = pgTable("offers", {
	id: text().primaryKey().notNull(),
	ownerId: text().notNull(),
	name: text().notNull(),
	type: offerType().notNull(),
	value: numeric({ precision: 10, scale:  2 }).notNull(),
	code: text(),
	autoApply: boolean().default(false).notNull(),
	validFrom: timestamp({ precision: 3, mode: 'date' }),
	validTo: timestamp({ precision: 3, mode: 'date' }),
	venueIds: text().array().default(["RAY"]),
	gameIds: text().array().default(["RAY"]),
	segment: text(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	uniqueIndex("offers_ownerId_code_key").using("btree", table.ownerId.asc().nullsLast(), table.code.asc().nullsLast()),
	index("offers_ownerId_idx").using("btree", table.ownerId.asc().nullsLast()),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [owners.id],
			name: "offers_ownerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`, withCheck: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`  }),
]);

export const auditLogs = pgTable("audit_logs", {
	id: text().primaryKey().notNull(),
	ownerId: text(),
	actorId: text().notNull(),
	actorRole: userRole().notNull(),
	action: text().notNull(),
	entity: text().notNull(),
	entityId: text(),
	metadata: jsonb(),
	createdAt: timestamp({ precision: 3, mode: 'date' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("audit_logs_ownerId_idx").using("btree", table.ownerId.asc().nullsLast()),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [owners.id],
			name: "audit_logs_ownerId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`, withCheck: sql`(app_bypass_rls() OR ("ownerId" = app_current_owner_id()))`  }),
]);

export const venueGames = pgTable("venue_games", {
	venueId: text().notNull(),
	gameId: text().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.venueId],
			foreignColumns: [venues.id],
			name: "venue_games_venueId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [gameCatalogue.id],
			name: "venue_games_gameId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	primaryKey({ columns: [table.venueId, table.gameId], name: "venue_games_pkey"}),
	pgPolicy("tenant_isolation", { as: "permissive", for: "all", to: ["public"], using: sql`(app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_games."venueId") AND (v."ownerId" = app_current_owner_id())))))`, withCheck: sql`(app_bypass_rls() OR (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_games."venueId") AND (v."ownerId" = app_current_owner_id())))))`  }),
]);
