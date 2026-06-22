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

export interface CreateBookingRequest {
  venueId: string;
  slots: CartSlotInput[];
  addonIds?: string[];
  payMode: PayMode;
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
  lineItems: BookingLineItem[];
  razorpayOrderId?: string;
  /**
   * Present only for recurring bookings (PRD §5.2 v1). Omitted entirely for a
   * single (non-recurring) booking so the response shape is unchanged. `id`,
   * `total` and `lineItems` above always describe the FIRST occurrence.
   */
  series?: BookingSeriesSummary;
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
