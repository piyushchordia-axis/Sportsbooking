/**
 * Shared API contract types (request/response shapes) consumed by the web app.
 * Kept intentionally light — the source of truth for persistence is the Prisma
 * schema; these mirror the JSON the REST API exchanges.
 */
import {
  BookingStatus,
  DayType,
  FeatureFlag,
  PayMode,
  PaymentStatus,
  SlotStatus,
  TimeBand,
  UnitLabel,
  UserRole,
} from './enums';

export interface Branding {
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
}

export interface AuthUser {
  id: string;
  role: UserRole;
  ownerId: string | null;
  name: string;
  email?: string;
  mobile?: string;
  assignedVenueIds?: string[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResponse extends AuthTokens {
  user: AuthUser;
}

export interface GameCatalogueItem {
  id: string;
  name: string;
  iconUrl: string | null;
  slotGranularityMin: 30 | 60 | 90;
  unitLabel: UnitLabel;
  minPlayers: number;
  maxPlayers: number;
  defaultOpenTime: string; // "HH:mm"
  defaultCloseTime: string; // "HH:mm"
}

export interface OwnerSummary {
  id: string;
  name: string;
  status: string;
  venueQuota: number;
  venueCount: number;
  allowedGameIds: string[];
  featureFlags: FeatureFlag[];
  amcRenewalDate: string | null;
}

/** A single resolved slot in the customer calendar (PRD §4.2, §5.2). */
export interface ResolvedSlot {
  unitId: string;
  start: string; // ISO
  end: string; // ISO
  status: SlotStatus;
  price: number; // resolved per-court dynamic price (minor units / rupees)
  dayType: DayType;
  timeBand: TimeBand;
}

export interface CalendarResponse {
  venueId: string;
  unitId: string;
  date: string; // YYYY-MM-DD
  slots: ResolvedSlot[];
}

export interface CartSlotInput {
  unitId: string;
  start: string; // ISO
  end: string; // ISO
}

/**
 * Optional weekly recurrence for a booking (PRD §5.2 v1). When present, the
 * booking is repeated weekly at the same time-of-day on the same court(s),
 * `count` total occurrences (including the first), capped server-side.
 */
export interface BookingRecurrence {
  frequency: 'weekly';
  /** total occurrences including the first; capped at 12 server-side */
  count: number;
}

/** A single occurrence that could not be created because its slot(s) clashed. */
export interface BookingSeriesConflict {
  /** ISO start of the first slot of the skipped occurrence */
  start: string;
  reason: string;
}

/** Summary of a created recurring series, returned alongside the first booking. */
export interface BookingSeriesSummary {
  seriesId: string;
  /** number of occurrences actually created */
  created: number;
  /** occurrences skipped due to slot conflicts/blocks */
  skipped: BookingSeriesConflict[];
}

/** A chosen add-on with its quantity. */
export interface AddonSelection {
  addonId: string;
  quantity: number;
}

export interface CreateBookingRequest {
  venueId: string;
  slots: CartSlotInput[];
  /** legacy: one of each (owner offline-booking flow). */
  addonIds?: string[];
  /** quantity-aware add-on selection (consumer flow; preferred). */
  addons?: AddonSelection[];
  payMode: PayMode;
  /**
   * Online payment plan, only meaningful when payMode='prepay'. 'full' (default)
   * charges the whole total online; 'deposit' charges only the venue's
   * configured deposit percentage online, with the balance due at the venue.
   */
  paymentPlan?: 'full' | 'deposit';
  packId?: string;
  offerCode?: string;
  pointsToRedeem?: number;
  /** customer contact for player capture if not already authenticated */
  customer?: { name: string; mobile: string; consent: boolean };
  /**
   * Optional weekly recurrence (PRD §5.2 v1). Absent → a single booking with
   * the response shape unchanged. Present → a weekly series; the response adds
   * a `series` summary. Only supported for AT_VENUE pay mode.
   */
  recurrence?: BookingRecurrence;
  /**
   * Client-generated idempotency key for this checkout attempt (honored
   * server-side). Stays stable across retries of the same attempt so a
   * double-tap / retry never creates a duplicate booking.
   */
  idempotencyKey?: string;
}

/** Owner CRM directory row (PRD §4.9) — name/mobile sourced from the player
 * profile / user, plus frequency/recency + consent. */
export interface PlayerSummary {
  customerId: string;
  name: string | null;
  mobile: string | null;
  bookingCount: number;
  lastVisitAt: string; // ISO
  consent: boolean;
  optedOut: boolean;
}

/** Owner/staff-initiated add of a customer to the CRM. */
export interface CreateCustomerRequest {
  name: string;
  mobile: string;
  consent: boolean;
}

export interface BookingLineItem {
  label: string;
  amount: number;
}

export interface BookingResponse {
  id: string;
  status: string;
  payMode: PayMode;
  paymentStatus: PaymentStatus;
  total: number;
  /** money collected online at creation (serialized as string, like total) */
  amountPaidOnline?: string;
  /** money still due at the venue for a deposit booking (serialized as string) */
  amountDueAtVenue?: string;
  lineItems: BookingLineItem[];
  razorpayOrderId?: string;
  /**
   * Present only for recurring bookings (PRD §5.2 v1). Omitted entirely for a
   * single (non-recurring) booking so the response shape is unchanged. `id`,
   * `total` and `lineItems` above always describe the FIRST occurrence.
   */
  series?: BookingSeriesSummary;
}

/** Request to preview a cart's price (POST /bookings/quote): the booking
 *  inputs that affect price, minus pay mode / recurrence / customer capture. */
export interface QuoteBookingRequest {
  venueId: string;
  slots: CartSlotInput[];
  addonIds?: string[];
  addons?: AddonSelection[];
  packId?: string;
  offerCode?: string;
  pointsToRedeem?: number;
}

/** Dry-run price breakdown for a cart — drives the add-on / pack / points /
 *  promo preview in the consumer booking flow. All amounts are in rupees and
 *  match exactly what the booking would charge. */
export interface BookingQuoteResponse {
  slotSubtotal: number;
  addonSubtotal: number;
  packDiscount: number;
  /** the offer matched (explicit code or best auto-apply), if any */
  offerId?: string;
  /** true when a promo/offer was applied (explicit code or auto) */
  offerApplied: boolean;
  offerDiscount: number;
  /** customer's current redeemable points balance */
  pointsBalance: number;
  /** rupee value of one point for this owner/venue */
  redeemValue: number;
  /** most points this cart can absorb = the redeem slider's max */
  maxRedeemablePoints: number;
  /** points actually applied given the requested amount */
  pointsRedeemed: number;
  /** rupee value of the redeemed points */
  pointsValue: number;
  total: number;
  /**
   * Deposit preview, populated whenever the venue's depositPct>0 (independent of
   * the chosen payment plan) so the UI can show "Pay X now, Y at venue".
   * Serialized as string, like other money fields.
   */
  depositAmount?: string;
  balanceDueAtVenue?: string;
}

/** A pack the customer actually OWNS with an owner — a positive, non-expired
 *  session balance — plus the scope metadata the booking UI needs to show only
 *  packs applicable to the current venue/court. */
export interface OwnedPack {
  id: string;
  name: string;
  /** sessions the pack grants per purchase (catalogue value) */
  sessions: number;
  /** remaining redeemable sessions the customer holds */
  balance: number;
  pricingMode: string;
  discountPct: number | null;
  /** empty = valid at all venues */
  venueIds: string[];
  /** empty = valid at all courts */
  unitIds: string[];
}

/** A single occupying slot on an owner's booking, with the court's name. */
export interface OwnerBookingSlot {
  unitId: string;
  unitName: string;
  start: string; // ISO
  end: string; // ISO
}

/** A booking as seen by an owner/staff on the management screen (PRD §4.3). */
export interface OwnerBooking {
  id: string;
  status: BookingStatus;
  payMode: PayMode;
  paymentStatus: PaymentStatus;
  total: number;
  venueId: string;
  venueName: string;
  customerId: string;
  customerName: string | null;
  customerMobile: string | null;
  slots: OwnerBookingSlot[];
  createdAt: string; // ISO
}

/** Owner bookings list filters (all optional). */
export interface BookingFilters {
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  venueId?: string;
  unitId?: string;
  status?: BookingStatus;
  paymentStatus?: PaymentStatus;
  q?: string; // customer name / mobile search
}

export interface UpdateBookingStatusRequest {
  status: BookingStatus;
}

export interface RescheduleBookingRequest {
  slots: CartSlotInput[];
}

export interface UpdateBookingCustomerRequest {
  name: string;
  mobile: string;
}

export interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
}
