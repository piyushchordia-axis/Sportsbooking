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

  // Fixtures are EXPLICIT UTC instants (…Z) for the intended IST wall-clock, so
  // the band/day are computed in venue time (Asia/Kolkata) independent of the
  // test runner's TZ — a laptop on IST and CI on UTC must agree. (IST = UTC+5:30,
  // no DST.) Several rows deliberately fall in a different band in UTC than in
  // IST, which guards the pricing TZ pinning against regression.
  it('falls back to base rule on a weekday morning', async () => {
    const svc = makeService();
    // 2026-06-15 09:00 IST (Monday, morning) = 03:30Z
    const r = await svc.resolve('u1', new Date('2026-06-15T03:30:00Z'), 60, tx);
    expect(Number(r.price)).toBe(600);
    expect(r.dayType).toBe(DayType.WEEKDAY);
    expect(r.timeBand).toBe(TimeBand.MORNING);
  });

  it('picks the weekend rule on a Saturday morning', async () => {
    const svc = makeService();
    // 2026-06-20 09:00 IST (Saturday, morning) = 03:30Z
    const r = await svc.resolve('u1', new Date('2026-06-20T03:30:00Z'), 60, tx);
    expect(Number(r.price)).toBe(800);
  });

  it('picks the most specific weekend+evening rule', async () => {
    const svc = makeService();
    // 2026-06-20 19:00 IST (Saturday, evening) = 13:30Z (which is AFTERNOON in
    // UTC — asserting 1100/evening proves IST is used, not the server zone).
    const r = await svc.resolve('u1', new Date('2026-06-20T13:30:00Z'), 60, tx);
    expect(Number(r.price)).toBe(1100);
    expect(r.timeBand).toBe(TimeBand.EVENING);
  });

  it('picks evening premium on a weekday evening', async () => {
    const svc = makeService();
    // 2026-06-15 19:00 IST (Monday, evening) = 13:30Z (afternoon in UTC)
    const r = await svc.resolve('u1', new Date('2026-06-15T13:30:00Z'), 60, tx);
    expect(Number(r.price)).toBe(900);
    expect(r.timeBand).toBe(TimeBand.EVENING);
  });
});
