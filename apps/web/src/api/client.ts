import {
  AuthTokens,
  BookingFilters,
  BookingResponse,
  BookingStatus,
  Branding,
  CalendarResponse,
  CreateBookingRequest,
  CreateCustomerRequest,
  LoginResponse,
  OpenMatchRepaymentMode,
  OwnerBooking,
  PayMode,
  PaymentStatus,
  PlayerSummary,
} from '@sportsbooking/shared';

const BASE = '/api';

export interface DiscoverVenue {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  openTime: string;
  closeTime: string;
  ownerId: string;
  branding: {
    logoUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
  };
  games: { id: string; name: string }[];
  units: { id: string; name: string; label: string; gameId: string; capacity: number }[];
  /** Lowest configured hourly price across bookable units; null if none set. */
  minPrice?: number | null;
  /** Venue gallery photo URLs (empty array if none stored). */
  photos?: string[];
  /** Venue latitude; null when not geocoded. */
  geoLat?: number | null;
  /** Venue longitude; null when not geocoded. */
  geoLng?: number | null;
  /**
   * Great-circle distance (km) from the supplied lat/lng origin. Only present
   * when discoverVenues is called with both lat & lng; null for venues missing
   * coordinates.
   */
  distanceKm?: number | null;
}

/**
 * Optional discovery filters (GET /discover/venues). All fields are optional and
 * serialized to query params; calling discoverVenues with no opts preserves the
 * original behavior. `lat`+`lng` enable distance sorting; `radiusKm` filters to a
 * radius; `limit`/`offset` paginate.
 */
export interface DiscoverVenuesOptions {
  city?: string;
  gameId?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  limit?: number;
  offset?: number;
}

/** Owner's own venue (GET /venues) with units, for the offline booking flow. */
export interface OwnerVenue {
  id: string;
  name: string;
  city: string | null;
  openTime: string;
  closeTime: string;
  units: { id: string; name: string; label: string; gameId: string; capacity: number }[];
}

export interface Pack {
  id: string;
  name: string;
  sessions: number;
  price: string | number;
  pricingMode: string;
  discountPct: string | number | null;
  expiryMode: string;
}

export interface WalletSummary {
  balances: Record<string, number>;
  history: {
    type: string;
    lane: string;
    amount: number;
    balanceAfter: number;
    note: string | null;
    at: string;
  }[];
}

export interface OwnerReport {
  /** Echoed date-range window (ISO strings); null bound = unbounded. */
  range?: { from: string | null; to: string | null };
  bookings: { total: number; cancelled: number };
  revenue: number;
  bookedSlots: number;
  membership: { packsSold: number; outstandingSessions: number };
  addonRevenue: number;
  players: number;
  /** Booked slots ÷ available capacity over the range (0–100). */
  occupancyPct?: number;
  /** Busiest hour-of-day as "HH:00", or null when there are no bookings. */
  peakHour?: string | null;
  /** Per-hour booking counts (24 entries) for charting. */
  hourHistogram?: { hour: string; count: number }[];
  loyalty?: { earned: number; redeemed: number };
  referral?: { referrals: number; rewardsPaid: number };
  offers?: { redemptions: number; discountTotal: number };
  tournaments?: { count: number; participants: number; feeRevenue: number };
  /** % of the owner's customers with more than one booking (0–100). */
  repeatRatePct?: number;
  perVenue: {
    venueId: string;
    /** Joined venue name; null if the venue was deleted. */
    venueName?: string | null;
    revenue: number;
    bookings: number;
  }[];
}

/** Platform-wide aggregate (GET /reports/platform). */
export interface PlatformReport {
  range?: { from: string | null; to: string | null };
  owners: number;
  venues: number;
  bookings: number;
  grossRevenue: number;
  occupancyPct?: number;
  repeatRatePct?: number;
  loyalty?: { earned: number; redeemed: number };
  offers?: { redemptions: number; discountTotal: number };
}

/** A slot within a customer's own booking (GET /bookings/mine). */
export interface CustomerBookingSlot {
  unitId: string;
  unitName: string;
  start: string;
  end: string;
}

/** A customer's own booking (GET /bookings/mine) — mirrors the API shape. */
export interface CustomerBooking {
  id: string;
  status: BookingStatus;
  payMode: PayMode;
  paymentStatus: PaymentStatus;
  total: number;
  venueId: string;
  venueName: string;
  slots: CustomerBookingSlot[];
  createdAt: string;
}

/** A pending/decided request to join an open match (host-facing view). */
export interface JoinRequest {
  id: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  player: { id: string; name: string | null };
}

