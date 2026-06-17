/**
 * Shared API contract types (request/response shapes) consumed by the web app.
 * Kept intentionally light — the source of truth for persistence is the Prisma
 * schema; these mirror the JSON the REST API exchanges.
 */
import {
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
}

export interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
}
