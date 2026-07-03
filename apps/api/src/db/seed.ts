import 'dotenv/config';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schemaTables from './schema';
import * as schemaRelations from './relations';
import { type DbTx } from './index';
import { dec, money } from './money';

// The seed is an ADMIN/setup task (clears + repopulates every table), so it
// connects as the admin role (DATABASE_ADMIN_URL). RLS is FORCEd, so even the
// table owner is subject to it — the seed sets app.bypass_rls='on' at the top of
// its transaction (see seed()) so WITH CHECK policies never block the inserts.
// Never uses the restricted runtime DATABASE_URL role.
const pool = new Pool({
  connectionString: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL,
});
const db = drizzle(pool, { schema: { ...schemaTables, ...schemaRelations } });
import {
  addons,
  auditLogs,
  bookableUnits,
  bookingAddons,
  bookings,
  gameCatalogue,
  ledgerTxns,
  membershipPacks,
  notifications,
  openMatches,
  openMatchJoinRequests,
  ownerCustomers,
  owners,
  offers,
  playerProfiles,
  pricingRules,
  referrals,
  slots,
  tournaments,
  tournamentParticipants,
  users,
  venueGames,
  venues,
  venueSettings,
} from './schema';

/**
 * Dev seed: a complete, internally-consistent demo dataset that exercises every
 * table and every customer/owner/admin flow in the app. Run after migrations:
 *   pnpm --filter @sportsbooking/api db:seed
 *
 * Idempotent: wipes all rows (FK-safe order) then recreates a known state, so it
 * is safe to re-run. Runs inside one transaction with RLS bypassed (mirrors
 * DbService.withTenantBypass) so cross-tenant seeding is not obstructed.
 *
 * Demo logins:
 *   - Super admin:  admin@sportsbooking.local / admin12345
 *   - Owner:        owner@smasharena.local    / owner12345
 *   - Staff:        staff@smasharena.local     / owner12345
 *   - Customers:    any seeded mobile + OTP 123456 (e.g. +919800000001)
 */

type LedgerTxnTypeT =
  | 'pack_buy'
  | 'pack_debit'
  | 'pack_refund'
  | 'points_earn'
  | 'points_redeem'
  | 'referral_reward'
  | 'no_show_fee'
  | 'cash_refund'
  | 'open_match_settle';
type BookingStatusT = 'confirmed' | 'cancelled' | 'completed' | 'no_show';
type PayModeT = 'prepay' | 'at_venue';
type PaymentStatusT =
  | 'pending'
  | 'paid'
  | 'awaiting_venue_settlement'
  | 'settled_at_venue'
  | 'refunded'
  | 'failed';
type UnitLabelT = 'court' | 'turf' | 'lane' | 'net';