/**
 * Customer-facing projection of an open match (GET /open-matches),
 * mirroring the API's browse view (host, venue/court/game, time, spots, fee).
 */
export interface OpenMatch {
  id: string;
  status: string;
  createdAt: string;
  skillMin: string;
  skillMax: string;
  host: { id: string; name: string | null };
  venue: { id: string; name: string; city: string | null } | null;
  court: { id: string; name: string } | null;
  game: { id: string; name: string } | null;
  time: { startsAt: string; endsAt: string } | null;
  spots: { total: number; filled: number; remaining: number };
  fee: { repaymentMode: string; bookingTotal: string | number; perPlayer: string | number };
}

/** A venue's policy/loyalty settings (GET /venues/:id/settings). */
export interface VenueSettings {
  venueId: string;
  cancellationTemplate: 'flexible' | 'moderate' | 'strict';
  noShowFee: number;
  /** Per-venue override; null = use owner default. */
  loyaltyEarnRate: number | null;
  /** Per-venue override; null = use owner default. */
  loyaltyRedeemValue: number | null;
  openMatchRepaymentMode: OpenMatchRepaymentMode;
  /**
   * Human-readable summary of the active template's free window / penalty,
   * e.g. "Free cancellation up to 4h before; 50% penalty after". Null for an
   * unknown template. Matches the string returned by the API.
   */
  cancellationTemplateHelp: string | null;
}

/** Partial update of a venue's settings (PUT /venues/:id/settings). */
export interface VenueSettingsInput {
  cancellationTemplate?: 'flexible' | 'moderate' | 'strict';
  noShowFee?: number;
  loyaltyEarnRate?: number;
  loyaltyRedeemValue?: number;
  openMatchRepaymentMode?: OpenMatchRepaymentMode;
}

/** A single row in a CRM bulk-import payload (POST /players/bulk). */
export interface BulkAddPlayerInput {
  name: string;
  mobile: string;
  consent: boolean;
}

/** Per-row outcome from a CRM bulk import. */
export interface BulkAddRowResult {
  mobile: string;
  ok: boolean;
  customerId?: string;
  error?: string;
}

/** Aggregate result of POST /players/bulk. */
export interface BulkAddResult {
  results: BulkAddRowResult[];
  added: number;
  failed: number;
}

/** DPDP consent / opt-out write for a CRM link (PATCH /players/:id/consent). */
export interface PlayerConsentInput {
  optedOut?: boolean;
  consent?: boolean;
}

/** White-label branding for a new owner (super-admin onboarding). */
export interface OwnerBrandingInput {
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
}

/** Onboarding payload for creating an owner (POST /super-admin/owners). */
export interface CreateOwnerInput {
  name: string;
  contactEmail: string;
  contactMobile?: string;
  adminPassword: string;
  venueQuota: number;
  allowedGameIds?: string[];
  featureFlags: string[];
  branding?: OwnerBrandingInput;
  setupFee?: number;
  amcAmount?: number;
  amcRenewalDate?: string;
}

/** Owner-scoped staff user (GET /staff). Never carries a password hash. */
export interface StaffSummary {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
  assignedVenueIds: string[];
}

/** Create a venue-scoped staff login (POST /staff). */
export interface CreateStaffInput {
  name: string;
  email: string;
  password: string;
  assignedVenueIds: string[];
}

/** Partial update of a staff user (PATCH /staff/:id). */
export interface UpdateStaffInput {
  name?: string;
  assignedVenueIds?: string[];
  active?: boolean;
}

/** Outcome of a CRM marketing broadcast (POST /players/broadcast). */
export interface BroadcastResult {
  sent: number;
  skipped: number;
}

/** A venue add-on (GET /venues/:venueId/addons). */
export interface Addon {
  id: string;
  ownerId: string;
  venueId: string;
  name: string;
  type: string;
  price: string | number;
  stock: number | null;
  active: boolean;
}

/** In-app notification kinds, mirroring the API NotificationType enum. */
export type NotificationFeedType =
  | 'booking_created'
  | 'booking_cancelled'
  | 'tournament_registration'
  | 'open_match_join'
  | 'amc_reminder'
  | 'general';

/** A single notification in the owner/staff bell feed (GET /notifications). */
export interface NotificationItem {
  id: string;
  type: NotificationFeedType;
  title: string;
  body: string | null;
  /** In-app route to open when the notification is clicked; null if none. */
  link: string | null;
  /** ISO timestamp the notification was read, or null while unread. */
  readAt: string | null;
  createdAt: string;
}

/** The bell feed response: recent items plus the unread count. */
export interface NotificationFeed {
  items: NotificationItem[];
  unread: number;
}

