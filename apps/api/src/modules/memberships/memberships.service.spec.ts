import { PackExpiryMode, PackPricingMode } from '@sportsbooking/shared';
import { Decimal } from '../../db/money';
import { MembershipsService, isPackExpired } from './memberships.service';

/**
 * Pure expiry-mode decision (PRD §4.4). Only FORFEIT packs with a validity
 * window can time-expire; ROLLOVER / NONE never do.
 */
describe('isPackExpired', () => {
  const purchasedAt = new Date('2026-01-01T00:00:00.000Z');
  const within = new Date('2026-01-20T00:00:00.000Z'); // +19d
  const past = new Date('2026-02-15T00:00:00.000Z'); // +45d

  it('FORFEIT: not expired before the validity window elapses', () => {
    expect(isPackExpired(PackExpiryMode.FORFEIT, 30, purchasedAt, within)).toBe(
      false,
    );
  });

  it('FORFEIT: expired once now is at/after purchase + validityDays', () => {
    expect(isPackExpired(PackExpiryMode.FORFEIT, 30, purchasedAt, past)).toBe(
      true,
    );
  });

  it('FORFEIT: expires exactly at the boundary (inclusive)', () => {
    const boundary = new Date('2026-01-31T00:00:00.000Z'); // +30d
    expect(
      isPackExpired(PackExpiryMode.FORFEIT, 30, purchasedAt, boundary),
    ).toBe(true);
  });

  it('FORFEIT: a null validityDays never expires', () => {
    expect(isPackExpired(PackExpiryMode.FORFEIT, null, purchasedAt, past)).toBe(
      false,
    );
  });

  it('NONE: never expires even past the would-be window', () => {
    expect(isPackExpired(PackExpiryMode.NONE, 30, purchasedAt, past)).toBe(
      false,
    );
  });

  it('ROLLOVER: never expires even past the would-be window', () => {
    expect(isPackExpired(PackExpiryMode.ROLLOVER, 30, purchasedAt, past)).toBe(
      false,
    );
  });
});

/**
 * Pack pricing behaviour (PRD §4.4): flat-rate packs cover the dynamic price
 * entirely; discount packs reduce it by a set %. Scope + balance are validated.
 */
describe('MembershipsService.evaluatePack', () => {
  const ledger = { balance: jest.fn() };
  const service = new MembershipsService({} as never, ledger as never);

  // Stub the Drizzle tx shape: tx.query.membershipPacks.findFirst returns the
  // pack fixture. Drizzle returns numeric columns as strings (discountPct).
  // ledgerTxns.findFirst returns null so resolvePackExpiry sees no prior
  // PACK_BUY and treats the lane as never-purchased (not expired).
  const tx = (pack: Record<string, unknown>) =>
    ({
      query: {
        membershipPacks: { findFirst: jest.fn().mockResolvedValue(pack) },
        ledgerTxns: { findFirst: jest.fn().mockResolvedValue(null) },
      },
    }) as never;

  beforeEach(() => ledger.balance.mockResolvedValue(new Decimal(10)));

  it('flat-rate pack covers the full slot subtotal', async () => {
    const pack = {
      active: true,
      pricingMode: PackPricingMode.FLAT,
      venueIds: [],
      unitIds: [],
      discountPct: null,
    };
    const app = await service.evaluatePack(
      'o1',
      'c1',
      'p1',
      tx(pack),
      'v1',
      ['u1'],
      2,
      new Decimal(1600),
    );
    expect(Number(app.discount)).toBe(1600);
    expect(app.sessions).toBe(2);
  });

  it('discount pack reduces subtotal by the configured %', async () => {
    const pack = {
      active: true,
      pricingMode: PackPricingMode.DISCOUNT,
      venueIds: [],
      unitIds: [],
      discountPct: '25',
    };
    const app = await service.evaluatePack(
      'o1',
      'c1',
      'p1',
      tx(pack),
      'v1',
      ['u1'],
      1,
      new Decimal(800),
    );
    expect(Number(app.discount)).toBe(200);
  });

  it('rejects when pack scope excludes the venue', async () => {
    const pack = {
      active: true,
      pricingMode: PackPricingMode.FLAT,
      venueIds: ['other-venue'],
      unitIds: [],
      discountPct: null,
    };
    await expect(
      service.evaluatePack('o1', 'c1', 'p1', tx(pack), 'v1', ['u1'], 1, new Decimal(800)),
    ).rejects.toThrow(/not valid at this venue/);
  });

  it('rejects when the session balance is insufficient', async () => {
    ledger.balance.mockResolvedValue(new Decimal(1));
    const pack = {
      active: true,
      pricingMode: PackPricingMode.FLAT,
      venueIds: [],
      unitIds: [],
      discountPct: null,
    };
    await expect(
      service.evaluatePack('o1', 'c1', 'p1', tx(pack), 'v1', ['u1'], 2, new Decimal(1600)),
    ).rejects.toThrow(/Not enough pack sessions/);
  });
});
