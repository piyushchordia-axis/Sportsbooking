import {
  CalendarResponse,
  CreateBookingRequest,
  BookingResponse,
  LoginResponse,
} from '@sportsbooking/shared';

const BASE = '/api';

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
    throw new Error(body.message ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  requestOtp: (mobile: string) =>
    request<{ sent: boolean }>('/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ mobile }),
    }),

  verifyOtp: (mobile: string, code: string, name?: string) =>
    request<LoginResponse>('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ mobile, code, name, consent: true }),
    }),

  staffLogin: (email: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  availability: (unitId: string, date: string) =>
    request<CalendarResponse>(
      `/availability?unitId=${unitId}&date=${date}`,
    ),

  createBooking: (payload: CreateBookingRequest) =>
    request<BookingResponse>('/bookings', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