/** A single audit-trail entry (GET /audit-logs). */
export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorName: string | null;
  actorRole: string;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: { method?: string; path?: string } | null;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditLogParams {
  action?: string;
  entity?: string;
  page?: number;
  pageSize?: number;
}

/** A tournament fixture match (knockout bracket node or round-robin pairing). */
export interface FixtureMatch {
  id: string;
  round: number;
  position: number;
  participantAId: string | null;
  participantBId: string | null;
  aLabel: string | null;
  bLabel: string | null;
  scoreA: number | null;
  scoreB: number | null;
  winnerId: string | null;
  status: 'pending' | 'completed';
}

export interface FixtureStanding {
  participantId: string;
  label: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
}

export interface FixtureBoard {
  format: string;
  generated: boolean;
  rounds: number;
  matches: FixtureMatch[];
  standings: FixtureStanding[];
}

/** A gateway transaction (capture or refund) from the payments ledger. */
export interface PaymentTxn {
  id: string;
  refType: string;
  refId: string;
  type: 'capture' | 'refund';
  gatewayId: string | null;
  amount: string;
  fee: string;
  status: string;
  note: string | null;
  createdAt: string;
}

/** A venue hit in the global search (GET /search). */
export interface SearchVenueResult {
  id: string;
  name: string;
  city: string | null;
}

/** A player hit in the global search (GET /search). */
export interface SearchPlayerResult {
  customerId: string;
  name: string | null;
  mobile: string | null;
}

/** A tournament hit in the global search (GET /search). */
export interface SearchTournamentResult {
  id: string;
  name: string;
}

/** A booking hit in the global search (GET /search). */
export interface SearchBookingResult {
  id: string;
  customerName: string | null;
  venueName: string | null;
  /** ISO start time of the booking's earliest slot, or null. */
  startsAt: string | null;
  status: string;
}

/** Grouped results from the owner/staff global search (GET /search). */
export interface SearchResults {
  venues: SearchVenueResult[];
  players: SearchPlayerResult[];
  tournaments: SearchTournamentResult[];
  bookings: SearchBookingResult[];
}

// ---------------------------------------------------------------------------
// Grounds revamp (owner) — paginated list, detail, overview, schedule,
// unblock, bulk pricing. All owner/staff-scoped (GET /venues/list, /venues/:id,
// /venues/:id/overview, /venues/:id/schedule, POST /venues/unblock,
// /venues/:id/bulk-pricing). These are ADDITIVE; the legacy array-form
// GET /venues (api.listVenues) is unchanged.
// ---------------------------------------------------------------------------

/** Derived display status for a ground card (GET /venues/list). */
export type VenueStatus = 'active' | 'inactive' | 'draft' | 'needs_setup';

/** Filters for the paginated grounds list (GET /venues/list). All optional. */
export interface ListVenuesPageParams {
  /** Free-text match on venue name/city (ilike). */
  q?: string;
  city?: string;
  gameId?: string;
  status?: VenueStatus;
  /** 1-based page number (defaults server-side to 1). */
  page?: number;
  /** Items per page (defaults server-side to 20). */
  pageSize?: number;
}

/** One row in the paginated grounds list (GET /venues/list). */
export interface VenueListItem {
  id: string;
  name: string;
  city: string | null;
  status: VenueStatus;
  /** Total bookable units (courts) attached to the venue. */
  courtCount: number;
  /** Best-effort occupancy over the next 7 days (0–100). */
  occupancyPct: number;
}

/** Paginated grounds list envelope (GET /venues/list). */
export interface VenueListPage {
  items: VenueListItem[];
  /**
   * Broad match count for the query. For derived status sub-filters
   * (draft/needs_setup) this stays the unfiltered count; items are filtered
   * per-page (mirrors the API's best-effort behavior).
   */
  total: number;
}

/** A bookable unit (court) on the shaped detail venue (GET /venues/:id). */
export interface VenueDetailUnit {
  id: string;
  venueId: string;
  ownerId: string;
  name: string;
  label: string;
  gameId: string;
  capacity: number;
  active: boolean;
}

/** A game offered by the venue, on the shaped detail venue (GET /venues/:id). */
export interface VenueDetailGame {
  venueId: string;
  gameId: string;
}

/** Raw per-venue settings row on the shaped detail venue (GET /venues/:id). */
export interface VenueDetailSettings {
  venueId: string;
  cancellationTemplate: 'flexible' | 'moderate' | 'strict';
  noShowFee: string | number;
  loyaltyEarnRate: string | number | null;
  loyaltyRedeemValue: string | number | null;
  openMatchRepaymentMode: OpenMatchRepaymentMode;
}

