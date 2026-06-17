import { Prisma } from '@prisma/client';
import { DayType, TimeBand } from '@sportsbooking/shared';
import { PricingService } from './pricing.service';

/**
 * Unit tests for the most-specific-rule-wins resolver (PRD §4.2).
 * The Prisma client is stubbed so we test pure resolution logic.
 */
describe('PricingService.resolve', () => {
  const rules = [
    { price: new Prisma.Decimal(600), dayType: null, timeBand: null, dateOverride: null, minDuration: null },
    { price: new Prisma.Decimal(800), dayType: 'weekend', timeBand: null, dateOverride: null, minDuration: null },
    { price: new Prisma.Decimal(900), dayType: null, timeBand: 'evening', dateOverride: null, minDuration: null },
    { price: new Prisma.Decimal(1100), dayType: 'weekend', timeBand: 'evening', dateOverride: null, minDuration: null },
  ];

  const makeService = () =>
    new PricingService({
      pricingRule: { findMany: jest.fn().mockResolvedValue(rules) },
    } as never);

  it('falls back to base rule on a weekday morning', async () => {
    const svc = makeService();
    // 2026-06-15 is a Monday; 09:00 = morning
    const r = await svc.resolve('u1', new Date('2026-06-15T09:00:00'), 60);
    expect(Number(r.price)).toBe(600);
    expect(r.dayType).toBe(DayType.WEEKDAY);
    expect(r.timeBand).toBe(TimeBand.MORNING);
  });

  it('picks the weekend rule on a Saturday morning', async () => {
    const svc = makeService();
    // 2026-06-20 is a Saturday; 09:00 = morning
    const r = await svc.resolve('u1', new Date('2026-06-20T09:00:00'), 60);
    expect(Number(r.price)).toBe(800);
  });

  it('picks the most specific weekend+evening rule', async () => {
    const svc = makeService();
    // Saturday 19:00 = evening → both weekend and evening dims match
    const r = await svc.resolve('u1', new Date('2026-06-20T19:00:00'), 60);
    expect(Number(r.price)).toBe(1100);
  });

  it('picks evening premium on a weekday evening', async () => {
    const svc = makeService();
    const r = await svc.resolve('u1', new Date('2026-06-15T19:00:00'), 60);
    expect(Number(r.price)).toBe(900);
  });
});
