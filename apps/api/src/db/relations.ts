import { relations } from "drizzle-orm/relations";
import { openMatches, openMatchJoinRequests, users, owners, tournaments, tournamentParticipants, ownerCustomers, playerProfiles, venues, bookableUnits, gameCatalogue, pricingRules, slots, bookings, venueSettings, bookingAddons, addons, membershipPacks, offers, ledgerTxns, referrals, auditLogs, venueGames, notifications } from "./schema";

export const openMatchJoinRequestsRelations = relations(openMatchJoinRequests, ({one}) => ({
	openMatch: one(openMatches, {
		fields: [openMatchJoinRequests.matchId],
		references: [openMatches.id]
	}),
	user: one(users, {
		fields: [openMatchJoinRequests.playerId],
		references: [users.id]
	}),
}));

export const openMatchesRelations = relations(openMatches, ({one, many}) => ({
	openMatchJoinRequests: many(openMatchJoinRequests),
	booking: one(bookings, {
		fields: [openMatches.bookingId],
		references: [bookings.id]
	}),
	user: one(users, {
		fields: [openMatches.hostId],
		references: [users.id]
	}),
	owner: one(owners, {
		fields: [openMatches.ownerId],
		references: [owners.id]
	}),
}));

export const usersRelations = relations(users, ({one, many}) => ({
	openMatchJoinRequests: many(openMatchJoinRequests),
	owner: one(owners, {
		fields: [users.ownerId],
		references: [owners.id]
	}),
	ownerCustomers: many(ownerCustomers),
	playerProfiles: many(playerProfiles),
	bookings: many(bookings),
	ledgerTxns: many(ledgerTxns),
	referrals_referrerId: many(referrals, {
		relationName: "referrals_referrerId_users_id"
	}),
	referrals_refereeId: many(referrals, {
		relationName: "referrals_refereeId_users_id"
	}),
	openMatches: many(openMatches),
}));

export const ownersRelations = relations(owners, ({many}) => ({
	users: many(users),
	ownerCustomers: many(ownerCustomers),
	playerProfiles: many(playerProfiles),
	venues: many(venues),
	bookableUnits: many(bookableUnits),
	pricingRules: many(pricingRules),
	slots: many(slots),
	bookings: many(bookings),
	membershipPacks: many(membershipPacks),
	ledgerTxns: many(ledgerTxns),
	referrals: many(referrals),
	openMatches: many(openMatches),
	tournaments: many(tournaments),
	offers: many(offers),
	auditLogs: many(auditLogs),
	notifications: many(notifications),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	owner: one(owners, {
		fields: [notifications.ownerId],
		references: [owners.id]
	}),
}));

export const tournamentParticipantsRelations = relations(tournamentParticipants, ({one}) => ({
	tournament: one(tournaments, {
		fields: [tournamentParticipants.tournamentId],
		references: [tournaments.id]
	}),
}));

export const tournamentsRelations = relations(tournaments, ({one, many}) => ({
	tournamentParticipants: many(tournamentParticipants),
	gameCatalogue: one(gameCatalogue, {
		fields: [tournaments.gameId],
		references: [gameCatalogue.id]
	}),
	owner: one(owners, {
		fields: [tournaments.ownerId],
		references: [owners.id]
	}),
	venue: one(venues, {
		fields: [tournaments.venueId],
		references: [venues.id]
	}),
}));

export const ownerCustomersRelations = relations(ownerCustomers, ({one}) => ({
	owner: one(owners, {
		fields: [ownerCustomers.ownerId],
		references: [owners.id]
	}),
	user: one(users, {
		fields: [ownerCustomers.customerId],
		references: [users.id]
	}),
}));

export const playerProfilesRelations = relations(playerProfiles, ({one}) => ({
	user: one(users, {
		fields: [playerProfiles.customerId],
		references: [users.id]
	}),
	owner: one(owners, {
		fields: [playerProfiles.ownerId],
		references: [owners.id]
	}),
}));

export const venuesRelations = relations(venues, ({one, many}) => ({
	owner: one(owners, {
		fields: [venues.ownerId],
		references: [owners.id]
	}),
	bookableUnits: many(bookableUnits),
	venueSettings: many(venueSettings),
	bookings: many(bookings),
	addons: many(addons),
	tournaments: many(tournaments),
	venueGames: many(venueGames),
}));