/**
 * Single shaped venue for the Grounds detail page (GET /venues/:id). The API's
 * shapeVenue() maps Drizzle relation keys (bookableUnits/venueGames/
 * venueSettings) onto the web contract (units/games/settings).
 */
export interface VenueDetail {
  id: string;
  ownerId: string;
  name: string;
  city: string | null;
  address: string | null;
  contactPhone: string | null;
  openTime: string;
  closeTime: string;
  geoLat: number | null;
  geoLng: number | null;
  photos: string[] | null;
  active: boolean;
  createdAt: string;
  units: VenueDetailUnit[];
  games: VenueDetailGame[];
  /** Per-venue settings row, or null when none has been created yet. */
  settings: VenueDetailSettings | null;
}

/** Headline metrics for a ground's detail page (GET /venues/:id/overview). */
export interface VenueOverview {
  courtCount: number;
  bookingsThisWeek: number;
  revenueThisWeek: number;
  /** Best-effort occupancy over the next 7 days (0–100). */
  occupancyPct: number;
}

/** One cell in a court's day schedule (GET /venues/:id/schedule). */
export interface VenueScheduleSlot {
  /** ISO-8601 start time. */
  start: string;
  /** ISO-8601 end time. */
  end: string;
  status: 'free' | 'booked' | 'blocked';
  /** Present only for booked cells backed by a booking. */
  bookingId?: string;
}

/** One court row in a ground's day schedule (GET /venues/:id/schedule). */
export interface VenueScheduleCourt {
  id: string;
  name: string;
  slots: VenueScheduleSlot[];
}

/** Per-court hourly slot grid for a ground on a day (GET /venues/:id/schedule). */
export interface VenueSchedule {
  openTime: string;
  closeTime: string;
  courts: VenueScheduleCourt[];
}

/** Free blocked slots in a range for an owner's unit (POST /venues/unblock). */
export interface UnblockSlotsInput {
  unitId: string;
  /** ISO-8601 timestamp */
  start: string;
  /** ISO-8601 timestamp */
  end: string;
}

/**
 * One pricing-grid rule for the bulk-pricing apply (POST /venues/:id/
 * bulk-pricing). Mirrors the API PricingRuleDto: all scope fields optional,
 * price required.
 */
export interface BulkPricingRule {
  dayType?: string;
  timeBand?: string;
  /** ISO-8601 date override (specific calendar day). */
  dateOverride?: string;
  minDuration?: number;
  price: number;
}

/** Apply one pricing grid to many courts of a ground (POST /venues/:id/bulk-pricing). */
export interface BulkPricingInput {
  unitIds: string[];
  rules: BulkPricingRule[];
}

/** Block a court for maintenance / private use (POST /venues/block). */
export interface BlockSlotsInput {
  unitId: string;
  /** ISO-8601 timestamp */
  start: string;
  /** ISO-8601 timestamp */
  end: string;
  reason?: string;
}

/**
 * Super-admin patch of an owner (PATCH /super-admin/owners/:id). Every field is
 * optional; only provided fields are updated.
 */
export interface UpdateOwnerInput {
  venueQuota?: number;
  allowedGameIds?: string[];
  featureFlags?: string[];
  branding?: OwnerBrandingInput;
  setupFee?: number;
  amcAmount?: number;
  /** ISO date string, or null to clear. */
  amcRenewalDate?: string | null;
}

/**
 * Create/update offer payload (POST /offers, PATCH /offers/:id). Carries the
 * validity window (validFrom/validTo), venue/game scope, and CRM segment when
 * the backend supports them (offers.module dto).
 */
