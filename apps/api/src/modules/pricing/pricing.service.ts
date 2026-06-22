import { Injectable, NotFoundException } from '@nestjs/common';
import { DayType, TimeBand } from '@sportsbooking/shared';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { DbService } from '../../db/db.service';
import type { DbTx } from '../../db';
import { Decimal, dec } from '../../db/money';
import { pricingRules } from '../../db/schema';

export interface ResolvedPrice {
  price: Decimal;
  dayType: DayType;
  timeBand: TimeBand;
}

/**
 * Resolves the per-court dynamic price for a slot (PRD §4.2).
 * Pricing is rule-based per BookableUnit; the MOST SPECIFIC applicable rule
 * wins. Specificity = number of matched non-null dimensions, with a date
 * override outranking day/time bands.
 */
@Injectable()
export class PricingService {
  constructor(private readonly db: DbService) {}

  static dayType(dt: DateTime): DayType {
    // Sat=6, Sun=7 in luxon weekday
    return dt.weekday >= 6 ? DayType.WEEKEND : DayType.WEEKDAY;
  }

  static timeBand(dt: DateTime): TimeBand {
    const h = dt.hour;
    if (h < 12) return TimeBand.MORNING;
    if (h < 17) return TimeBand.AFTERNOON;
    return TimeBand.EVENING;
  }

  /** Score a rule's specificity against a slot; -1 = does not apply. */
  private score(
    rule: {
      dayType: string | null;
      timeBand: string | null;
      dateOverride: string | null;
      minDuration: number | null;
    },
    ctx: { dayType: DayType; timeBand: TimeBand; date: string; durationMin: number },
  ): number {
    let s = 0;
    if (rule.dateOverride) {
      // numeric date columns come back as ISO date strings (mode:'string').
      const ruleDate = DateTime.fromISO(rule.dateOverride).toISODate();
      if (ruleDate !== ctx.date) return -1;
      s += 8; // date override is the strongest signal
    }
    if (rule.dayType) {
      if (rule.dayType !== ctx.dayType) return -1;
      s += 2;
    }
    if (rule.timeBand) {
      if (rule.timeBand !== ctx.timeBand) return -1;
      s += 2;
    }
    if (rule.minDuration != null) {
      if (ctx.durationMin < rule.minDuration) return -1;
      s += 1;
    }
    return s;
  }

  /**
   * Resolve the price for a single slot on a unit. Reads rules within the
   * caller's tenant scope (pass tx for transactional reads).
   */
  async resolve(
    unitId: string,
    startsAt: Date,
    durationMin: number,
    tx?: DbTx,
  ): Promise<ResolvedPrice> {
    if (!tx) {
      return this.db.withTenant((scoped) =>
        this.resolve(unitId, startsAt, durationMin, scoped),
      );
    }

    const rules = await tx.query.pricingRules.findMany({
      where: eq(pricingRules.unitId, unitId),
    });
    if (rules.length === 0) {
      throw new NotFoundException(`No pricing configured for unit ${unitId}`);
    }

    const dt = DateTime.fromJSDate(startsAt);
    const ctx = {
      dayType: PricingService.dayType(dt),
      timeBand: PricingService.timeBand(dt),
      date: dt.toISODate()!,
      durationMin,
    };

    let best: { score: number; price: Decimal; id: string } | null = null;
    for (const rule of rules) {
      const s = this.score(rule, ctx);
      if (s < 0) continue;
      // numeric(10,2) columns come back as strings; build a Decimal for math.
      const rulePrice = dec(rule.price);
      if (!best || s > best.score) {
        best = { score: s, price: rulePrice, id: rule.id };
        continue;
      }
      // Deterministic tiebreaker for equal specificity: prefer the lower
      // price, then the lexicographically smaller rule id, so resolution is
      // stable regardless of row ordering (BUG-12).
      if (s === best.score) {
        const cmp = rulePrice.comparedTo(best.price);
        if (cmp < 0 || (cmp === 0 && rule.id < best.id)) {
          best = { score: s, price: rulePrice, id: rule.id };
        }
      }
    }
    if (!best) {
      // fall back to a base rule (no dimensions) if present; else first rule
      best = { score: 0, price: dec(rules[0].price), id: rules[0].id };
    }
    return { price: best.price, dayType: ctx.dayType, timeBand: ctx.timeBand };
  }
}