async function seed(tx: DbTx) {
  // bypass RLS so cross-tenant seeding is not obstructed (non-superuser safe).
  await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);

  // ---- reset (children -> parents) so the seed is re-runnable ------------
  await tx.delete(auditLogs);
  await tx.delete(notifications);
  await tx.delete(openMatchJoinRequests);
  await tx.delete(openMatches);
  await tx.delete(tournamentParticipants);
  await tx.delete(tournaments);
  await tx.delete(bookingAddons);
  await tx.delete(slots);
  await tx.delete(bookings);
  await tx.delete(ledgerTxns);
  await tx.delete(referrals);
  await tx.delete(playerProfiles);
  await tx.delete(ownerCustomers);
  await tx.delete(addons);
  await tx.delete(pricingRules);
  await tx.delete(membershipPacks);
  await tx.delete(bookableUnits);
  await tx.delete(venueSettings);
  await tx.delete(venueGames);
  await tx.delete(offers);
  await tx.delete(venues);
  await tx.delete(users);
  await tx.delete(owners);
  await tx.delete(gameCatalogue);

  // ---- helpers ----------------------------------------------------------
  const DAY = 24 * 60 * 60 * 1000;
  // monotonic clock for createdAt ordering (ledger "latest per lane" relies on it)
  let clock = Date.now() - 60 * DAY;
  const tick = () => new Date((clock += 5 * 60 * 1000));
  const playAt = (offsetDays: number, hour: number) => {
    const d = new Date(Date.now() + offsetDays * DAY);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
  // tournaments.startDate/endDate are `date` columns (string mode in Drizzle).
  const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

  const ownerPass = await bcrypt.hash('owner12345', 10);
  const adminPass = await bcrypt.hash('admin12345', 10);

  // running ledger balances, keyed `${customerId}|${lane}`
  const balances = new Map<string, number>();
  async function post(
    ownerId: string,
    customerId: string,
    type: LedgerTxnTypeT,
    lane: string,
    amount: number,
    note: string,
    ref?: { refType: string; refId: string },
  ) {
    const key = `${customerId}|${lane}`;
    const balanceAfter = (balances.get(key) ?? 0) + amount;
    balances.set(key, balanceAfter);
    await tx.insert(ledgerTxns).values({
      id: randomUUID(),
      ownerId,
      customerId,
      type,
      lane,
      amount: money(dec(amount)),
      balanceAfter: money(dec(balanceAfter)),
      note,
      refType: ref?.refType ?? null,
      refId: ref?.refId ?? null,
      createdAt: tick(),
    });
  }

  async function makeUnit(
    venueId: string,
    ownerId: string,
    name: string,
    label: UnitLabelT,
    gameId: string,
    capacity: number,
    prices: {
      base: number;
      weekend: number;
      evening: number;
      weekendEvening: number;
    },
  ) {
    const unitId = randomUUID();
    await tx.insert(bookableUnits).values({
      id: unitId,
      venueId,
      ownerId,
      name,
      label,
      gameId,
      capacity,
    });
    await tx.insert(pricingRules).values([
      { id: randomUUID(), unitId, ownerId, price: money(dec(prices.base)) },
      {
        id: randomUUID(),
        unitId,
        ownerId,
        dayType: 'weekend',
        price: money(dec(prices.weekend)),
      },
      {
        id: randomUUID(),
        unitId,
        ownerId,
        timeBand: 'evening',
        price: money(dec(prices.evening)),
      },
      {
        id: randomUUID(),
        unitId,
        ownerId,
        dayType: 'weekend',
        timeBand: 'evening',
        price: money(dec(prices.weekendEvening)),
      },
    ]);
    return { id: unitId };
  }

  async function makeBooking(opts: {
    ownerId: string;
    venueId: string;
    unitId: string;
    customerId: string;
    start: Date;
    status: BookingStatusT;
    payMode: PayModeT;
    paymentStatus: PaymentStatusT;
    subtotal: number;
    total: number;
    discount?: number;
    pointsRedeemed?: number;
    packId?: string;
    offerId?: string;
    noShowFeeApplied?: boolean;
    addon?: { addonId: string; quantity: number; unitPrice: number };
  }): Promise<string> {
    const end = new Date(opts.start.getTime() + 60 * 60 * 1000);
    const bookingId = randomUUID();
    await tx.insert(bookings).values({
      id: bookingId,
      ownerId: opts.ownerId,
      venueId: opts.venueId,
      customerId: opts.customerId,
      status: opts.status,
      payMode: opts.payMode,
      paymentStatus: opts.paymentStatus,
      subtotal: money(dec(opts.subtotal)),
      discount: money(dec(opts.discount ?? 0)),
      total: money(dec(opts.total)),
      pointsRedeemed: money(dec(opts.pointsRedeemed ?? 0)),
      packId: opts.packId ?? null,
      offerId: opts.offerId ?? null,
      noShowFeeApplied: opts.noShowFeeApplied ?? false,
      createdAt: tick(),
    });
    await tx.insert(slots).values({
      id: randomUUID(),
      unitId: opts.unitId,
      ownerId: opts.ownerId,
      startsAt: opts.start,
      endsAt: end,
      status: 'booked',
      bookingId,
    });
    if (opts.addon) {
      await tx.insert(bookingAddons).values({
        id: randomUUID(),
        bookingId,
        addonId: opts.addon.addonId,
        quantity: opts.addon.quantity,
        unitPrice: money(dec(opts.addon.unitPrice)),
      });
    }
    return bookingId;
  }

  // ---- super admin ------------------------------------------------------
  const superAdminId = randomUUID();
  await tx.insert(users).values({
    id: superAdminId,
    role: 'super_admin',
    name: 'Super Admin',
    email: 'admin@sportsbooking.local',
    passwordHash: adminPass,
  });

  // ---- game catalogue (PRD §3.1) ---------------------------------------
  const pickleballId = randomUUID();
  const badmintonId = randomUUID();
  const footballId = randomUUID();
  const boxCricketId = randomUUID();
  await tx.insert(gameCatalogue).values([
    {
      id: pickleballId,
      name: 'Pickleball',
      iconUrl: '/images/sports/pickleball.svg',
      slotGranularityMin: 60,
      unitLabel: 'court',
      minPlayers: 2,
      maxPlayers: 4,
    },
    {
      id: badmintonId,
      name: 'Badminton',
      iconUrl: '/images/sports/badminton.svg',
      slotGranularityMin: 60,
      unitLabel: 'court',
      minPlayers: 2,
      maxPlayers: 4,
    },
    {
      id: footballId,
      name: 'Turf Football',
      iconUrl: '/images/sports/football.svg',
      slotGranularityMin: 60,
      unitLabel: 'turf',
      minPlayers: 10,
      maxPlayers: 14,
    },
    {
      id: boxCricketId,
      name: 'Box Cricket',
      iconUrl: '/images/sports/cricket.svg',
      slotGranularityMin: 60,
      unitLabel: 'turf',
      minPlayers: 6,
      maxPlayers: 12,
    },
  ]);

  // ---- primary tenant: Smash Arena -------------------------------------
  const ownerId = randomUUID();
  await tx.insert(owners).values({
    id: ownerId,
    name: 'Smash Arena',
    logoUrl: '/images/owner-emblem.svg',
    contactEmail: 'owner@smasharena.local',
    contactMobile: '+919900000001',
    status: 'active',
    venueQuota: 5,
    allowedGameIds: [pickleballId, badmintonId, footballId, boxCricketId],
    featureFlags: [
      'memberships',
      'loyalty',
      'open_matches',
      'addons',
      'tournaments',
    ],
    primaryColor: '#7C3AED',
    setupFee: money(dec(25000)),
    amcAmount: money(dec(12000)),
    amcRenewalDate: new Date(Date.now() + 200 * DAY),
    updatedAt: new Date(),
  });
  const ownerAdminId = randomUUID();
  await tx.insert(users).values({
    id: ownerAdminId,
    role: 'owner',
    ownerId,
    name: 'Smash Arena Admin',
    email: 'owner@smasharena.local',
    passwordHash: ownerPass,
  });

  // venues + settings + games
  const v1Id = randomUUID();
  await tx.insert(venues).values({
    id: v1Id,
    ownerId,
    name: 'Smash Arena — Indiranagar',
    photos: ['/images/venues/pickleball.jpg', '/images/venues/badminton.jpg'],
    city: 'Bengaluru',
    address: '100ft Road, Indiranagar',
    geoLat: 12.9719,
    geoLng: 77.6412,
    contactPhone: '+919900000010',
    openTime: '06:00',
    closeTime: '23:00',
  });
  await tx.insert(venueGames).values([
    { venueId: v1Id, gameId: pickleballId },
    { venueId: v1Id, gameId: badmintonId },
  ]);
  await tx.insert(venueSettings).values({
    venueId: v1Id,
    cancellationTemplate: 'moderate',
    noShowFee: money(dec(200)),
    openMatchRepaymentMode: 'info',
  });

  const v2Id = randomUUID();
  await tx.insert(venues).values({
    id: v2Id,
    ownerId,
    name: 'Smash Arena — Koramangala',
    photos: [
      '/images/venues/turf-football.jpg',
      '/images/venues/box-cricket.jpg',
    ],
    city: 'Bengaluru',
    address: '80ft Road, Koramangala',
    geoLat: 12.9352,
    geoLng: 77.6245,
    contactPhone: '+919900000011',
    openTime: '06:00',
    closeTime: '23:00',
  });
  await tx.insert(venueGames).values([
    { venueId: v2Id, gameId: footballId },
    { venueId: v2Id, gameId: boxCricketId },
  ]);
  await tx.insert(venueSettings).values({
    venueId: v2Id,
    cancellationTemplate: 'strict',
    noShowFee: money(dec(500)),
    openMatchRepaymentMode: 'ledger',
  });

  const staffUserId = randomUUID();
  await tx.insert(users).values({
    id: staffUserId,
    role: 'staff',
    ownerId,
    name: 'Front Desk — Indiranagar',
    email: 'staff@smasharena.local',
    passwordHash: ownerPass,
    assignedVenueIds: [v1Id],
  });

  // bookable units + pricing
  const courtA = await makeUnit(v1Id, ownerId, 'Court A', 'court', pickleballId, 4, { base: 600, weekend: 800, evening: 900, weekendEvening: 1100 });
  const courtB = await makeUnit(v1Id, ownerId, 'Court B', 'court', pickleballId, 4, { base: 600, weekend: 800, evening: 900, weekendEvening: 1100 });
  const courtC = await makeUnit(v1Id, ownerId, 'Court C', 'court', badmintonId, 4, { base: 500, weekend: 650, evening: 700, weekendEvening: 850 });
  const turf1 = await makeUnit(v2Id, ownerId, 'Turf 1', 'turf', footballId, 14, { base: 900, weekend: 1100, evening: 1100, weekendEvening: 1400 });
  const pitch1 = await makeUnit(v2Id, ownerId, 'Pitch 1', 'turf', boxCricketId, 12, { base: 700, weekend: 900, evening: 900, weekendEvening: 1100 });

  // a blocked slot for maintenance (SlotStatus variety)
  await tx.insert(slots).values({
    id: randomUUID(),
    unitId: courtB.id,
    ownerId,
    startsAt: playAt(2, 12),
    endsAt: playAt(2, 13),
    status: 'blocked',
    blockReason: 'Court resurfacing',
  });

  // add-ons (PRD §4.6)
  const racquetRentalId = randomUUID();
  await tx.insert(addons).values({ id: racquetRentalId, ownerId, venueId: v1Id, name: 'Racquet Rental', type: 'rental', price: money(dec(100)), stock: 20 });
  await tx.insert(addons).values({ id: randomUUID(), ownerId, venueId: v1Id, name: 'Energy Drink', type: 'cafe', price: money(dec(60)), stock: 50 });
  await tx.insert(addons).values({ id: randomUUID(), ownerId, venueId: v1Id, name: 'Coaching Session', type: 'coaching', price: money(dec(500)), stock: null });
  const ballRentalId = randomUUID();
  await tx.insert(addons).values({ id: ballRentalId, ownerId, venueId: v2Id, name: 'Football Rental', type: 'rental', price: money(dec(80)), stock: 15 });
  await tx.insert(addons).values({ id: randomUUID(), ownerId, venueId: v2Id, name: 'Cold Drink', type: 'cafe', price: money(dec(40)), stock: 100 });

  // membership packs (PRD §4.4)
  const pack10Id = randomUUID();
  await tx.insert(membershipPacks).values({ id: pack10Id, ownerId, name: '10-Play Flat', sessions: 10, price: money(dec(5000)), pricingMode: 'flat', flatRate: money(dec(500)), expiryMode: 'none' });
  const packBadId = randomUUID();
  await tx.insert(membershipPacks).values({ id: packBadId, ownerId, name: '5-Play Badminton', sessions: 5, price: money(dec(2000)), pricingMode: 'discount', discountPct: money(dec(20)), validityDays: 90, expiryMode: 'forfeit', venueIds: [v1Id] });
  const packTurfId = randomUUID();
  await tx.insert(membershipPacks).values({ id: packTurfId, ownerId, name: 'Turf 8-Pack', sessions: 8, price: money(dec(6400)), pricingMode: 'flat', flatRate: money(dec(800)), validityDays: 120, expiryMode: 'rollover', venueIds: [v2Id] });

  // offers (PRD §4.8)
  const offerMorningId = randomUUID();
  await tx.insert(offers).values({ id: offerMorningId, ownerId, name: 'Weekday Morning 20% Off', type: 'percent', value: money(dec(20)), autoApply: true, segment: 'weekday_mornings', validFrom: daysAgo(30), validTo: new Date(Date.now() + 60 * DAY) });
  const offerFirst100Id = randomUUID();
  await tx.insert(offers).values({ id: offerFirst100Id, ownerId, name: 'First Booking ₹100 Off', type: 'flat', value: money(dec(100)), code: 'FIRST100', autoApply: false });
  await tx.insert(offers).values({ id: randomUUID(), ownerId, name: 'Win-back 15%', type: 'percent', value: money(dec(15)), code: 'COMEBACK15', segment: 'lapsed', validFrom: daysAgo(10), validTo: new Date(Date.now() + 30 * DAY) });
  // General coded offers any signed-in player can use (shown in the offers inbox).
  await tx.insert(offers).values({ id: randomUUID(), ownerId, name: 'Rally Week — 10% off', type: 'percent', value: money(dec(10)), code: 'RALLY10', autoApply: false });
  await tx.insert(offers).values({ id: randomUUID(), ownerId, name: '₹50 off your court', type: 'flat', value: money(dec(50)), code: 'SMASH50', autoApply: false });

  // ---- customers (global users) ----------------------------------------
  const mk = async (name: string, mobile: string) => {
    const id = randomUUID();
    await tx.insert(users).values({ id, role: 'customer', name, mobile });
    return { id, name, mobile };
  };
  const aarav = await mk('Aarav Sharma', '+919800000001');
  const diya = await mk('Diya Patel', '+919800000002');
  const rohan = await mk('Rohan Mehta', '+919800000003');
  const ananya = await mk('Ananya Iyer', '+919800000004');
  const kabir = await mk('Kabir Nair', '+919800000005');
  const ishaan = await mk('Ishaan Reddy', '+919800000006');
  const saanvi = await mk('Saanvi Gupta', '+919800000007');
  const vivaan = await mk('Vivaan Joshi', '+919800000008');

  // CRM links + per-owner player profiles (PRD §4.9, §5.1)
  const crm: Array<{
    user: { id: string; name: string; mobile: string | null };
    games: string[];
    skill: 'beginner' | 'advanced_beginner' | 'advanced' | 'pro';
    bookingCount: number;
    lastVisit: Date;
    consent: boolean;
    optedOut?: boolean;
  }> = [
    { user: aarav, games: [pickleballId, badmintonId], skill: 'advanced', bookingCount: 8, lastVisit: daysAgo(3), consent: true },
    { user: diya, games: [pickleballId], skill: 'beginner', bookingCount: 2, lastVisit: daysAgo(1), consent: true },
    { user: rohan, games: [footballId], skill: 'advanced_beginner', bookingCount: 6, lastVisit: daysAgo(7), consent: true },
    { user: ananya, games: [badmintonId, pickleballId], skill: 'pro', bookingCount: 12, lastVisit: daysAgo(2), consent: true },
    { user: kabir, games: [boxCricketId], skill: 'beginner', bookingCount: 1, lastVisit: daysAgo(75), consent: false },
    { user: ishaan, games: [footballId, boxCricketId], skill: 'advanced', bookingCount: 5, lastVisit: daysAgo(4), consent: true },
    { user: saanvi, games: [pickleballId], skill: 'advanced_beginner', bookingCount: 3, lastVisit: daysAgo(90), consent: true, optedOut: true },
    { user: vivaan, games: [badmintonId], skill: 'beginner', bookingCount: 1, lastVisit: daysAgo(1), consent: false },
  ];
  for (const c of crm) {
    await tx.insert(ownerCustomers).values({
      id: randomUUID(),
      ownerId,
      customerId: c.user.id,
      firstSeenAt: daysAgo(120),
      lastVisitAt: c.lastVisit,
      bookingCount: c.bookingCount,
      consent: c.consent,
      optedOut: c.optedOut ?? false,
    });
    await tx.insert(playerProfiles).values({
      id: randomUUID(),
      ownerId,
      customerId: c.user.id,
      name: c.user.name,
      mobile: c.user.mobile ?? '',
      games: c.games,
      skillLevel: c.skill,
      consent: c.consent,
    });
  }

  // ---- bookings (drives dashboard revenue/occupancy) -------------------
  const O = ownerId;
  await makeBooking({ ownerId: O, venueId: v1Id, unitId: courtA.id, customerId: aarav.id, start: playAt(-10, 18), status: 'completed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 900, total: 900 });
  await makeBooking({ ownerId: O, venueId: v1Id, unitId: courtA.id, customerId: aarav.id, start: playAt(-3, 19), status: 'completed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 900, discount: 100, total: 800, offerId: offerFirst100Id });
  await makeBooking({ ownerId: O, venueId: v1Id, unitId: courtC.id, customerId: diya.id, start: playAt(-5, 9), status: 'completed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 500, discount: 100, total: 400, offerId: offerMorningId });
  await makeBooking({ ownerId: O, venueId: v1Id, unitId: courtC.id, customerId: ananya.id, start: playAt(2, 20), status: 'confirmed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 700, pointsRedeemed: 45, total: 655, packId: packBadId });
  await makeBooking({ ownerId: O, venueId: v1Id, unitId: courtA.id, customerId: ananya.id, start: playAt(5, 18), status: 'confirmed', payMode: 'at_venue', paymentStatus: 'awaiting_venue_settlement', subtotal: 900, total: 900 });
  await makeBooking({ ownerId: O, venueId: v2Id, unitId: turf1.id, customerId: rohan.id, start: playAt(-7, 19), status: 'completed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 1100, total: 1100, addon: { addonId: ballRentalId, quantity: 1, unitPrice: 80 } });
  await makeBooking({ ownerId: O, venueId: v2Id, unitId: turf1.id, customerId: rohan.id, start: playAt(3, 20), status: 'confirmed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 1100, total: 1100, packId: packTurfId });
  await makeBooking({ ownerId: O, venueId: v2Id, unitId: pitch1.id, customerId: ishaan.id, start: playAt(-2, 18), status: 'completed', payMode: 'at_venue', paymentStatus: 'settled_at_venue', subtotal: 800, total: 800 });
  await makeBooking({ ownerId: O, venueId: v2Id, unitId: turf1.id, customerId: ishaan.id, start: playAt(6, 21), status: 'confirmed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 1100, total: 1100 });
  await makeBooking({ ownerId: O, venueId: v2Id, unitId: pitch1.id, customerId: kabir.id, start: playAt(-75, 17), status: 'completed', payMode: 'at_venue', paymentStatus: 'settled_at_venue', subtotal: 700, total: 700 });
  await makeBooking({ ownerId: O, venueId: v1Id, unitId: courtA.id, customerId: saanvi.id, start: playAt(-90, 10), status: 'completed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 500, total: 500 });
  await makeBooking({ ownerId: O, venueId: v1Id, unitId: courtC.id, customerId: vivaan.id, start: playAt(1, 8), status: 'confirmed', payMode: 'prepay', paymentStatus: 'pending', subtotal: 500, total: 500 });
  await makeBooking({ ownerId: O, venueId: v1Id, unitId: courtB.id, customerId: diya.id, start: playAt(-1, 19), status: 'cancelled', payMode: 'prepay', paymentStatus: 'refunded', subtotal: 900, total: 900 });
  await makeBooking({ ownerId: O, venueId: v1Id, unitId: courtB.id, customerId: aarav.id, start: playAt(-8, 7), status: 'no_show', payMode: 'prepay', paymentStatus: 'paid', subtotal: 500, total: 500, noShowFeeApplied: true });

  // two bookings that host open matches
  const omBooking1 = await makeBooking({ ownerId: O, venueId: v2Id, unitId: turf1.id, customerId: ananya.id, start: playAt(4, 18), status: 'confirmed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 1100, total: 1100 });
  const omBooking2 = await makeBooking({ ownerId: O, venueId: v1Id, unitId: courtC.id, customerId: rohan.id, start: playAt(7, 20), status: 'confirmed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 700, total: 700 });

  // ---- ledger / wallet (PRD §7) ----------------------------------------
  // Aarav: bought a pack, used two sessions, earned points, got a referral reward
  await post(O, aarav.id, 'pack_buy', `pack:${pack10Id}`, 10, 'Bought 10-Play Flat', { refType: 'pack', refId: pack10Id });
  await post(O, aarav.id, 'pack_debit', `pack:${pack10Id}`, -1, 'Used 1 session', { refType: 'booking', refId: omBooking1 });
  await post(O, aarav.id, 'pack_debit', `pack:${pack10Id}`, -1, 'Used 1 session');
  await post(O, aarav.id, 'points_earn', 'points', 45, 'Earned 45 pts on bookings');
  await post(O, aarav.id, 'referral_reward', 'credit', 100, 'Referral reward — Diya joined', { refType: 'referral', refId: 'AARAV50' });

  // Ananya: badminton pack, earned + redeemed points
  await post(O, ananya.id, 'pack_buy', `pack:${packBadId}`, 5, 'Bought 5-Play Badminton', { refType: 'pack', refId: packBadId });
  await post(O, ananya.id, 'pack_debit', `pack:${packBadId}`, -1, 'Used 1 session', { refType: 'booking', refId: omBooking2 });
  await post(O, ananya.id, 'points_earn', 'points', 90, 'Earned 90 pts on bookings');
  await post(O, ananya.id, 'points_redeem', 'points', -45, 'Redeemed 45 pts');

  // Rohan: turf pack + points + referral reward
  await post(O, rohan.id, 'pack_buy', `pack:${packTurfId}`, 8, 'Bought Turf 8-Pack', { refType: 'pack', refId: packTurfId });
  await post(O, rohan.id, 'pack_debit', `pack:${packTurfId}`, -1, 'Used 1 session');
  await post(O, rohan.id, 'points_earn', 'points', 55, 'Earned 55 pts on bookings');
  await post(O, rohan.id, 'referral_reward', 'credit', 100, 'Referral reward — Ishaan joined', { refType: 'referral', refId: 'ROHAN50' });

  // others: points only
  await post(O, ishaan.id, 'points_earn', 'points', 38, 'Earned 38 pts on bookings');
  await post(O, diya.id, 'points_earn', 'points', 12, 'Earned 12 pts on bookings');
  await post(O, kabir.id, 'points_earn', 'points', 14, 'Earned 14 pts on bookings');

  // ---- referrals (PRD §4.5) --------------------------------------------
  await tx.insert(referrals).values({ id: randomUUID(), ownerId: O, referrerId: aarav.id, refereeId: diya.id, code: 'AARAV50', status: 'rewarded', rewardReleasedOnFirstPaid: true });
  await tx.insert(referrals).values({ id: randomUUID(), ownerId: O, referrerId: ananya.id, code: 'ANANYA50', status: 'pending' });
  await tx.insert(referrals).values({ id: randomUUID(), ownerId: O, referrerId: rohan.id, refereeId: ishaan.id, code: 'ROHAN50', status: 'rewarded', rewardReleasedOnFirstPaid: true });

  // ---- open matches (PRD §5.3) -----------------------------------------
  const om1Id = randomUUID();
  await tx.insert(openMatches).values({ id: om1Id, ownerId: O, bookingId: omBooking1, hostId: ananya.id, openSpots: 2, skillMin: 'advanced_beginner', skillMax: 'pro', repaymentMode: 'info', status: 'open' });
  await tx.insert(openMatchJoinRequests).values({ id: randomUUID(), matchId: om1Id, playerId: rohan.id, status: 'approved' });
  await tx.insert(openMatchJoinRequests).values({ id: randomUUID(), matchId: om1Id, playerId: ishaan.id, status: 'requested' });

  const om2Id = randomUUID();
  await tx.insert(openMatches).values({ id: om2Id, ownerId: O, bookingId: omBooking2, hostId: rohan.id, openSpots: 3, skillMin: 'beginner', skillMax: 'advanced', repaymentMode: 'ledger', status: 'full' });
  await tx.insert(openMatchJoinRequests).values({ id: randomUUID(), matchId: om2Id, playerId: aarav.id, status: 'approved' });
  await tx.insert(openMatchJoinRequests).values({ id: randomUUID(), matchId: om2Id, playerId: vivaan.id, status: 'approved' });
  await tx.insert(openMatchJoinRequests).values({ id: randomUUID(), matchId: om2Id, playerId: diya.id, status: 'rejected' });

  // ---- tournaments (PRD §4.7) ------------------------------------------
  const t1Id = randomUUID();
  await tx.insert(tournaments).values({ id: t1Id, ownerId: O, venueId: v1Id, name: 'Indiranagar Pickleball Open', gameId: pickleballId, format: 'knockout', startDate: dateOnly(playAt(14, 0)), endDate: dateOnly(playAt(15, 0)), capacity: 16, regType: 'solo', feeBasis: 'per_player', fee: money(dec(500)), regCloseAt: playAt(12, 18) });
  await tx.insert(tournamentParticipants).values([
    { id: randomUUID(), tournamentId: t1Id, captainName: 'Aarav Sharma', captainMobile: '+919800000001', paid: true },
    { id: randomUUID(), tournamentId: t1Id, captainName: 'Ananya Iyer', captainMobile: '+919800000004', paid: true },
    { id: randomUUID(), tournamentId: t1Id, captainName: 'Saanvi Gupta', captainMobile: '+919800000007', paid: true },
    { id: randomUUID(), tournamentId: t1Id, captainName: 'Diya Patel', captainMobile: '+919800000002', paid: false },
    { id: randomUUID(), tournamentId: t1Id, captainName: 'Karan Bose', captainMobile: '+919800000021', paid: true },
    { id: randomUUID(), tournamentId: t1Id, captainName: 'Meera Rao', captainMobile: '+919800000022', paid: true },
  ]);

  const t2Id = randomUUID();
  await tx.insert(tournaments).values({ id: t2Id, ownerId: O, venueId: v2Id, name: 'Koramangala Turf League', gameId: footballId, format: 'league', startDate: dateOnly(playAt(30, 0)), endDate: dateOnly(playAt(45, 0)), capacity: 8, regType: 'team', feeBasis: 'per_team', fee: money(dec(5000)), regCloseAt: playAt(25, 18) });
  await tx.insert(tournamentParticipants).values([
    { id: randomUUID(), tournamentId: t2Id, teamName: 'Indiranagar FC', captainName: 'Rohan Mehta', captainMobile: '+919800000003', paid: true },
    { id: randomUUID(), tournamentId: t2Id, teamName: 'Koramangala Kings', captainName: 'Ishaan Reddy', captainMobile: '+919800000006', paid: true },
    { id: randomUUID(), tournamentId: t2Id, teamName: 'HSR Hotspurs', captainName: 'Dev Anand', captainMobile: '+919800000023', paid: false },
    { id: randomUUID(), tournamentId: t2Id, teamName: 'Whitefield Wolves', captainName: 'Sahil Khan', captainMobile: '+919800000024', paid: true },
  ]);

  const t3Id = randomUUID();
  await tx.insert(tournaments).values({ id: t3Id, ownerId: O, venueId: v1Id, name: 'Badminton Doubles Round-Robin', gameId: badmintonId, format: 'round_robin', startDate: dateOnly(playAt(20, 0)), endDate: dateOnly(playAt(20, 0)), capacity: 12, regType: 'team', feeBasis: 'per_team', fee: money(dec(800)), regCloseAt: playAt(18, 18) });
  await tx.insert(tournamentParticipants).values([
    { id: randomUUID(), tournamentId: t3Id, teamName: 'Smash Bros', captainName: 'Aarav Sharma', captainMobile: '+919800000001', paid: true },
    { id: randomUUID(), tournamentId: t3Id, teamName: 'Net Ninjas', captainName: 'Ananya Iyer', captainMobile: '+919800000004', paid: true },
    { id: randomUUID(), tournamentId: t3Id, teamName: 'Drop Shots', captainName: 'Vivaan Joshi', captainMobile: '+919800000008', paid: false },
  ]);

  // ---- additional tenants (admin Owners / platform variety) ------------
  const baselineId = randomUUID();
  await tx.insert(owners).values({ id: baselineId, name: 'Baseline Sports', logoUrl: '/images/owner-emblem.svg', contactEmail: 'admin@baseline.local', contactMobile: '+919900000002', status: 'active', venueQuota: 3, allowedGameIds: [pickleballId, badmintonId], featureFlags: ['memberships', 'loyalty'], primaryColor: '#0EA5E9', updatedAt: new Date() });
  await tx.insert(users).values({ id: randomUUID(), role: 'owner', ownerId: baselineId, name: 'Baseline Admin', email: 'admin@baseline.local', passwordHash: ownerPass });
  const bvId = randomUUID();
  await tx.insert(venues).values({ id: bvId, ownerId: baselineId, name: 'Baseline — HSR Layout', photos: ['/images/venues/pickleball.jpg'], city: 'Bengaluru', address: '27th Main, HSR', geoLat: 12.9116, geoLng: 77.6389, openTime: '06:00', closeTime: '22:00' });
  await tx.insert(venueGames).values({ venueId: bvId, gameId: pickleballId });
  await tx.insert(venueSettings).values({ venueId: bvId, noShowFee: money(dec(150)) });
  const bCourt = await makeUnit(bvId, baselineId, 'Court 1', 'court', pickleballId, 4, { base: 550, weekend: 700, evening: 800, weekendEvening: 950 });
  await makeBooking({ ownerId: baselineId, venueId: bvId, unitId: bCourt.id, customerId: aarav.id, start: playAt(-4, 18), status: 'completed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 800, total: 800 });
  await makeBooking({ ownerId: baselineId, venueId: bvId, unitId: bCourt.id, customerId: diya.id, start: playAt(2, 19), status: 'confirmed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 800, total: 800 });
  await tx.insert(ownerCustomers).values({ id: randomUUID(), ownerId: baselineId, customerId: aarav.id, lastVisitAt: daysAgo(4), bookingCount: 1, consent: true });

  const pendingOwnerId = randomUUID();
  await tx.insert(owners).values({ id: pendingOwnerId, name: 'Net Zero Arena', contactEmail: 'admin@netzero.local', contactMobile: '+919900000003', status: 'pending', venueQuota: 1, allowedGameIds: [badmintonId], updatedAt: new Date() });
  await tx.insert(users).values({ id: randomUUID(), role: 'owner', ownerId: pendingOwnerId, name: 'Net Zero Admin', email: 'admin@netzero.local', passwordHash: ownerPass });

  const suspendedOwnerId = randomUUID();
  await tx.insert(owners).values({ id: suspendedOwnerId, name: 'Old Town Courts', contactEmail: 'admin@oldtown.local', contactMobile: '+919900000004', status: 'suspended', venueQuota: 2, allowedGameIds: [pickleballId], updatedAt: new Date() });
  await tx.insert(users).values({ id: randomUUID(), role: 'owner', ownerId: suspendedOwnerId, name: 'Old Town Admin', email: 'admin@oldtown.local', passwordHash: ownerPass });

  // ---- in-app notifications (owner bell feed) --------------------------
  // A mix of types for the Smash Arena owner; a few left unread (readAt null)
  // so the bell shows an unread badge, the rest marked read recently.
  const hoursAgo = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000);
  await tx.insert(notifications).values([
    {
      id: randomUUID(),
      ownerId,
      type: 'booking_created',
      title: 'New booking — Court A',
      body: 'Aarav Sharma booked Court A at Indiranagar for this evening (6:00 PM).',
      link: '/owner/bookings',
      readAt: null,
      createdAt: hoursAgo(1),
    },
    {
      id: randomUUID(),
      ownerId,
      type: 'tournament_registration',
      title: 'New tournament registration',
      body: 'Meera Rao registered for the Indiranagar Pickleball Open.',
      link: '/owner/tournaments',
      readAt: null,
      createdAt: hoursAgo(5),
    },
    {
      id: randomUUID(),
      ownerId,
      type: 'booking_cancelled',
      title: 'Booking cancelled — Court B',
      body: 'Diya Patel cancelled her Court B booking. A refund has been issued.',
      link: '/owner/bookings',
      readAt: null,
      createdAt: hoursAgo(20),
    },
    {
      id: randomUUID(),
      ownerId,
      type: 'amc_reminder',
      title: 'AMC renewal due soon',
      body: 'Your annual maintenance charge of ₹12,000 is due in 200 days. Renew to avoid service interruption.',
      link: '/owner/dashboard',
      readAt: hoursAgo(30),
      createdAt: daysAgo(2),
    },
    {
      id: randomUUID(),
      ownerId,
      type: 'general',
      title: 'Weekly summary is ready',
      body: 'Your venues hosted 14 bookings last week. Tap to view the full breakdown.',
      link: '/owner/dashboard',
      readAt: hoursAgo(48),
      createdAt: daysAgo(3),
    },
  ]);

  // ---- audit log (PRD §7) ----------------------------------------------
  await tx.insert(auditLogs).values([
    { id: randomUUID(), ownerId, actorId: ownerAdminId, actorRole: 'owner', action: 'create', entity: 'Venue', entityId: v1Id, metadata: { name: 'Smash Arena — Indiranagar' } },
    { id: randomUUID(), ownerId, actorId: ownerAdminId, actorRole: 'owner', action: 'create', entity: 'Offer', entityId: offerFirst100Id, metadata: { code: 'FIRST100' } },
    { id: randomUUID(), ownerId, actorId: staffUserId, actorRole: 'staff', action: 'block_slot', entity: 'Slot', metadata: { unit: 'Court B', reason: 'Court resurfacing' } },
    { id: randomUUID(), ownerId: suspendedOwnerId, actorId: superAdminId, actorRole: 'super_admin', action: 'suspend', entity: 'Owner', entityId: suspendedOwnerId, metadata: { reason: 'non-payment of AMC' } },
    { id: randomUUID(), actorId: superAdminId, actorRole: 'super_admin', action: 'create', entity: 'GameCatalogue', entityId: boxCricketId, metadata: { name: 'Box Cricket' } },
  ]);

  // Seed each customer's GLOBAL profile (users.skillLevel/games) from their most
  // recent per-operator player_profile, matching the production model where a
  // player edits one operator-agnostic profile (no "venue operator" to pick).
  await tx.execute(sql`
    UPDATE users u
    SET "skillLevel" = pp."skillLevel", games = pp.games
    FROM (
      SELECT DISTINCT ON ("customerId") "customerId", "skillLevel", games
      FROM player_profiles
      ORDER BY "customerId", "createdAt" DESC
    ) pp
    WHERE u.id = pp."customerId" AND u.role = 'customer'
  `);

  // eslint-disable-next-line no-console
  console.log(
    [
      'Seed complete.',
      '  Super admin: admin@sportsbooking.local / admin12345',
      '  Owner:       owner@smasharena.local / owner12345',
      '  Staff:       staff@smasharena.local / owner12345',
      '  Customers:   any seeded mobile + OTP 123456 (e.g. +919800000001)',
    ].join('\n'),
  );
}

async function main() {
  await db.transaction(async (tx) => seed(tx));
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