export interface OfferInput {
  name?: string;
  type?: string;
  value?: number;
  code?: string;
  autoApply?: boolean;
  active?: boolean;
  /** ISO-8601 validity window bounds. */
  validFrom?: string;
  validTo?: string;
  venueIds?: string[];
  gameIds?: string[];
  segment?: string;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('accessToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Drop stored tokens; the next guarded route will bounce to /login. */
function clearTokens(): void {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

/**
 * Auth paths that must NEVER trigger the 401 auto-refresh: refreshing on a
 * failed login/refresh would loop forever. (logout/password endpoints are also
 * excluded — a 401 there is meaningful, not a stale-access-token signal.)
 */
const NO_REFRESH_PATHS = ['/auth/refresh', '/auth/login'];

/**
 * Shared in-flight refresh promise so concurrent 401s collapse into a single
 * POST /auth/refresh. Resolves to true on success (tokens stored), false on
 * failure (tokens cleared). Reset to null once settled.
 */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Rotate the stored refresh token into a fresh access (+ refresh) token via
 * POST /auth/refresh. Single-flight: concurrent callers await the same promise.
 * Returns false (and clears tokens) when no refresh token exists or the call
 * fails, so the caller lets the original 401 propagate.
 */
function refreshTokens(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) {
      clearTokens();
      return false;
    }
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        clearTokens();
        return false;
      }
      const tokens = (await res.json()) as AuthTokens;
      localStorage.setItem('accessToken', tokens.accessToken);
      localStorage.setItem('refreshToken', tokens.refreshToken);
      return true;
    } catch {
      clearTokens();
      return false;
    }
  })();

  // Clear the latch once settled so a later 401 can refresh again.
  void refreshInFlight.finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const doFetch = () =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(init?.headers ?? {}),
      },
    });

  let res = await doFetch();

  // On a 401 (stale access token), try a single shared refresh + one retry.
  // Skip auth endpoints whose own 401 must not loop into a refresh.
  if (
    res.status === 401 &&
    !NO_REFRESH_PATHS.includes(path) &&
    localStorage.getItem('refreshToken')
  ) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      res = await doFetch();
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new Error(msg ?? `Request failed: ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
const put = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
const patch = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });
const get = <T>(path: string) => request<T>(path);

/**
 * Multipart file upload. Unlike `request`, it must NOT set Content-Type — the
 * browser sets multipart/form-data with the boundary. Reuses the auth header and
 * the single-retry-on-401 refresh flow. The FormData is rebuilt per attempt
 * because its body stream is consumed on the first send.
 */
async function uploadFile<T>(path: string, file: File): Promise<T> {
  const doFetch = () => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch(`${BASE}${path}`, {
      method: 'POST',
      body: fd,
      headers: { ...authHeaders() },
    });
  };
  let res = await doFetch();
  if (res.status === 401 && localStorage.getItem('refreshToken')) {
    const refreshed = await refreshTokens();
    if (refreshed) res = await doFetch();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = Array.isArray(body.message)
      ? body.message.join(', ')
      : body.message;
    throw new Error(msg ?? `Upload failed: ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Build an optional `?from=&to=` query string for report endpoints. */
function rangeQs(from?: string, to?: string): string {
  const qs = new URLSearchParams();
  if (from) qs.append('from', from);
  if (to) qs.append('to', to);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const api = {
  // ---- auth ----
  requestOtp: (mobile: string) => post<{ sent: boolean }>('/auth/otp/request', { mobile }),
  verifyOtp: (mobile: string, code: string, name?: string) =>
    post<LoginResponse>('/auth/otp/verify', { mobile, code, name, consent: true }),
  staffLogin: (email: string, password: string) =>
    post<LoginResponse>('/auth/login', { email, password }),
  // Owner/staff/admin self-service password (customers are OTP-only).
  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ updated: true }>('/auth/password', { currentPassword, newPassword }),
  // Forgot-password: always resolves to a neutral { sent: true } (never reveals
  // whether the email matched an account).
  requestPasswordReset: (email: string) =>
    post<{ sent: true }>('/auth/password/reset-request', { email }),
  resetPassword: (token: string, newPassword: string) =>
    post<{ updated: true }>('/auth/password/reset', { token, newPassword }),

  // ---- auth lifecycle ----
  /** Rotate the stored refresh token into fresh tokens (manual trigger). */
  refresh: (refreshToken: string) =>
    post<AuthTokens>('/auth/refresh', { refreshToken }),
  /** Revoke the stored refresh token server-side (logout). */
  logout: (refreshToken: string) =>
    post<{ revoked: true }>('/auth/logout', { refreshToken }),

  // ---- discovery / booking (customer) ----
  /**
   * Browse venues across owners. All filters are optional; calling with no args
   * returns the full active-venue list (unchanged behavior). Passing `lat`+`lng`
   * attaches `distanceKm` and sorts nearest-first; `radiusKm` restricts to a
   * radius; `limit`/`offset` paginate.
   */
  discoverVenues: (opts?: DiscoverVenuesOptions) => {
    const qs = new URLSearchParams();
    if (opts) {
      const { city, gameId, lat, lng, radiusKm, limit, offset } = opts;
      if (city) qs.append('city', city);
      if (gameId) qs.append('gameId', gameId);
      if (lat !== undefined) qs.append('lat', String(lat));
      if (lng !== undefined) qs.append('lng', String(lng));
      if (radiusKm !== undefined) qs.append('radiusKm', String(radiusKm));
      if (limit !== undefined) qs.append('limit', String(limit));
      if (offset !== undefined) qs.append('offset', String(offset));
    }
    const s = qs.toString();
    return get<DiscoverVenue[]>(`/discover/venues${s ? `?${s}` : ''}`);
  },
  discoverGames: () => get<any[]>('/discover/games'),
  availability: (unitId: string, date: string) =>
    get<CalendarResponse>(`/availability?unitId=${unitId}&date=${date}`),
  createBooking: (payload: CreateBookingRequest) =>
    post<BookingResponse>('/bookings', payload),
  cancelBooking: (id: string) => post<{ cancelled: true }>(`/bookings/${id}/cancel`),
  myBookings: () => get<CustomerBooking[]>('/bookings/mine'),

  // ---- memberships / wallet / referral (customer) ----
  listOwnerPacks: (ownerId: string) => get<Pack[]>(`/owners/${ownerId}/packs`),
  purchasePack: (ownerId: string, packId: string) =>
    post<{ packId: string; sessionsAdded: number; balance: number }>(
      `/owners/${ownerId}/packs/${packId}/purchase`,
    ),
  wallet: (ownerId: string) => get<WalletSummary>(`/owners/${ownerId}/wallet`),
  referralCode: (ownerId: string) => get<{ code: string }>(`/referral/code/${ownerId}`),
  updateProfile: (ownerId: string, body: { skillLevel?: string; games?: string[] }) =>
    put(`/owners/${ownerId}/profile`, body),

  // ---- tournaments ----
  listTournaments: (venueId: string) => get<any[]>(`/tournaments/venue/${venueId}`),
  // Owner back-office: tournaments WITH participant detail for cancel/refund.
  listOwnerTournaments: (venueId: string) =>
    get<any[]>(`/tournaments/manage/venue/${venueId}`),
  registerTournament: (
    id: string,
    body: {
      captainName: string;
      captainMobile: string;
      teamName?: string;
      roster?: string[];
    },
  ) => post<{ participantId: string; razorpayOrderId: string; fee: number }>(
    `/tournaments/${id}/register`,
    body,
  ),
  // Owner back-office: tournament fixtures / bracket.
  getFixtures: (id: string) => get<FixtureBoard>(`/tournaments/${id}/fixtures`),
  generateFixtures: (id: string) =>
    post<FixtureBoard>(`/tournaments/${id}/fixtures`),
  clearFixtures: (id: string) => del<FixtureBoard>(`/tournaments/${id}/fixtures`),
  recordMatchResult: (
    id: string,
    matchId: string,
    body: { scoreA: number; scoreB: number },
  ) =>
    post<FixtureBoard>(`/tournaments/${id}/matches/${matchId}/result`, body),
  cancelTournamentRegistration: (tournamentId: string, participantId: string) =>
    post<{ cancelled: true; refunded: boolean }>(
      `/tournaments/${tournamentId}/participants/${participantId}/cancel`,
    ),

  // ---- owner ----
  ownerReport: (from?: string, to?: string) =>
    get<OwnerReport>(`/reports/owner${rangeQs(from, to)}`),
  listVenues: () => get<any[]>('/venues'),

  // ---- owner: grounds revamp ----
  /**
   * Paginated/filterable grounds list (GET /venues/list). Distinct from the
   * legacy array-form listVenues(); returns { items, total }. All params
   * optional and serialized to query string.
   */
  listVenuesPage: (params: ListVenuesPageParams = {}) => {
    const qs = new URLSearchParams();
    const { q, city, gameId, status, page, pageSize } = params;
    if (q) qs.append('q', q);
    if (city) qs.append('city', city);
    if (gameId) qs.append('gameId', gameId);
    if (status) qs.append('status', status);
    if (page !== undefined) qs.append('page', String(page));
    if (pageSize !== undefined) qs.append('pageSize', String(pageSize));
    const s = qs.toString();
    return get<VenueListPage>(`/venues/list${s ? `?${s}` : ''}`);
  },
  /** Single shaped venue (units/games/settings) for the detail page. */
  getVenue: (id: string) => get<VenueDetail>(`/venues/${id}`),
  /** Headline metrics for a ground's detail page. */
  venueOverview: (id: string) => get<VenueOverview>(`/venues/${id}/overview`),
  /** Per-court hourly slot grid for a ground on a given day (YYYY-MM-DD). */
  venueSchedule: (id: string, date: string) =>
    get<VenueSchedule>(`/venues/${id}/schedule?date=${encodeURIComponent(date)}`),
  /** Free blocked slots in a range for an owner's unit. */
  unblockSlots: (body: UnblockSlotsInput) =>
    post<{ unblocked: number }>('/venues/unblock', body),
  /** Apply one pricing grid to multiple courts of a ground. */
  bulkPricing: (venueId: string, body: BulkPricingInput) =>
    post<{ updatedUnits: number }>(`/venues/${venueId}/bulk-pricing`, body),

  createVenue: (body: unknown) => post('/venues', body),
  updateVenue: (venueId: string, body: unknown) => patch(`/venues/${venueId}`, body),
  deleteVenue: (venueId: string) => del(`/venues/${venueId}`),
  addUnit: (venueId: string, body: unknown) => post(`/venues/${venueId}/units`, body),
  updateUnit: (unitId: string, body: unknown) => patch(`/venues/units/${unitId}`, body),
  deleteUnit: (unitId: string) => del(`/venues/units/${unitId}`),
  setPricing: (unitId: string, rules: unknown[]) => put(`/venues/units/${unitId}/pricing`, rules),
  getVenueSettings: (venueId: string) => get<VenueSettings>(`/venues/${venueId}/settings`),
  updateVenueSettings: (venueId: string, body: VenueSettingsInput) =>
    put<VenueSettings>(`/venues/${venueId}/settings`, body),
  createPack: (body: unknown) => post('/packs', body),
  listPacks: () => get<Pack[]>('/packs'),
  updatePack: (packId: string, body: unknown) => patch(`/packs/${packId}`, body),
  deactivatePack: (packId: string) => del(`/packs/${packId}`),
  createOffer: (body: OfferInput) => post('/offers', body),
  listOffers: () => get<any[]>('/offers'),
  updateOffer: (id: string, body: OfferInput) => patch(`/offers/${id}`, body),
  deleteOffer: (id: string, hard = false) =>
    del(`/offers/${id}${hard ? '?hard=true' : ''}`),
  createAddon: (venueId: string, body: unknown) => post(`/venues/${venueId}/addons`, body),
  /** Active add-ons for a venue — owner add-on management + customer checkout. */
  listAddons: (venueId: string) => get<Addon[]>(`/venues/${venueId}/addons`),
  updateAddon: (addonId: string, body: unknown) => patch(`/addons/${addonId}`, body),
  deleteAddon: (addonId: string) => del(`/addons/${addonId}`),
  listPlayers: (segment?: string) =>
    get<PlayerSummary[]>(`/players${segment ? `?segment=${segment}` : ''}`),
  addCustomer: (body: CreateCustomerRequest) => post<PlayerSummary>('/players', body),
  /** Owner/staff bulk CRM import — one bad row never aborts the batch. */
  bulkAddPlayers: (customers: BulkAddPlayerInput[]) =>
    post<BulkAddResult>('/players/bulk', { customers }),
  /** DPDP consent / opt-out write for one owned CRM link. */
  setPlayerConsent: (customerId: string, body: PlayerConsentInput) =>
    patch<PlayerSummary>(`/players/${customerId}/consent`, body),
  /** Fan a marketing message out to a CRM segment (consented contacts only). */
  broadcastPlayers: (segment: string | undefined, message: string) =>
    post<BroadcastResult>('/players/broadcast', { segment, message }),

  // ---- owner: staff management ----
  /** List this owner's venue-scoped staff users. */
  listStaff: () => get<StaffSummary[]>('/staff'),
  createStaff: (body: CreateStaffInput) => post<StaffSummary>('/staff', body),
  updateStaff: (id: string, body: UpdateStaffInput) =>
    patch<StaffSummary>(`/staff/${id}`, body),
  /** Soft-deactivate a staff user (active=false). */
  deactivateStaff: (id: string) => post<StaffSummary>(`/staff/${id}/deactivate`),

  // ---- owner: court blocking ----
  /** Block a court window for maintenance / private use. */
  blockSlots: (body: BlockSlotsInput) => post('/venues/block', body),
  createTournament: (body: unknown) => post('/tournaments', body),
  settleBooking: (id: string) => post(`/bookings/${id}/settle`),

  // ---- owner: branding (white-label) ----
  getBranding: () => get<Branding>('/me/branding'),
  updateBranding: (body: Partial<Branding>) => put<Branding>('/me/branding', body),
  /** Upload a logo image (multipart); stores it and returns the updated branding. */
  uploadLogo: (file: File) => uploadFile<Branding>('/me/branding/logo', file),

  // ---- owner: booking management ----
  listBookings: (filters: BookingFilters = {}) => {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v) qs.append(k, String(v));
    });
    const s = qs.toString();
    return get<OwnerBooking[]>(`/bookings${s ? `?${s}` : ''}`);
  },
  updateBookingStatus: (id: string, status: BookingStatus) =>
    post<{ status: BookingStatus }>(`/bookings/${id}/status`, { status }),
  rescheduleBooking: (
    id: string,
    slots: { unitId: string; start: string; end: string }[],
  ) => post<{ rescheduled: true }>(`/bookings/${id}/reschedule`, { slots }),
  updateBookingCustomer: (id: string, body: { name: string; mobile: string }) =>
    post<{ name: string; mobile: string }>(`/bookings/${id}/customer`, body),

  // ---- owner: notification feed (bell) ----
  /** Owner/staff in-app bell feed (recent items + unread count). */
  listNotifications: () => get<NotificationFeed>('/notifications'),
  /** Owner audit trail (GET /audit-logs), filterable + paginated. */
  listAuditLogs: (params: AuditLogParams = {}) => {
    const qs = new URLSearchParams();
    if (params.action) qs.append('action', params.action);
    if (params.entity) qs.append('entity', params.entity);
    if (params.page !== undefined) qs.append('page', String(params.page));
    if (params.pageSize !== undefined)
      qs.append('pageSize', String(params.pageSize));
    const s = qs.toString();
    return get<AuditLogPage>(`/audit-logs${s ? `?${s}` : ''}`);
  },
  /** Distinct entity labels for the audit-log filter dropdown. */
  auditLogEntities: () => get<string[]>('/audit-logs/entities'),
  /** Gateway transactions (captures + refunds) for a booking/participant. */
  listPayments: (refType: string, refId: string) =>
    get<PaymentTxn[]>(
      `/payments?refType=${encodeURIComponent(refType)}&refId=${encodeURIComponent(refId)}`,
    ),
  /** Mark a single notification read. */
  markNotificationRead: (id: string) =>
    post<void>(`/notifications/${id}/read`),
  /** Mark every unread notification read. */
  markAllNotificationsRead: () => post<void>('/notifications/read-all'),

  // ---- owner: global search ----
  /** Owner/staff quick-search across venues, players, tournaments, bookings. */
  search: (q: string) =>
    get<SearchResults>(`/search?q=${encodeURIComponent(q)}`),

  // ---- open matches / find players (customer) ----
  listOpenMatches: (venueId?: string) =>
    get<OpenMatch[]>(
      `/open-matches${venueId ? `?venueId=${encodeURIComponent(venueId)}` : ''}`,
    ),
  myOpenMatches: () =>
    get<{
      hosting: (OpenMatch & { pendingRequests: JoinRequest[] })[];
      joined: {
        requestId: string;
        status: JoinRequest['status'];
        requestedAt: string;
        match: OpenMatch;
      }[];
    }>('/open-matches/mine'),
  createOpenMatch: (body: {
    bookingId: string;
    openSpots: number;
    skillMin?: string;
    skillMax?: string;
  }) => post<OpenMatch>('/open-matches', body),
  joinOpenMatch: (id: string, body?: unknown) =>
    post<{ id: string; status: JoinRequest['status'] }>(
      `/open-matches/${id}/join`,
      body,
    ),
  approveJoinRequest: (matchId: string, requestId: string) =>
    post<{ approved: true; spotsFilled: number; openSpots: number }>(
      `/open-matches/${matchId}/requests/${requestId}/approve`,
    ),
  rejectJoinRequest: (matchId: string, requestId: string) =>
    post<{ rejected: true; changed: boolean }>(
      `/open-matches/${matchId}/requests/${requestId}/reject`,
    ),
  cancelOpenMatch: (id: string) =>
    post<{ cancelled: true }>(`/open-matches/${id}/cancel`),

  // ---- super admin ----
  listGames: () => get<any[]>('/super-admin/games'),
  createGame: (body: unknown) => post('/super-admin/games', body),
  updateGame: (id: string, body: unknown) => patch(`/super-admin/games/${id}`, body),
  deleteGame: (id: string) => del(`/super-admin/games/${id}`),
  listOwners: () => get<any[]>('/super-admin/owners'),
  createOwner: (body: CreateOwnerInput) => post('/super-admin/owners', body),
  /** Patch an owner's quota / flags / branding / billing (only provided fields). */
  updateOwner: (id: string, body: UpdateOwnerInput) =>
    patch<any>(`/super-admin/owners/${id}`, body),
  platformReport: (from?: string, to?: string) =>
    get<PlatformReport>(`/reports/platform${rangeQs(from, to)}`),
  runAmc: () =>
    post<{ reminded: string[]; suspended: string[]; wouldSuspend: string[] }>(
      '/super-admin/amc/run',
    ),
};
