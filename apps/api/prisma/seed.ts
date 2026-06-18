import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

/**
 * Dev seed: a super admin, the game catalogue, one demo owner (with admin
 * login), a venue with two courts and a weekly price grid. Run after migrations:
 *   pnpm --filter @sportsbooking/api db:seed
 *
 * Runs as the migration/admin role (DATABASE_URL with bypass), so RLS does not
 * obstruct cross-tenant seeding.
 */
const prisma = new PrismaClient();

async function main() {
  // Seed writes across tenants, so run inside one transaction with RLS bypassed
  // (mirrors PrismaService.withTenantBypass). A single interactive transaction
  // guarantees the SET LOCAL applies to every statement below.
  await prisma.$transaction(
    async (tx) => seed(tx as unknown as PrismaClient),
    { timeout: 30000 },
  );
}

async function seed(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(
    `SELECT set_config('app.bypass_rls', 'on', true)`,
  );

  // Super admin login (email/password).
  await prisma.user.upsert({
    where: { email: 'admin@sportsbooking.local' },
    update: {},
    create: {
      role: 'super_admin',
      name: 'Super Admin',
      email: 'admin@sportsbooking.local',
      passwordHash: await bcrypt.hash('admin12345', 10),
    },
  });

  // Game catalogue (PRD §3.1).
  const pickleball = await prisma.gameCatalogue.upsert({
    where: { name: 'Pickleball' },
    update: {},
    create: {
      name: 'Pickleball',
      slotGranularityMin: 60,
      unitLabel: 'court',
      minPlayers: 2,
      maxPlayers: 4,
    },
  });
  const turf = await prisma.gameCatalogue.upsert({
    where: { name: 'Turf Football' },
    update: {},
    create: {
      name: 'Turf Football',
      slotGranularityMin: 60,
      unitLabel: 'turf',
      minPlayers: 5,
      maxPlayers: 14,
    },
  });

  // Demo owner (tenant) + admin login (PRD §3.2).
  const owner = await prisma.owner.create({
    data: {
      name: 'Smash Arena',
      contactEmail: 'owner@smasharena.local',
      status: 'active',
      venueQuota: 5,
      allowedGameIds: [pickleball.id, turf.id],
      featureFlags: ['memberships', 'loyalty', 'open_matches', 'addons', 'tournaments'],
      primaryColor: '#7C3AED',
    },
  });
  await prisma.user.create({
    data: {
      role: 'owner',
      ownerId: owner.id,
      name: 'Smash Arena Admin',
      email: 'owner@smasharena.local',
      passwordHash: await bcrypt.hash('owner12345', 10),
    },
  });

  // Venue + two courts (PRD §4.1).
  const venue = await prisma.venue.create({
    data: {
      ownerId: owner.id,
      name: 'Smash Arena — Indiranagar',
      city: 'Bengaluru',
      contactPhone: '+919900000000',
      openTime: '06:00',
      closeTime: '22:00',
      games: { create: [{ gameId: pickleball.id }] },
      settings: { create: { noShowFee: 200 } },
    },
  });

  for (const courtName of ['Court A', 'Court B']) {
    const unit = await prisma.bookableUnit.create({
      data: {
        venueId: venue.id,
        ownerId: owner.id,
        name: courtName,
        label: 'court',
        gameId: pickleball.id,
        capacity: 4,
      },
    });
    // Weekly price grid (PRD §4.2): base + weekend + evening premium.
    await prisma.pricingRule.createMany({
      data: [
        { unitId: unit.id, ownerId: owner.id, price: 600 }, // base
        { unitId: unit.id, ownerId: owner.id, dayType: 'weekend', price: 800 },
        {
          unitId: unit.id,
          ownerId: owner.id,
          timeBand: 'evening',
          price: 900,
        },
        {
          unitId: unit.id,
          ownerId: owner.id,
          dayType: 'weekend',
          timeBand: 'evening',
          price: 1100,
        },
      ],
    });
  }

  // A starter membership pack so the customer wallet/purchase flow is demoable
  // out of the box (PRD §4.4): flat-rate, fully covers the dynamic court price.
  await prisma.membershipPack.create({
    data: {
      ownerId: owner.id,
      name: '10-Play Flat',
      sessions: 10,
      price: 5000,
      pricingMode: 'flat',
      expiryMode: 'none',
    },
  });

  // eslint-disable-next-line no-console
  console.log('Seed complete. Owner login: owner@smasharena.local / owner12345');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
