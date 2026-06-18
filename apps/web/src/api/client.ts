import {
  BookingFilters,
  BookingResponse,
  BookingStatus,
  CalendarResponse,
  CreateBookingRequest,
  CreateCustomerRequest,
  LoginResponse,
  OwnerBooking,
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
  bookings: { total: number; cancelled: number };
  revenue: number;
  bookedSlots: number;
  membership: { packsSold: number; outstandingSessions: number };
  addonRevenue: number;
  players: number;
  perVenue: { venueId: string; revenue: number; bookings: number }[];
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('accessToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  });
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
const get = <T>(path: string) => request<T>(path);

export const api = {
  // ---- auth ----
  requestOtp: (mobile: string) => post<{ sent: boolean }>('/auth/otp/request', { mobile }),
  verifyOtp: (mobile: string, code: string, name?: string) =>
    post<LoginResponse>('/auth/otp/verify', { mobile, code, name, consent: true }),
  staffLogin: (email: string, password: string) =>
    post<LoginResponse>('/auth/login', { email, password }),

  // ---- discovery / booking (customer) ----
  discoverVenues: (city?: string) =>
    get<DiscoverVenue[]>(`/discover/venues${city ? `?city=${encodeURIComponent(city)}` : ''}`),
  discoverGames: () => get<any[]>('/discover/games'),
  availability: (unitId: string, date: string) =>
    get<CalendarResponse>(`/availability?unitId=${unitId}&date=${date}`),
  createBooking: (payload: CreateBookingRequest) =>
    post<BookingResponse>('/bookings', payload),
  cancelBooking: (id: string) => post<{ cancelled: true }>(`/bookings/${id}/cancel`),

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
  registerTournament: (
    id: string,
    body: { captainName: string; captainMobile: string; teamName?: string },
  ) => post<{ participantId: string; razorpayOrderId: string; fee: number }>(
    `/tournaments/${id}/register`,
    body,
  ),

  // ---- owner ----
  ownerReport: () => get<OwnerReport>('/reports/owner'),
  listVenues: () => get<any[]>('/venues'),
  createVenue: (body: unknown) => post('/venues', body),
  addUnit: (venueId: string, body: unknown) => post(`/venues/${venueId}/units`, body),
  setPricing: (unitId: string, rules: unknown[]) => put(`/venues/units/${unitId}/pricing`, rules),
  createPack: (body: unknown) => post('/packs', body),
  listPacks: () => get<Pack[]>('/packs'),
  createOffer: (body: unknown) => post('/offers', body),
  listOffers: () => get<any[]>('/offers'),
  createAddon: (venueId: string, body: unknown) => post(`/venues/${venueId}/addons`, body),
  listPlayers: (segment?: string) =>
    get<PlayerSummary[]>(`/players${segment ? `?segment=${segment}` : ''}`),
  addCustomer: (body: CreateCustomerRequest) => post<PlayerSummary>('/players', body),
  createTournament: (body: unknown) => post('/tournaments', body),
  settleBooking: (id: string) => post(`/bookings/${id}/settle`),

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

  // ---- super admin ----
  listGames: () => get<any[]>('/super-admin/games'),
  createGame: (body: unknown) => post('/super-admin/games', body),
  listOwners: () => get<any[]>('/super-admin/owners'),
  createOwner: (body: unknown) => post('/super-admin/owners', body),
  platformReport: () => get<{ owners: number; venues: number; bookings: number; grossRevenue: number }>(
    '/reports/platform',
  ),
};
