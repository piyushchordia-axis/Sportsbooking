import { Prisma } from '@prisma/client';
import { PackPricingMode } from '@sportsbooking/shared';
import { MembershipsService } from './memberships.service';

/**
 * Pack pricing behaviour (PRD §4.4): flat-rate packs cover the dynamic price
 * entirely; discount packs reduce it by a set %. Scope + balance are validated.
 */
describe('MembershipsService.evaluatePack', () => {
  const ledger = { balance: jest.fn() };
  const service = new MembershipsService({} as never, ledger as never);

  const tx = (pack: Record<string, unknown>) =>
    ({ membershipPack: { findFirst: jest.fn().mockResolvedValue(pack) } }) as never;

  beforeEach(() => ledger.balance.mockResolvedValue(new Prisma.Decimal(10)));

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
      new Prisma.Decimal(1600),
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
      discountPct: new Prisma.Decimal(25),
    };
    const app = await service.evaluatePack(
      'o1',
      'c1',
      'p1',
      tx(pack),
      'v1',
      ['u1'],
      1,
      new Prisma.Decimal(800),
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
      service.evaluatePack('o1', 'c1', 'p1', tx(pack), 'v1', ['u1'], 1, new Prisma.Decimal(800)),
    ).rejects.toThrow(/not valid at this venue/);
  });

  it('rejects when the session balance is insufficient', async () => {
    ledger.balance.mockResolvedValue(new Prisma.Decimal(1));
    const pack = {
      active: true,
      pricingMode: PackPricingMode.FLAT,
      venueIds: [],
      unitIds: [],
      discountPct: null,
    };
    await expect(
      service.evaluatePack('o1', 'c1', 'p1', tx(pack), 'v1', ['u1'], 2, new Prisma.Decimal(1600)),
    ).rejects.toThrow(/Not enough pack sessions/);
  });
});
