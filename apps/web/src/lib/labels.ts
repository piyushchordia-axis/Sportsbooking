/**
 * Friendly display labels for backend enum strings. The API returns raw
 * snake_case / lowercase enum values (e.g. `round_robin`, `advanced_beginner`,
 * `awaiting_venue_settlement`); never show those to players — wrap them in
 * `label()`. Curated overrides win; anything else falls back to sentence-case.
 */
const LABELS: Record<string, string> = {
  // Skill levels
  beginner: 'Beginner',
  advanced_beginner: 'Advanced beginner',
  advanced: 'Advanced',
  pro: 'Pro',
  // Tournament format
  knockout: 'Knockout',
  league: 'League',
  round_robin: 'Round-robin',
  // Registration type / fee basis
  solo: 'Solo',
  team: 'Team',
  per_player: 'Per player',
  per_team: 'Per team',
  // Payment status
  pending: 'Pending',
  paid: 'Paid',
  awaiting_venue_settlement: 'Awaiting venue',
  settled_at_venue: 'Settled at venue',
  refunded: 'Refunded',
  failed: 'Failed',
  // Booking status
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  completed: 'Completed',
  no_show: 'No-show',
  // Open-match repayment mode
  info: 'Info only',
  ledger: 'Ledger-settled',
};

/** Map a raw enum value to a player-friendly label. */
export function label(value?: string | null): string {
  if (!value) return '';
  const key = String(value).toLowerCase();
  if (LABELS[key]) return LABELS[key];
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A skill range like "Beginner–Advanced" (or a single level). */
export function skillRange(min?: string | null, max?: string | null): string {
  const a = label(min);
  const b = label(max);
  if (a && b && a !== b) return `${a}–${b}`;
  return a || b;
}
