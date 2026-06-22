import { DayType, TimeBand } from '@sportsbooking/shared';
import { PricingService } from './pricing.service';

/**
 * Unit tests for the most-specific-rule-wins resolver (PRD §4.2).
 * The Drizzle tx is stubbed so we test pure resolution logic.
 */
describe('PricingService.resolve', () => {
  // Drizzle returns numeric columns as plain strings; the service builds a
  // Decimal from them via dec(). Fixtures mirror that string shape.
  const rules = [
    { id: 'r1', price: '600', dayType: null, timeBand: null, dateOverride: null, minDuration: null },
    { id: 'r2', price: '800', dayType: 'weekend', timeBand: null, dateOverride: null, minDuration: null },
    { id: 'r3', price: '900', dayType: null, timeBand: 'evening', dateOverride: null, minDuration: null },
    { id: 'r4', price: '1100', dayType: 'weekend', timeBand: 'evening', dateOverride: null, minDuration: null },
  ];

  // Stub the Drizzle tx shape the service calls: tx.query.pricingRules.findMany.
  const tx = { query: { pricingRules: { findMany: jest.fn().mockResolvedValue(rules) } } } as never;

  const makeService = () => new PricingService({} as never);

  it('falls back to base rule on a weekday morning', async () => {
    const svc = makeService();
    // 2026-06-15 is a Monday; 09:00 = morning
    const r = await svc.resolve('u1', new Date('2026-06-15T09:00:00'), 60, tx);
    expect(Number(r.price)).toBe(600);
    expect(r.dayType).toBe(DayType.WEEKDAY);
    expect(r.timeBand).toBe(TimeBand.MORNING);
  });

  it('picks the weekend rule on a Saturday morning', async () => {
    const svc = makeService();
    // 2026-06-20 is a Saturday; 09:00 = morning
    const r = await svc.resolve('u1', new Date('2026-06-20T09:00:00'), 60, tx);
    expect(Number(r.price)).toBe(800);
  });

  it('picks the most specific weekend+evening rule', async () => {
    const svc = makeService();
    // Saturday 19:00 = evening → both weekend and evening dims match
    const r = await svc.resolve('u1', new Date('2026-06-20T19:00:00'), 60, tx);
    expect(Number(r.price)).toBe(1100);
  });

  it('picks evening premium on a weekday evening', async () => {
    const svc = makeService();
    const r = await svc.resolve('u1', new Date('2026-06-15T19:00:00'), 60, tx);
    expect(Number(r.price)).toBe(900);
  });
});
