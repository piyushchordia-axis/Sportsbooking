/**
 * Venue timezone. All venues operate in IST by design (there is no per-venue TZ
 * column and the server TZ is not relied upon), so slot times, day boundaries,
 * pricing bands and week windows must all be computed in this zone. Parse wall-
 * clock inputs with `DateTime.fromISO(s, { zone: VENUE_TZ })` and read stored
 * instants with `DateTime.fromJSDate(d, { zone: VENUE_TZ })`. Keeping this in one
 * place prevents the "server timezone" / "booked slot still bookable" class of
 * bugs that come from parsing in the process-local zone.
 */
export const VENUE_TZ = 'Asia/Kolkata';
