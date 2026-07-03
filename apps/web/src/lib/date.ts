/**
 * Local-date helpers shared across the app's date pickers. These deliberately
 * use the local calendar day (not UTC) so `new Date('YYYY-MM-DD')`'s timezone
 * shift never lands a booking on the wrong day in negative-offset zones.
 */

/** A Date → local `YYYY-MM-DD` string (empty string when no date). */
export const toISODate = (d?: Date): string =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate(),
      ).padStart(2, '0')}`
    : '';

/** A local `YYYY-MM-DD` string → local Date at midnight (undefined when empty). */
export const fromISODate = (s: string): Date | undefined => {
  if (!s) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

/** Today as a local `YYYY-MM-DD` string. */
export const todayISO = (): string => toISODate(new Date());
