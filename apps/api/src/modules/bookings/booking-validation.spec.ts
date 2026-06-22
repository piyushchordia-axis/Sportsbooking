// dto.ts decorates its DTO classes with class-validator/class-transformer,
// which evaluate at import time and need the reflect-metadata polyfill.
import 'reflect-metadata';
import {
  findIntraRequestOverlap,
  parseClockToMinutes,
  validateSlotOnGrid,
  type GridWindow,
  type IntervalSlot,
} from './dto';

/**
 * Unit tests for the PURE slot-validation helpers (Security M1). No DB / Nest
 * context needed — these cover grid alignment and intra-request overlap, the
 * two parts that previously let 10:00-11:00 and 10:30-11:30 both succeed on the
 * same court.
 */
describe('booking slot validation (pure helpers)', () => {
  describe('parseClockToMinutes', () => {
    it('parses HH:MM to minutes from midnight', () => {
      expect(parseClockToMinutes('06:00')).toBe(360);
      expect(parseClockToMinutes('23:00')).toBe(1380);
      expect(parseClockToMinutes('00:00')).toBe(0);
      expect(parseClockToMinutes('09:30')).toBe(570);
    });

    it('rejects malformed or out-of-range strings', () => {
      expect(parseClockToMinutes('6:00')).toBeNull();
      expect(parseClockToMinutes('24:00')).toBeNull();
      expect(parseClockToMinutes('09:60')).toBeNull();
      expect(parseClockToMinutes('')).toBeNull();
      expect(parseClockToMinutes('abc')).toBeNull();
    });
  });

  describe('validateSlotOnGrid', () => {
    // Open 06:00, close 23:00, 60-min granularity (the schema defaults).
    const window: GridWindow = {
      openMin: 6 * 60,
      closeMin: 23 * 60,
      granularityMin: 60,
    };

    it('accepts a grid-aligned, one-step slot inside operating hours', () => {
      // 10:00-11:00
      expect(
        validateSlotOnGrid({ startMin: 10 * 60, endMin: 11 * 60 }, window),
      ).toBeNull();
    });

    it('accepts a slot at the very open and very close of the day', () => {
      expect(
        validateSlotOnGrid({ startMin: 6 * 60, endMin: 7 * 60 }, window),
      ).toBeNull();
      expect(
        validateSlotOnGrid({ startMin: 22 * 60, endMin: 23 * 60 }, window),
      ).toBeNull();
    });

    it('rejects a start not aligned to the grid (the M1 double-booking case)', () => {
      // 10:30-11:30 — off-grid relative to the 06:00 anchor.
      const reason = validateSlotOnGrid(
        { startMin: 10 * 60 + 30, endMin: 11 * 60 + 30 },
        window,
      );
      expect(reason).toMatch(/aligned/i);
    });

    it('rejects a slot longer than one granularity step', () => {
      // 10:00-12:00 (two steps).
      const reason = validateSlotOnGrid(
        { startMin: 10 * 60, endMin: 12 * 60 },
        window,
      );
      expect(reason).toMatch(/one booking step/i);
    });

    it('rejects a slot shorter than one granularity step', () => {
      // 10:00-10:30 (half a step), still grid-aligned start.
      const reason = validateSlotOnGrid(
        { startMin: 10 * 60, endMin: 10 * 60 + 30 },
        window,
      );
      expect(reason).toMatch(/one booking step/i);
    });

    it('rejects a slot starting before open or ending after close', () => {
      expect(
        validateSlotOnGrid({ startMin: 5 * 60, endMin: 6 * 60 }, window),
      ).toMatch(/operating hours/i);
      // 22:30-23:30 (off-grid AND past close) — out-of-hours reported first.
      expect(
        validateSlotOnGrid({ startMin: 23 * 60, endMin: 24 * 60 }, window),
      ).toMatch(/operating hours/i);
    });

    it('rejects a zero/negative length slot', () => {
      expect(
        validateSlotOnGrid({ startMin: 10 * 60, endMin: 10 * 60 }, window),
      ).toMatch(/after its start/i);
    });

    it('honours a 30-minute granularity grid', () => {
      const half: GridWindow = { openMin: 6 * 60, closeMin: 23 * 60, granularityMin: 30 };
      // 10:30-11:00 is now valid (aligned + one 30-min step).
      expect(
        validateSlotOnGrid({ startMin: 10 * 60 + 30, endMin: 11 * 60 }, half),
      ).toBeNull();
      // 10:15-10:45 is still off-grid.
      expect(
        validateSlotOnGrid({ startMin: 10 * 60 + 15, endMin: 10 * 60 + 45 }, half),
      ).toMatch(/aligned/i);
    });

    it('aligns the grid to a non-midnight open time', () => {
      // Open 06:30 → 07:00-08:00 is off-grid (30 min from the anchor).
      const offset: GridWindow = { openMin: 6 * 60 + 30, closeMin: 23 * 60, granularityMin: 60 };
      expect(
        validateSlotOnGrid({ startMin: 7 * 60, endMin: 8 * 60 }, offset),
      ).toMatch(/aligned/i);
      // 06:30-07:30 is on-grid.
      expect(
        validateSlotOnGrid({ startMin: 6 * 60 + 30, endMin: 7 * 60 + 30 }, offset),
      ).toBeNull();
    });
  });

  describe('findIntraRequestOverlap', () => {
    const iv = (unitId: string, startH: number, endH: number): IntervalSlot => ({
      unitId,
      startMs: startH * 3_600_000,
      endMs: endH * 3_600_000,
    });

    it('returns null for non-overlapping slots on the same unit', () => {
      expect(
        findIntraRequestOverlap([iv('u1', 10, 11), iv('u1', 11, 12)]),
      ).toBeNull();
    });

    it('treats abutting slots [a,b)[b,c) as non-overlapping', () => {
      // end of first == start of second: half-open intervals do not intersect.
      expect(
        findIntraRequestOverlap([iv('u1', 10, 11), iv('u1', 11, 12)]),
      ).toBeNull();
    });

    it('detects an overlap on the same unit', () => {
      // 10:00-11:00 and 10:30-11:30 (expressed in half-hours via fractional H).
      const a: IntervalSlot = { unitId: 'u1', startMs: 0, endMs: 60 * 60000 };
      const b: IntervalSlot = { unitId: 'u1', startMs: 30 * 60000, endMs: 90 * 60000 };
      expect(findIntraRequestOverlap([a, b])).toBe(1);
    });

    it('detects a fully-contained overlap', () => {
      expect(
        findIntraRequestOverlap([iv('u1', 10, 13), iv('u1', 11, 12)]),
      ).toBe(1);
    });

    it('ignores overlaps across different units', () => {
      expect(
        findIntraRequestOverlap([iv('u1', 10, 11), iv('u2', 10, 11)]),
      ).toBeNull();
    });

    it('returns null for an empty or single-slot request', () => {
      expect(findIntraRequestOverlap([])).toBeNull();
      expect(findIntraRequestOverlap([iv('u1', 10, 11)])).toBeNull();
    });
  });
});
