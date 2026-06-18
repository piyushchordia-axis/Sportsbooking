/**
 * Imagery resolver: maps app entities to on-brand static assets served from the
 * web app's `public/` directory, with graceful fallbacks so a record that lacks
 * a stored image (e.g. an owner-created venue with no `photos`) still renders a
 * tasteful placeholder rather than a broken image.
 *
 * Data-driven URLs that the API already returns (game `iconUrl`,
 * owner `branding.logoUrl`) are preferred by callers; this module supplies the
 * sport-derived defaults used everywhere else.
 */

export type SportKey = 'pickleball' | 'badminton' | 'cricket' | 'football' | 'generic';

/** Best-effort sport classification from a free-text game name. */
export function sportKey(name?: string | null): SportKey {
  const n = (name ?? '').toLowerCase();
  if (n.includes('pickle')) return 'pickleball';
  if (n.includes('badminton')) return 'badminton';
  if (n.includes('cricket')) return 'cricket';
  if (n.includes('football') || n.includes('soccer') || n.includes('futsal') || n.includes('turf'))
    return 'football';
  return 'generic';
}

/** Line-art sport icon (matches the Lucide icon language, inherits color). */
export function sportIcon(name?: string | null): string {
  return `/images/sports/${sportKey(name)}.svg`;
}

const VENUE_PHOTOS: Record<SportKey, string> = {
  pickleball: '/images/venues/pickleball.jpg',
  badminton: '/images/venues/badminton.jpg',
  cricket: '/images/venues/box-cricket.jpg',
  football: '/images/venues/turf-football.jpg',
  generic: '/images/venues/generic.jpg',
};

export const FALLBACK_VENUE_PHOTO = VENUE_PHOTOS.generic;

/** Resolve a venue's hero photo: an explicit stored photo wins, else sport-derived. */
export function venuePhoto(opts: {
  photos?: string[] | null;
  games?: { name: string }[] | null;
}): string {
  const explicit = opts.photos?.find(Boolean);
  if (explicit) return explicit;
  return VENUE_PHOTOS[sportKey(opts.games?.[0]?.name)];
}

/** Tournament banner derived from the sport it is played in. */
export function tournamentBanner(sportName?: string | null): string {
  return VENUE_PHOTOS[sportKey(sportName)];
}

export const HERO_IMAGE = '/images/hero.jpg';
export const EMPTY_GENERIC = '/images/empty/generic.png';
export const EMPTY_TROPHY = '/images/empty/trophy.png';

/** Up-to-two-letter monogram for owners without a logo. */
export function initials(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}
