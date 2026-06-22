import Decimal from 'decimal.js';

/**
 * Money helpers for Postgres numeric(12,2) columns.
 *
 * Drizzle returns numeric columns as a plain STRING. These helpers wrap a
 * decimal.js `Decimal` so money math stays exact:
 *   - `dec`   build a Decimal from a string/number/Decimal (for math)
 *   - `money` serialize a Decimal back to a 2dp string (for writing columns)
 *   - `num`   parse a numeric string read from the DB into a JS number
 */
export { Decimal };

/** Build a Decimal for exact money math. */
export function dec(v: string | number | Decimal): Decimal {
  return new Decimal(v);
}

/** Serialize a Decimal to a fixed 2dp string for a numeric(12,2) column. */
export function money(d: Decimal): string {
  return d.toFixed(2);
}

/** Parse a numeric column value (string | null) read from the DB to a number. */
export function num(v: string | null): number {
  return v === null ? 0 : Number(v);
}
