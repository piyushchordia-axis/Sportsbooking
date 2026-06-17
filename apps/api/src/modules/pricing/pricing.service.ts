import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DayType, TimeBand } from '@sportsbooking/shared';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';

export interface ResolvedPrice {
  price: Prisma.Decimal;
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
  constructor(private readonly prisma: PrismaService) {}

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
      dateOverride: Date | null;
      minDuration: number | null;
    },
    ctx: { dayType: DayType; timeBand: TimeBand; date: string; durationMin: number },
  ): number {
    let s = 0;
    if (rule.dateOverride) {
      const ruleDate = DateTime.fromJSDate(rule.dateOverride).toISODate();
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
    tx?: Prisma.TransactionClient,
  ): Promise<ResolvedPrice> {
    const client = tx ?? this.prisma;
    const rules = await client.pricingRule.findMany({ where: { unitId } });
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

    let best: { score: number; price: Prisma.Decimal } | null = null;
    for (const rule of rules) {
      const s = this.score(rule, ctx);
      if (s < 0) continue;
      if (!best || s > best.score) {
        best = { score: s, price: rule.price };
      }
    }
    if (!best) {
      // fall back to a base rule (no dimensions) if present; else first rule
      best = { score: 0, price: rules[0].price };
    }
    return { price: best.price, dayType: ctx.dayType, timeBand: ctx.timeBand };
  }
}