export const bookableUnitsRelations = relations(bookableUnits, ({one, many}) => ({
	venue: one(venues, {
		fields: [bookableUnits.venueId],
		references: [venues.id]
	}),
	gameCatalogue: one(gameCatalogue, {
		fields: [bookableUnits.gameId],
		references: [gameCatalogue.id]
	}),
	owner: one(owners, {
		fields: [bookableUnits.ownerId],
		references: [owners.id]
	}),
	pricingRules: many(pricingRules),
	slots: many(slots),
}));

export const gameCatalogueRelations = relations(gameCatalogue, ({many}) => ({
	bookableUnits: many(bookableUnits),
	tournaments: many(tournaments),
	venueGames: many(venueGames),
}));

export const pricingRulesRelations = relations(pricingRules, ({one}) => ({
	bookableUnit: one(bookableUnits, {
		fields: [pricingRules.unitId],
		references: [bookableUnits.id]
	}),
	owner: one(owners, {
		fields: [pricingRules.ownerId],
		references: [owners.id]
	}),
}));

export const slotsRelations = relations(slots, ({one}) => ({
	bookableUnit: one(bookableUnits, {
		fields: [slots.unitId],
		references: [bookableUnits.id]
	}),
	owner: one(owners, {
		fields: [slots.ownerId],
		references: [owners.id]
	}),
	booking: one(bookings, {
		fields: [slots.bookingId],
		references: [bookings.id]
	}),
}));

export const bookingsRelations = relations(bookings, ({one, many}) => ({
	slots: many(slots),
	bookingAddons: many(bookingAddons),
	membershipPack: one(membershipPacks, {
		fields: [bookings.packId],
		references: [membershipPacks.id]
	}),
	offer: one(offers, {
		fields: [bookings.offerId],
		references: [offers.id]
	}),
	user: one(users, {
		fields: [bookings.customerId],
		references: [users.id]
	}),
	venue: one(venues, {
		fields: [bookings.venueId],
		references: [venues.id]
	}),
	owner: one(owners, {
		fields: [bookings.ownerId],
		references: [owners.id]
	}),
	openMatches: many(openMatches),
}));

export const venueSettingsRelations = relations(venueSettings, ({one}) => ({
	venue: one(venues, {
		fields: [venueSettings.venueId],
		references: [venues.id]
	}),
}));

export const bookingAddonsRelations = relations(bookingAddons, ({one}) => ({
	booking: one(bookings, {
		fields: [bookingAddons.bookingId],
		references: [bookings.id]
	}),
	addon: one(addons, {
		fields: [bookingAddons.addonId],
		references: [addons.id]
	}),
}));

export const addonsRelations = relations(addons, ({one, many}) => ({
	bookingAddons: many(bookingAddons),
	venue: one(venues, {
		fields: [addons.venueId],
		references: [venues.id]
	}),
}));

export const membershipPacksRelations = relations(membershipPacks, ({one, many}) => ({
	bookings: many(bookings),
	owner: one(owners, {
		fields: [membershipPacks.ownerId],
		references: [owners.id]
	}),
}));

export const offersRelations = relations(offers, ({one, many}) => ({
	bookings: many(bookings),
	owner: one(owners, {
		fields: [offers.ownerId],
		references: [owners.id]
	}),
}));

export const ledgerTxnsRelations = relations(ledgerTxns, ({one}) => ({
	owner: one(owners, {
		fields: [ledgerTxns.ownerId],
		references: [owners.id]
	}),
	user: one(users, {
		fields: [ledgerTxns.customerId],
		references: [users.id]
	}),
}));

export const referralsRelations = relations(referrals, ({one}) => ({
	owner: one(owners, {
		fields: [referrals.ownerId],
		references: [owners.id]
	}),
	user_referrerId: one(users, {
		fields: [referrals.referrerId],
		references: [users.id],
		relationName: "referrals_referrerId_users_id"
	}),
	user_refereeId: one(users, {
		fields: [referrals.refereeId],
		references: [users.id],
		relationName: "referrals_refereeId_users_id"
	}),
}));

export const auditLogsRelations = relations(auditLogs, ({one}) => ({
	owner: one(owners, {
		fields: [auditLogs.ownerId],
		references: [owners.id]
	}),
}));

export const venueGamesRelations = relations(venueGames, ({one}) => ({
	venue: one(venues, {
		fields: [venueGames.venueId],
		references: [venues.id]
	}),
	gameCatalogue: one(gameCatalogue, {
		fields: [venueGames.gameId],
		references: [gameCatalogue.id]
	}),
}));