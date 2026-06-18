import {
  PrismaClient,
  BookingStatus,
  PayMode,
  PaymentStatus,
  LedgerTxnType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

/**
 * Dev seed: a complete, internally-consistent demo dataset that exercises every
 * table and every customer/owner/admin flow in the app. Run after migrations:
 *   pnpm --filter @sportsbooking/api db:seed
 *
 * Idempotent: wipes all rows (FK-safe order) then recreates a known state, so it
 * is safe to re-run. Runs inside one transaction with RLS bypassed (mirrors
 * PrismaService.withTenantBypass) so cross-tenant seeding is not obstructed.
 *
 * Demo logins:
 *   - Super admin:  admin@sportsbooking.local / admin12345
 *   - Owner:        owner@smasharena.local    / owner12345
 *   - Staff:        staff@smasharena.local     / owner12345
 *   - Customers:    any seeded mobile + OTP 123456 (e.g. +919800000001)
 */
const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction(
    async (tx) => seed(tx as unknown as PrismaClient),
    { timeout: 120000 },
  );
}

async function seed(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(
    `SELECT set_config('app.bypass_rls', 'on', true)`,
  );

  // ---- reset (children -> parents) so the seed is re-runnable ------------
  await prisma.auditLog.deleteMany();
  await prisma.openMatchJoinRequest.deleteMany();
  await prisma.openMatch.deleteMany();
  await prisma.tournamentParticipant.deleteMany();
  await prisma.tournament.deleteMany();
  await prisma.bookingAddon.deleteMany();
  await prisma.slot.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.ledgerTxn.deleteMany();
  await prisma.referral.deleteMany();
  await prisma.playerProfile.deleteMany();
  await prisma.ownerCustomer.deleteMany();
  await prisma.addon.deleteMany();
  await prisma.pricingRule.deleteMany();
  await prisma.membershipPack.deleteMany();
  await prisma.bookableUnit.deleteMany();
  await prisma.venueSettings.deleteMany();
  await prisma.venueGame.deleteMany();
  await prisma.offer.deleteMany();
  await prisma.venue.deleteMany();
  await prisma.user.deleteMany();
  await prisma.owner.deleteMany();
  await prisma.gameCatalogue.deleteMany();

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

  const ownerPass = await bcrypt.hash('owner12345', 10);
  const adminPass = await bcrypt.hash('admin12345', 10);

  // running ledger balances, keyed `${customerId}|${lane}`
  const balances = new Map<string, number>();
  async function post(
    ownerId: string,
    customerId: string,
    type: LedgerTxnType,
    lane: string,
    amount: number,
    note: string,
    ref?: { refType: string; refId: string },
  ) {
    const key = `${customerId}|${lane}`;
    const balanceAfter = (balances.get(key) ?? 0) + amount;
    balances.set(key, balanceAfter);
    await prisma.ledgerTxn.create({
      data: {
        ownerId,
        customerId,
        type,
        lane,
        amount,
        balanceAfter,
        note,
        refType: ref?.refType,
        refId: ref?.refId,
        createdAt: tick(),
      },
    });
  }

  async function makeUnit(
    venueId: string,
    ownerId: string,
    name: string,
    label: 'court' | 'turf' | 'lane' | 'net',
    gameId: string,
    capacity: number,
    prices: { base: number; weekend: number; evening: number; weekendEvening: number },
  ) {
    const unit = await prisma.bookableUnit.create({
      data: { venueId, ownerId, name, label, gameId, capacity },
    });
    await prisma.pricingRule.createMany({
      data: [
        { unitId: unit.id, ownerId, price: prices.base },
        { unitId: unit.id, ownerId, dayType: 'weekend', price: prices.weekend },
        { unitId: unit.id, ownerId, timeBand: 'evening', price: prices.evening },
        {
          unitId: unit.id,
          ownerId,
          dayType: 'weekend',
          timeBand: 'evening',
          price: prices.weekendEvening,
        },
      ],
    });
    return unit;
  }

  async function makeBooking(opts: {
    ownerId: string;
    venueId: string;
    unitId: string;
    customerId: string;
    start: Date;
    status: BookingStatus;
    payMode: PayMode;
    paymentStatus: PaymentStatus;
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
    const booking = await prisma.booking.create({
      data: {
        ownerId: opts.ownerId,
        venueId: opts.venueId,
        customerId: opts.customerId,
        status: opts.status,
        payMode: opts.payMode,
        paymentStatus: opts.paymentStatus,
        subtotal: opts.subtotal,
        discount: opts.discount ?? 0,
        total: opts.total,
        pointsRedeemed: opts.pointsRedeemed ?? 0,
        packId: opts.packId,
        offerId: opts.offerId,
        noShowFeeApplied: opts.noShowFeeApplied ?? false,
        createdAt: tick(),
      },
    });
    await prisma.slot.create({
      data: {
        unitId: opts.unitId,
        ownerId: opts.ownerId,
        startsAt: opts.start,
        endsAt: end,
        status: 'booked',
        bookingId: booking.id,
      },
    });
    if (opts.addon) {
      await prisma.bookingAddon.create({
        data: {
          bookingId: booking.id,
          addonId: opts.addon.addonId,
          quantity: opts.addon.quantity,
          unitPrice: opts.addon.unitPrice,
        },
      });
    }
    return booking.id;
  }

  // ---- super admin ------------------------------------------------------
  const superAdmin = await prisma.user.create({
    data: {
      role: 'super_admin',
      name: 'Super Admin',
      email: 'admin@sportsbooking.local',
      passwordHash: adminPass,
    },
  });

  // ---- game catalogue (PRD §3.1) ---------------------------------------
  const pickleball = await prisma.gameCatalogue.create({
    data: { name: 'Pickleball', iconUrl: '/images/sports/pickleball.svg', slotGranularityMin: 60, unitLabel: 'court', minPlayers: 2, maxPlayers: 4 },
  });
  const badminton = await prisma.gameCatalogue.create({
    data: { name: 'Badminton', iconUrl: '/images/sports/badminton.svg', slotGranularityMin: 60, unitLabel: 'court', minPlayers: 2, maxPlayers: 4 },
  });
  const football = await prisma.gameCatalogue.create({
    data: { name: 'Turf Football', iconUrl: '/images/sports/football.svg', slotGranularityMin: 60, unitLabel: 'turf', minPlayers: 10, maxPlayers: 14 },
  });
  const boxCricket = await prisma.gameCatalogue.create({
    data: { name: 'Box Cricket', iconUrl: '/images/sports/cricket.svg', slotGranularityMin: 60, unitLabel: 'turf', minPlayers: 6, maxPlayers: 12 },
  });

  // ---- primary tenant: Smash Arena -------------------------------------
  const owner = await prisma.owner.create({
    data: {
      name: 'Smash Arena',
      logoUrl: '/images/owner-emblem.svg',
      contactEmail: 'owner@smasharena.local',
      contactMobile: '+919900000001',
      status: 'active',
      venueQuota: 5,
      allowedGameIds: [pickleball.id, badminton.id, football.id, boxCricket.id],
      featureFlags: ['memberships', 'loyalty', 'open_matches', 'addons', 'tournaments'],
      primaryColor: '#7C3AED',
      setupFee: 25000,
      amcAmount: 12000,
      amcRenewalDate: new Date(Date.now() + 200 * DAY),
    },
  });
  const ownerAdmin = await prisma.user.create({
    data: {
      role: 'owner',
      ownerId: owner.id,
      name: 'Smash Arena Admin',
      email: 'owner@smasharena.local',
      passwordHash: ownerPass,
    },
  });

  // venues + settings + games
  const v1 = await prisma.venue.create({
    data: {
      ownerId: owner.id,
      name: 'Smash Arena — Indiranagar',
      photos: ['/images/venues/pickleball.jpg', '/images/venues/badminton.jpg'],
      city: 'Bengaluru',
      address: '100ft Road, Indiranagar',
      contactPhone: '+919900000010',
      openTime: '06:00',
      closeTime: '23:00',
      games: { create: [{ gameId: pickleball.id }, { gameId: badminton.id }] },
      settings: { create: { cancellationTemplate: 'moderate', noShowFee: 200, openMatchRepaymentMode: 'info' } },
    },
  });
  const v2 = await prisma.venue.create({
    data: {
      ownerId: owner.id,
      name: 'Smash Arena — Koramangala',
      photos: ['/images/venues/turf-football.jpg', '/images/venues/box-cricket.jpg'],
      city: 'Bengaluru',
      address: '80ft Road, Koramangala',
      contactPhone: '+919900000011',
      openTime: '06:00',
      closeTime: '23:00',
      games: { create: [{ gameId: football.id }, { gameId: boxCricket.id }] },
      settings: { create: { cancellationTemplate: 'strict', noShowFee: 500, openMatchRepaymentMode: 'ledger' } },
    },
  });

  const staffUser = await prisma.user.create({
    data: {
      role: 'staff',
      ownerId: owner.id,
      name: 'Front Desk — Indiranagar',
      email: 'staff@smasharena.local',
      passwordHash: ownerPass,
      assignedVenueIds: [v1.id],
    },
  });

  // bookable units + pricing
  const courtA = await makeUnit(v1.id, owner.id, 'Court A', 'court', pickleball.id, 4, { base: 600, weekend: 800, evening: 900, weekendEvening: 1100 });
  const courtB = await makeUnit(v1.id, owner.id, 'Court B', 'court', pickleball.id, 4, { base: 600, weekend: 800, evening: 900, weekendEvening: 1100 });
  const courtC = await makeUnit(v1.id, owner.id, 'Court C', 'court', badminton.id, 4, { base: 500, weekend: 650, evening: 700, weekendEvening: 850 });
  const turf1 = await makeUnit(v2.id, owner.id, 'Turf 1', 'turf', football.id, 14, { base: 900, weekend: 1100, evening: 1100, weekendEvening: 1400 });
  const pitch1 = await makeUnit(v2.id, owner.id, 'Pitch 1', 'turf', boxCricket.id, 12, { base: 700, weekend: 900, evening: 900, weekendEvening: 1100 });

  // a blocked slot for maintenance (SlotStatus variety)
  await prisma.slot.create({
    data: {
      unitId: courtB.id,
      ownerId: owner.id,
      startsAt: playAt(2, 12),
      endsAt: playAt(2, 13),
      status: 'blocked',
      blockReason: 'Court resurfacing',
    },
  });

  // add-ons (PRD §4.6)
  const racquetRental = await prisma.addon.create({ data: { ownerId: owner.id, venueId: v1.id, name: 'Racquet Rental', type: 'rental', price: 100, stock: 20 } });
  await prisma.addon.create({ data: { ownerId: owner.id, venueId: v1.id, name: 'Energy Drink', type: 'cafe', price: 60, stock: 50 } });
  await prisma.addon.create({ data: { ownerId: owner.id, venueId: v1.id, name: 'Coaching Session', type: 'coaching', price: 500, stock: null } });
  const ballRental = await prisma.addon.create({ data: { ownerId: owner.id, venueId: v2.id, name: 'Football Rental', type: 'rental', price: 80, stock: 15 } });
  await prisma.addon.create({ data: { ownerId: owner.id, venueId: v2.id, name: 'Cold Drink', type: 'cafe', price: 40, stock: 100 } });

  // membership packs (PRD §4.4)
  const pack10 = await prisma.membershipPack.create({
    data: { ownerId: owner.id, name: '10-Play Flat', sessions: 10, price: 5000, pricingMode: 'flat', flatRate: 500, expiryMode: 'none' },
  });
  const packBad = await prisma.membershipPack.create({
    data: { ownerId: owner.id, name: '5-Play Badminton', sessions: 5, price: 2000, pricingMode: 'discount', discountPct: 20, validityDays: 90, expiryMode: 'forfeit', venueIds: [v1.id] },
  });
  const packTurf = await prisma.membershipPack.create({
    data: { ownerId: owner.id, name: 'Turf 8-Pack', sessions: 8, price: 6400, pricingMode: 'flat', flatRate: 800, validityDays: 120, expiryMode: 'rollover', venueIds: [v2.id] },
  });

  // offers (PRD §4.8)
  const offerMorning = await prisma.offer.create({
    data: { ownerId: owner.id, name: 'Weekday Morning 20% Off', type: 'percent', value: 20, autoApply: true, segment: 'weekday_mornings', validFrom: daysAgo(30), validTo: new Date(Date.now() + 60 * DAY) },
  });
  const offerFirst100 = await prisma.offer.create({
    data: { ownerId: owner.id, name: 'First Booking ₹100 Off', type: 'flat', value: 100, code: 'FIRST100', autoApply: false },
  });
  await prisma.offer.create({
    data: { ownerId: owner.id, name: 'Win-back 15%', type: 'percent', value: 15, code: 'COMEBACK15', segment: 'lapsed', validFrom: daysAgo(10), validTo: new Date(Date.now() + 30 * DAY) },
  });

  // ---- customers (global users) ----------------------------------------
  const mk = (name: string, mobile: string) => prisma.user.create({ data: { role: 'customer', name, mobile } });
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
    { user: aarav, games: [pickleball.id, badminton.id], skill: 'advanced', bookingCount: 8, lastVisit: daysAgo(3), consent: true },
    { user: diya, games: [pickleball.id], skill: 'beginner', bookingCount: 2, lastVisit: daysAgo(1), consent: true },
    { user: rohan, games: [football.id], skill: 'advanced_beginner', bookingCount: 6, lastVisit: daysAgo(7), consent: true },
    { user: ananya, games: [badminton.id, pickleball.id], skill: 'pro', bookingCount: 12, lastVisit: daysAgo(2), consent: true },
    { user: kabir, games: [boxCricket.id], skill: 'beginner', bookingCount: 1, lastVisit: daysAgo(75), consent: false },
    { user: ishaan, games: [football.id, boxCricket.id], skill: 'advanced', bookingCount: 5, lastVisit: daysAgo(4), consent: true },
    { user: saanvi, games: [pickleball.id], skill: 'advanced_beginner', bookingCount: 3, lastVisit: daysAgo(90), consent: true, optedOut: true },
    { user: vivaan, games: [badminton.id], skill: 'beginner', bookingCount: 1, lastVisit: daysAgo(1), consent: false },
  ];
  for (const c of crm) {
    await prisma.ownerCustomer.create({
      data: {
        ownerId: owner.id,
        customerId: c.user.id,
        firstSeenAt: daysAgo(120),
        lastVisitAt: c.lastVisit,
        bookingCount: c.bookingCount,
        consent: c.consent,
        optedOut: c.optedOut ?? false,
      },
    });
    await prisma.playerProfile.create({
      data: {
        ownerId: owner.id,
        customerId: c.user.id,
        name: c.user.name,
        mobile: c.user.mobile ?? '',
        games: c.games,
        skillLevel: c.skill,
        consent: c.consent,
      },
    });
  }

  // ---- bookings (drives dashboard revenue/occupancy) -------------------
  const O = owner.id;
  await makeBooking({ ownerId: O, venueId: v1.id, unitId: courtA.id, customerId: aarav.id, start: playAt(-10, 18), status: 'completed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 900, total: 900 });
  await makeBooking({ ownerId: O, venueId: v1.id, unitId: courtA.id, customerId: aarav.id, start: playAt(-3, 19), status: 'completed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 900, discount: 100, total: 800, offerId: offerFirst100.id });
  await makeBooking({ ownerId: O, venueId: v1.id, unitId: courtC.id, customerId: diya.id, start: playAt(-5, 9), status: 'completed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 500, discount: 100, total: 400, offerId: offerMorning.id });
  await makeBooking({ ownerId: O, venueId: v1.id, unitId: courtC.id, customerId: ananya.id, start: playAt(2, 20), status: 'confirmed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 700, pointsRedeemed: 45, total: 655, packId: packBad.id });
  await makeBooking({ ownerId: O, venueId: v1.id, unitId: courtA.id, customerId: ananya.id, start: playAt(5, 18), status: 'confirmed', payMode: 'at_venue', paymentStatus: 'awaiting_venue_settlement', subtotal: 900, total: 900 });
  await makeBooking({ ownerId: O, venueId: v2.id, unitId: turf1.id, customerId: rohan.id, start: playAt(-7, 19), status: 'completed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 1100, total: 1100, addon: { addonId: ballRental.id, quantity: 1, unitPrice: 80 } });
  await makeBooking({ ownerId: O, venueId: v2.id, unitId: turf1.id, customerId: rohan.id, start: playAt(3, 20), status: 'confirmed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 1100, total: 1100, packId: packTurf.id });
  await makeBooking({ ownerId: O, venueId: v2.id, unitId: pitch1.id, customerId: ishaan.id, start: playAt(-2, 18), status: 'completed', payMode: 'at_venue', paymentStatus: 'settled_at_venue', subtotal: 800, total: 800 });
  await makeBooking({ ownerId: O, venueId: v2.id, unitId: turf1.id, customerId: ishaan.id, start: playAt(6, 21), status: 'confirmed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 1100, total: 1100 });
  await makeBooking({ ownerId: O, venueId: v2.id, unitId: pitch1.id, customerId: kabir.id, start: playAt(-75, 17), status: 'completed', payMode: 'at_venue', paymentStatus: 'settled_at_venue', subtotal: 700, total: 700 });
  await makeBooking({ ownerId: O, venueId: v1.id, unitId: courtA.id, customerId: saanvi.id, start: playAt(-90, 10), status: 'completed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 500, total: 500 });
  await makeBooking({ ownerId: O, venueId: v1.id, unitId: courtC.id, customerId: vivaan.id, start: playAt(1, 8), status: 'confirmed', payMode: 'prepay', paymentStatus: 'pending', subtotal: 500, total: 500 });
  await makeBooking({ ownerId: O, venueId: v1.id, unitId: courtB.id, customerId: diya.id, start: playAt(-1, 19), status: 'cancelled', payMode: 'prepay', paymentStatus: 'refunded', subtotal: 900, total: 900 });
  await makeBooking({ ownerId: O, venueId: v1.id, unitId: courtB.id, customerId: aarav.id, start: playAt(-8, 7), status: 'no_show', payMode: 'prepay', paymentStatus: 'paid', subtotal: 500, total: 500, noShowFeeApplied: true });

  // two bookings that host open matches
  const omBooking1 = await makeBooking({ ownerId: O, venueId: v2.id, unitId: turf1.id, customerId: ananya.id, start: playAt(4, 18), status: 'confirmed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 1100, total: 1100 });
  const omBooking2 = await makeBooking({ ownerId: O, venueId: v1.id, unitId: courtC.id, customerId: rohan.id, start: playAt(7, 20), status: 'confirmed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 700, total: 700 });

  // ---- ledger / wallet (PRD §7) ----------------------------------------
  // Aarav: bought a pack, used two sessions, earned points, got a referral reward
  await post(O, aarav.id, 'pack_buy', `pack:${pack10.id}`, 10, 'Bought 10-Play Flat', { refType: 'pack', refId: pack10.id });
  await post(O, aarav.id, 'pack_debit', `pack:${pack10.id}`, -1, 'Used 1 session', { refType: 'booking', refId: omBooking1 });
  await post(O, aarav.id, 'pack_debit', `pack:${pack10.id}`, -1, 'Used 1 session');
  await post(O, aarav.id, 'points_earn', 'points', 45, 'Earned 45 pts on bookings');
  await post(O, aarav.id, 'referral_reward', 'credit', 100, 'Referral reward — Diya joined', { refType: 'referral', refId: 'AARAV50' });

  // Ananya: badminton pack, earned + redeemed points
  await post(O, ananya.id, 'pack_buy', `pack:${packBad.id}`, 5, 'Bought 5-Play Badminton', { refType: 'pack', refId: packBad.id });
  await post(O, ananya.id, 'pack_debit', `pack:${packBad.id}`, -1, 'Used 1 session', { refType: 'booking', refId: omBooking2 });
  await post(O, ananya.id, 'points_earn', 'points', 90, 'Earned 90 pts on bookings');
  await post(O, ananya.id, 'points_redeem', 'points', -45, 'Redeemed 45 pts');

  // Rohan: turf pack + points + referral reward
  await post(O, rohan.id, 'pack_buy', `pack:${packTurf.id}`, 8, 'Bought Turf 8-Pack', { refType: 'pack', refId: packTurf.id });
  await post(O, rohan.id, 'pack_debit', `pack:${packTurf.id}`, -1, 'Used 1 session');
  await post(O, rohan.id, 'points_earn', 'points', 55, 'Earned 55 pts on bookings');
  await post(O, rohan.id, 'referral_reward', 'credit', 100, 'Referral reward — Ishaan joined', { refType: 'referral', refId: 'ROHAN50' });

  // others: points only
  await post(O, ishaan.id, 'points_earn', 'points', 38, 'Earned 38 pts on bookings');
  await post(O, diya.id, 'points_earn', 'points', 12, 'Earned 12 pts on bookings');
  await post(O, kabir.id, 'points_earn', 'points', 14, 'Earned 14 pts on bookings');

  // ---- referrals (PRD §4.5) --------------------------------------------
  await prisma.referral.create({ data: { ownerId: O, referrerId: aarav.id, refereeId: diya.id, code: 'AARAV50', status: 'rewarded', rewardReleasedOnFirstPaid: true } });
  await prisma.referral.create({ data: { ownerId: O, referrerId: ananya.id, code: 'ANANYA50', status: 'pending' } });
  await prisma.referral.create({ data: { ownerId: O, referrerId: rohan.id, refereeId: ishaan.id, code: 'ROHAN50', status: 'rewarded', rewardReleasedOnFirstPaid: true } });

  // ---- open matches (PRD §5.3) -----------------------------------------
  const om1 = await prisma.openMatch.create({
    data: { ownerId: O, bookingId: omBooking1, hostId: ananya.id, openSpots: 2, skillMin: 'advanced_beginner', skillMax: 'pro', repaymentMode: 'info', status: 'open' },
  });
  await prisma.openMatchJoinRequest.create({ data: { matchId: om1.id, playerId: rohan.id, status: 'approved' } });
  await prisma.openMatchJoinRequest.create({ data: { matchId: om1.id, playerId: ishaan.id, status: 'requested' } });

  const om2 = await prisma.openMatch.create({
    data: { ownerId: O, bookingId: omBooking2, hostId: rohan.id, openSpots: 3, skillMin: 'beginner', skillMax: 'advanced', repaymentMode: 'ledger', status: 'full' },
  });
  await prisma.openMatchJoinRequest.create({ data: { matchId: om2.id, playerId: aarav.id, status: 'approved' } });
  await prisma.openMatchJoinRequest.create({ data: { matchId: om2.id, playerId: vivaan.id, status: 'approved' } });
  await prisma.openMatchJoinRequest.create({ data: { matchId: om2.id, playerId: diya.id, status: 'rejected' } });

  // ---- tournaments (PRD §4.7) ------------------------------------------
  const t1 = await prisma.tournament.create({
    data: { ownerId: O, venueId: v1.id, name: 'Indiranagar Pickleball Open', gameId: pickleball.id, format: 'knockout', startDate: playAt(14, 0), endDate: playAt(15, 0), capacity: 16, regType: 'solo', feeBasis: 'per_player', fee: 500, regCloseAt: playAt(12, 18) },
  });
  await prisma.tournamentParticipant.createMany({
    data: [
      { tournamentId: t1.id, captainName: 'Aarav Sharma', captainMobile: '+919800000001', paid: true },
      { tournamentId: t1.id, captainName: 'Ananya Iyer', captainMobile: '+919800000004', paid: true },
      { tournamentId: t1.id, captainName: 'Saanvi Gupta', captainMobile: '+919800000007', paid: true },
      { tournamentId: t1.id, captainName: 'Diya Patel', captainMobile: '+919800000002', paid: false },
      { tournamentId: t1.id, captainName: 'Karan Bose', captainMobile: '+919800000021', paid: true },
      { tournamentId: t1.id, captainName: 'Meera Rao', captainMobile: '+919800000022', paid: true },
    ],
  });

  const t2 = await prisma.tournament.create({
    data: { ownerId: O, venueId: v2.id, name: 'Koramangala Turf League', gameId: football.id, format: 'league', startDate: playAt(30, 0), endDate: playAt(45, 0), capacity: 8, regType: 'team', feeBasis: 'per_team', fee: 5000, regCloseAt: playAt(25, 18) },
  });
  await prisma.tournamentParticipant.createMany({
    data: [
      { tournamentId: t2.id, teamName: 'Indiranagar FC', captainName: 'Rohan Mehta', captainMobile: '+919800000003', paid: true },
      { tournamentId: t2.id, teamName: 'Koramangala Kings', captainName: 'Ishaan Reddy', captainMobile: '+919800000006', paid: true },
      { tournamentId: t2.id, teamName: 'HSR Hotspurs', captainName: 'Dev Anand', captainMobile: '+919800000023', paid: false },
      { tournamentId: t2.id, teamName: 'Whitefield Wolves', captainName: 'Sahil Khan', captainMobile: '+919800000024', paid: true },
    ],
  });

  const t3 = await prisma.tournament.create({
    data: { ownerId: O, venueId: v1.id, name: 'Badminton Doubles Round-Robin', gameId: badminton.id, format: 'round_robin', startDate: playAt(20, 0), endDate: playAt(20, 0), capacity: 12, regType: 'team', feeBasis: 'per_team', fee: 800, regCloseAt: playAt(18, 18) },
  });
  await prisma.tournamentParticipant.createMany({
    data: [
      { tournamentId: t3.id, teamName: 'Smash Bros', captainName: 'Aarav Sharma', captainMobile: '+919800000001', paid: true },
      { tournamentId: t3.id, teamName: 'Net Ninjas', captainName: 'Ananya Iyer', captainMobile: '+919800000004', paid: true },
      { tournamentId: t3.id, teamName: 'Drop Shots', captainName: 'Vivaan Joshi', captainMobile: '+919800000008', paid: false },
    ],
  });

  // ---- additional tenants (admin Owners / platform variety) ------------
  const baseline = await prisma.owner.create({
    data: { name: 'Baseline Sports', logoUrl: '/images/owner-emblem.svg', contactEmail: 'admin@baseline.local', contactMobile: '+919900000002', status: 'active', venueQuota: 3, allowedGameIds: [pickleball.id, badminton.id], featureFlags: ['memberships', 'loyalty'], primaryColor: '#0EA5E9' },
  });
  await prisma.user.create({ data: { role: 'owner', ownerId: baseline.id, name: 'Baseline Admin', email: 'admin@baseline.local', passwordHash: ownerPass } });
  const bv = await prisma.venue.create({
    data: { ownerId: baseline.id, name: 'Baseline — HSR Layout', photos: ['/images/venues/pickleball.jpg'], city: 'Bengaluru', address: '27th Main, HSR', openTime: '06:00', closeTime: '22:00', games: { create: [{ gameId: pickleball.id }] }, settings: { create: { noShowFee: 150 } } },
  });
  const bCourt = await makeUnit(bv.id, baseline.id, 'Court 1', 'court', pickleball.id, 4, { base: 550, weekend: 700, evening: 800, weekendEvening: 950 });
  await makeBooking({ ownerId: baseline.id, venueId: bv.id, unitId: bCourt.id, customerId: aarav.id, start: playAt(-4, 18), status: 'completed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 800, total: 800 });
  await makeBooking({ ownerId: baseline.id, venueId: bv.id, unitId: bCourt.id, customerId: diya.id, start: playAt(2, 19), status: 'confirmed', payMode: 'prepay', paymentStatus: 'paid', subtotal: 800, total: 800 });
  await prisma.ownerCustomer.create({ data: { ownerId: baseline.id, customerId: aarav.id, lastVisitAt: daysAgo(4), bookingCount: 1, consent: true } });

  const pendingOwner = await prisma.owner.create({
    data: { name: 'Net Zero Arena', contactEmail: 'admin@netzero.local', contactMobile: '+919900000003', status: 'pending', venueQuota: 1, allowedGameIds: [badminton.id] },
  });
  await prisma.user.create({ data: { role: 'owner', ownerId: pendingOwner.id, name: 'Net Zero Admin', email: 'admin@netzero.local', passwordHash: ownerPass } });

  const suspendedOwner = await prisma.owner.create({
    data: { name: 'Old Town Courts', contactEmail: 'admin@oldtown.local', contactMobile: '+919900000004', status: 'suspended', venueQuota: 2, allowedGameIds: [pickleball.id] },
  });
  await prisma.user.create({ data: { role: 'owner', ownerId: suspendedOwner.id, name: 'Old Town Admin', email: 'admin@oldtown.local', passwordHash: ownerPass } });

  // ---- audit log (PRD §7) ----------------------------------------------
  await prisma.auditLog.createMany({
    data: [
      { ownerId: owner.id, actorId: ownerAdmin.id, actorRole: 'owner', action: 'create', entity: 'Venue', entityId: v1.id, metadata: { name: v1.name } },
      { ownerId: owner.id, actorId: ownerAdmin.id, actorRole: 'owner', action: 'create', entity: 'Offer', entityId: offerFirst100.id, metadata: { code: 'FIRST100' } },
      { ownerId: owner.id, actorId: staffUser.id, actorRole: 'staff', action: 'block_slot', entity: 'Slot', metadata: { unit: 'Court B', reason: 'Court resurfacing' } },
      { ownerId: suspendedOwner.id, actorId: superAdmin.id, actorRole: 'super_admin', action: 'suspend', entity: 'Owner', entityId: suspendedOwner.id, metadata: { reason: 'non-payment of AMC' } },
      { actorId: superAdmin.id, actorRole: 'super_admin', action: 'create', entity: 'GameCatalogue', entityId: boxCricket.id, metadata: { name: 'Box Cricket' } },
    ],
  });

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

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
