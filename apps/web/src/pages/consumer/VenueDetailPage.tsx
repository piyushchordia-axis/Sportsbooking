import { PayMode, ResolvedSlot, SlotStatus, UserRole } from '@sportsbooking/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Clock3,
  Heart,
  KeyRound,
  MapPin,
  Minus,
  Phone,
  Plus,
  Repeat,
} from 'lucide-react';
import { Addon, api, DiscoverVenue, Pack } from '../../api/client';
import { EmptyState, ImageWithFallback } from '../../components/common';
import { FALLBACK_VENUE_PHOTO, venuePhoto } from '../../lib/imagery';
import { openCheckout, razorpayEnabled } from '../../lib/razorpay';
import { useAuth } from '../../auth/AuthContext';
import { useFloodlitToast, flMoney } from '../../floodlit/toast';
import { label } from '../../lib/labels';

/**
 * Confirm a prepay booking's Razorpay payment server-side. The `api` client has
 * no method for this endpoint, so we call it directly here, mirroring the
 * client's `/api` base + auth-header convention (see ../../api/client.ts).
 */
async function confirmPayment(
  bookingId: string,
  body: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  },
): Promise<void> {
  const token = localStorage.getItem('accessToken');
  const res = await fetch(`/api/bookings/${bookingId}/confirm-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const m = Array.isArray(err.message) ? err.message.join(', ') : err.message;
    throw new Error(m ?? `Payment confirmation failed: ${res.status}`);
  }
}

/** Booking confirmation surfaced once an order is created/paid. */
interface Confirmation {
  id: string;
  total: number;
  status: string;
  /** Present only when a weekly series was created (PRD §5.2). */
  series?: { created: number; skipped: number };
}

/** Recurrence bounds for the consumer weekly-repeat control (PRD §5.2). */
const MIN_WEEKS = 2;
const MAX_WEEKS = 12;

/** In-page two-step flow: pick slots, then review & book. */
type Step = 'select' | 'review';

/**
 * Public venue storefront: hero + court/date availability + booking with
 * login-at-checkout. A guest browses freely; authentication (OTP) only happens
 * inline when they commit to confirming a booking — the hotel-site pattern.
 */
/**
 * FE-11) Accept a 10-digit Indian mobile (optionally +91 / 91 prefixed) or a
 * generic E.164 number. Returns the digits-only national number when valid, else
 * null — keeps the OTP request from firing on obviously bad input.
 */
function normalizeMobile(raw: string): string | null {
  const trimmed = raw.trim();
  // Generic E.164: a leading + then 8–15 digits.
  if (/^\+\d{8,15}$/.test(trimmed)) return trimmed.replace('+', '');
  // Indian mobile: 10 digits starting 6–9, with an optional 91 / +91 prefix.
  const digits = trimmed.replace(/[\s-]/g, '').replace(/^(\+?91)/, '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** Local YYYY-MM-DD for today, used as the booking-date default when no deep-link. */
function todayISO(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** A YYYY-MM-DD string `offset` days from today (local calendar). */
function isoFromToday(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function VenueDetailPage() {
  const { venueId } = useParams();
  const [searchParams] = useSearchParams();
  const { user, setSession } = useAuth();
  const { flash } = useFloodlitToast();

  const [venue, setVenue] = useState<DiscoverVenue | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [unitId, setUnitId] = useState('');
  // 3) Seed the date from a ?date= deep-link (Browse links into a specific day),
  // falling back to today.
  const [date, setDate] = useState(() => searchParams.get('date') || todayISO());
  const [slots, setSlots] = useState<ResolvedSlot[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // In-page step: "select" (pick court/date/slots) → "review" (confirm & pay).
  const [step, setStep] = useState<Step>('select');

  // Logged-in extras (skipped for guests pre-login).
  const [packs, setPacks] = useState<Pack[]>([]);
  const [packId, setPackId] = useState('');
  const [points, setPoints] = useState('0');
  const [offer, setOffer] = useState('');

  // Add-ons (PRD-5): venue extras a guest can attach at checkout. Loaded for
  // everyone — they're part of the order summary, not a logged-in-only input.
  const [addons, setAddons] = useState<Addon[]>([]);
  const [addonsLoading, setAddonsLoading] = useState(false);
  const [addonsError, setAddonsError] = useState<string | null>(null);
  const [addonIds, setAddonIds] = useState<Set<string>>(new Set());

  // Inline login-at-checkout state.
  const [otpOpen, setOtpOpen] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [mobile, setMobile] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  /** Pay mode the guest committed to before logging in, replayed post-verify. */
  const [pendingPay, setPendingPay] = useState<PayMode | null>(null);

  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // PRD §5.2) Weekly recurrence — only meaningful for AT_VENUE (the backend
  // rejects PREPAY + recurrence), so the control is only shown for that mode.
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [weeks, setWeeks] = useState(MIN_WEEKS);

  // Save/bookmark state for signed-in customers only.
  const canSave = user?.role === UserRole.CUSTOMER;
  const [saved, setSaved] = useState(false);
  const [savePending, setSavePending] = useState(false);

  useEffect(() => {
    if (!canSave || !venue) {
      setSaved(false);
      return;
    }
    let alive = true;
    api
      .listSavedVenues()
      .then((rows) => alive && setSaved(rows.some((r) => r.venueId === venue.id)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [canSave, venue]);

  const toggleSaved = () => {
    if (!venue || savePending) return;
    const wasSaved = saved;
    setSaved(!wasSaved); // optimistic
    setSavePending(true);
    const req = wasSaved ? api.unsaveVenue(venue.id) : api.saveVenue(venue.id);
    req
      .catch(() => setSaved(wasSaved))
      .finally(() => setSavePending(false));
  };

  // 1) Resolve the venue from the discovery list (no single-venue endpoint).
  useEffect(() => {
    let alive = true;
    api
      .discoverVenues()
      .then((list) => {
        if (!alive) return;
        const v = list.find((x) => x.id === venueId) ?? null;
        if (!v) {
          setNotFound(true);
          return;
        }
        setVenue(v);
        setUnitId(v.units[0]?.id ?? '');
      })
      .catch((e) => alive && setLoadError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [venueId]);

  // White-label theming for /venue/:id is handled centrally by StorefrontProvider
  // (the single source of branding) — this page must not call setBranding itself.

  // 6) Pack list only when logged in (offers/points are logged-in-only inputs).
  useEffect(() => {
    if (venue && user) {
      api.listOwnerPacks(venue.ownerId).then(setPacks).catch(() => setPacks([]));
    } else {
      setPacks([]);
      setPackId('');
    }
  }, [venue, user]);

  // PRD-5) Load the venue's add-ons once the venue resolves. Shown to guests and
  // members alike; only active add-ons are offered at checkout.
  useEffect(() => {
    if (!venue) return;
    let alive = true;
    setAddonsLoading(true);
    setAddonsError(null);
    setAddonIds(new Set());
    api
      .listAddons(venue.id)
      .then((list) => alive && setAddons(list.filter((a) => a.active)))
      .catch((e) => alive && setAddonsError((e as Error).message))
      .finally(() => alive && setAddonsLoading(false));
    return () => {
      alive = false;
    };
  }, [venue]);

  /** Re-fetch the slot grid for the current court/date, leaving the rest of the
   *  booking state (incl. any confirmation just shown) intact. */
  const refreshSlots = async () => {
    try {
      const res = await api.availability(unitId, date);
      setSlots(res.slots);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const load = async () => {
    setMsg(null);
    // A fresh search clears any prior confirmation/selection (NOT used after a
    // successful booking — that path keeps the confirmation, see createBooking).
    setConfirmation(null);
    setSelected(new Set());
    setAddonIds(new Set());
    await refreshSlots();
  };

  // The design loads availability the moment a court+date is chosen. Auto-fetch
  // whenever the selection changes (the explicit "Load availability" button
  // remains for an obvious manual refresh). Skip while a confirmation is shown
  // so the post-booking confirmation isn't wiped by an effect.
  useEffect(() => {
    if (!unitId || !venue || confirmation) return;
    let alive = true;
    api
      .availability(unitId, date)
      .then((res) => alive && setSlots(res.slots))
      .catch((e) => alive && setMsg((e as Error).message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId, date, venue]);

  const toggle = (s: ResolvedSlot) => {
    if (s.status !== SlotStatus.OPEN) return;
    const next = new Set(selected);
    next.has(s.start) ? next.delete(s.start) : next.add(s.start);
    setSelected(next);
  };

  const slotsTotal = useMemo(
    () =>
      slots
        .filter((s) => selected.has(s.start))
        .reduce((sum, s) => sum + s.price, 0),
    [slots, selected],
  );

  // PRD-5) Selected add-ons + their running subtotal, folded into the order total.
  const toggleAddon = (id: string) => {
    const next = new Set(addonIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setAddonIds(next);
  };
  const chosenAddons = useMemo(
    () => addons.filter((a) => addonIds.has(a.id)),
    [addons, addonIds],
  );
  const addonsTotal = chosenAddons.reduce((sum, a) => sum + (Number(a.price) || 0), 0);
  const total = slotsTotal + addonsTotal;

  const selectedUnit = venue?.units.find((u) => u.id === unitId);
  const selectedSport = venue?.games.find((g) => g.id === selectedUnit?.gameId)?.name;

  // 7-day date strip starting today (the design's "2 · Pick a date").
  const dateStrip = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const iso = isoFromToday(i);
        const [y, m, d] = iso.split('-').map(Number);
        const jsDate = new Date(y, (m ?? 1) - 1, d ?? 1);
        return {
          iso,
          dow: i === 0 ? 'TODAY' : jsDate.toLocaleDateString([], { weekday: 'short' }).toUpperCase(),
          d: jsDate.getDate(),
        };
      }),
    [],
  );

  // Hero image — stored venue photo if present, else a sport-derived fallback.
  const heroPhoto = useMemo(
    () => venuePhoto({ photos: venue?.photos, games: venue?.games }),
    [venue],
  );

  const sortedSelectedSlots = useMemo(
    () =>
      slots
        .filter((s) => selected.has(s.start))
        .sort((a, b) => a.start.localeCompare(b.start)),
    [slots, selected],
  );

  /** Create the booking + run prepay/Razorpay or pay-at-venue. Assumes auth. */
  const createBooking = async (payMode: PayMode) => {
    if (!venue) return;
    setMsg(null);
    const cart = slots
      .filter((s) => selected.has(s.start))
      .map((s) => ({ unitId: s.unitId, start: s.start, end: s.end }));
    // PRD §5.2) Weekly recurrence is only valid for AT_VENUE; never attach it
    // to a prepay order (the backend rejects that combination).
    const recurrence =
      payMode === PayMode.AT_VENUE && repeatWeekly
        ? ({ frequency: 'weekly', count: weeks } as const)
        : undefined;
    try {
      const res = await api.createBooking({
        venueId: venue.id,
        slots: cart,
        payMode,
        // PRD-5) Chosen extras travel with every booking (guests included).
        addonIds: chosenAddons.length ? chosenAddons.map((a) => a.id) : undefined,
        // Logged-in-only extras — guests just verified send none.
        packId: packId || undefined,
        offerCode: offer || undefined,
        pointsToRedeem: Number(points) || undefined,
        recurrence,
      });

      // Production prepay: a live Razorpay key + server-issued order id opens the
      // hosted checkout and confirms server-side. In dev (no key) razorpayEnabled
      // is false, so we fall through to the mock-payment behaviour unchanged.
      if (payMode === PayMode.PREPAY && razorpayEnabled && res.razorpayOrderId) {
        setMsg('Opening secure payment…');
        await openCheckout({
          orderId: res.razorpayOrderId,
          amount: Math.round(res.total * 100),
          name: venue.name,
          prefill: { contact: mobile || user?.mobile, name: name || user?.name },
          onSuccess: async ({
            razorpay_payment_id,
            razorpay_order_id,
            razorpay_signature,
          }) => {
            try {
              await confirmPayment(res.id, {
                razorpayOrderId: razorpay_order_id,
                razorpayPaymentId: razorpay_payment_id,
                razorpaySignature: razorpay_signature,
              });
              setMsg(null);
              setConfirmation({ id: res.id, total: res.total, status: 'paid' });
              setSelected(new Set());
              flash('Booking confirmed');
              await refreshSlots();
            } catch (e) {
              setMsg((e as Error).message);
            }
          },
        });
        return;
      }

      setMsg(null);
      setConfirmation({
        id: res.id,
        total: res.total,
        status: res.paymentStatus,
        series: res.series
          ? { created: res.series.created, skipped: res.series.skipped.length }
          : undefined,
      });
      setSelected(new Set());
      flash('Booking confirmed');
      await refreshSlots();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  /**
   * Checkout entry point. If the user is authenticated, book immediately;
   * otherwise open the inline OTP step and remember the chosen pay mode so we
   * can resume the booking the moment they verify.
   */
  const checkout = (payMode: PayMode) => {
    if (!selected.size) return;
    if (user) {
      void createBooking(payMode);
      return;
    }
    setPendingPay(payMode);
    setOtpOpen(true);
    setMsg(null);
  };

  const sendCode = async () => {
    if (!mobile.trim()) {
      setMsg('Enter your mobile number to receive a code.');
      return;
    }
    // FE-11) Validate the number before we spend an OTP on it.
    const normalized = normalizeMobile(mobile);
    if (!normalized) {
      setMsg('Enter a valid 10-digit mobile number.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api.requestOtp(normalized);
      setOtpSent(true);
      setMsg('Code sent. Check your phone.');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verifyAndContinue = async () => {
    if (!code.trim()) {
      setMsg('Enter the code we sent you.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.verifyOtp(
        normalizeMobile(mobile) ?? mobile.trim(),
        code.trim(),
        name.trim() || undefined,
      );
      setSession(res);
      setOtpOpen(false);
      setOtpSent(false);
      setCode('');
      // Resume the booking the guest committed to before logging in. The session
      // token is now set, so createBooking() authenticates correctly.
      if (pendingPay) {
        const mode = pendingPay;
        setPendingPay(null);
        await createBooking(mode);
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Not-found / load-error states ----
  if (notFound) {
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <div
          className="rounded-2xl p-6 text-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
        >
          <EmptyState
            title="Venue not found"
            hint="This ground may have been removed or the link is incorrect."
          />
          <Link
            to="/browse"
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold"
            style={{ border: '1px solid var(--line-strong)', color: 'var(--chalk)' }}
          >
            <ArrowLeft className="h-4 w-4" /> Back to browse
          </Link>
        </div>
      </div>
    );
  }

  if (!venue) {
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        {loadError ? (
          <div
            className="rounded-2xl p-6 text-center"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
          >
            <EmptyState title="Couldn't load this venue" hint={loadError} />
            <Link
              to="/browse"
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold"
              style={{ border: '1px solid var(--line-strong)', color: 'var(--chalk)' }}
            >
              <ArrowLeft className="h-4 w-4" /> Back to browse
            </Link>
          </div>
        ) : (
          <div
            className="h-64 animate-pulse rounded-2xl"
            style={{ background: 'var(--surface-2)' }}
          />
        )}
      </div>
    );
  }

  const locationLine = [venue.address, venue.city].filter(Boolean).join(', ');
  const venueGames = venue.games.map((g) => g.name).join(' · ');

  // ===================== CONFIRMATION =====================
  if (confirmation) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6" style={{ animation: 'fl-rise .3s ease' }}>
        <div className="py-4 text-center">
          <div
            className="mx-auto grid h-[72px] w-[72px] place-items-center rounded-full text-4xl"
            style={{
              background: 'color-mix(in oklab, var(--brand) 20%, var(--surface))',
              border: '2px solid var(--brand)',
              color: 'var(--brand)',
            }}
          >
            ✓
          </div>
          <h1 className="fl-display mt-4 text-3xl font-extrabold">Booking confirmed</h1>
          <p className="mt-1.5 text-sm" style={{ color: 'var(--muted)' }}>
            A confirmation has been saved to your account.
          </p>
        </div>

        <div
          className="mt-4 overflow-hidden rounded-2xl"
          style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
        >
          <div
            className="flex items-center justify-between px-4 py-4"
            style={{ borderBottom: '1px solid var(--line)' }}
          >
            <span className="text-sm" style={{ color: 'var(--faint)' }}>
              Booking ID
            </span>
            <span className="fl-mono text-sm font-semibold">{confirmation.id}</span>
          </div>
          <div className="px-4 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
            <div className="fl-display text-lg font-bold">{venue.name}</div>
            <div className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
              {selectedSport ? `${selectedSport} · ` : ''}
              {selectedUnit?.name}
            </div>
          </div>
          <div className="flex items-center justify-between px-4 py-4">
            <div>
              <div className="text-xs" style={{ color: 'var(--faint)' }}>
                Status
              </div>
              <div className="mt-0.5 text-sm font-semibold capitalize" style={{ color: 'var(--brand)' }}>
                {label(confirmation.status)}
              </div>
            </div>
            <span className="fl-mono text-2xl font-semibold" style={{ color: 'var(--brand)' }}>
              {flMoney(confirmation.total)}
            </span>
          </div>
        </div>

        {confirmation.series && (
          <div
            className="mt-3 rounded-xl px-4 py-3 text-sm leading-relaxed"
            style={{
              background: 'var(--bg-2)',
              border: '1px dashed var(--line-strong)',
              color: 'var(--muted)',
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <Repeat className="h-4 w-4" style={{ color: 'var(--brand)' }} />
              Weekly series · {confirmation.series.created} booked
              {confirmation.series.skipped > 0 &&
                ` · ${confirmation.series.skipped} skipped (those slots were already taken or blocked)`}
              .
            </span>
          </div>
        )}

        <div className="mt-5 flex gap-2.5">
          <Link
            to="/my-bookings"
            className="flex-1 rounded-xl py-3.5 text-center text-sm font-bold"
            style={{ background: 'var(--brand)', color: 'var(--on-brand)' }}
          >
            My bookings
          </Link>
          <Link
            to="/browse"
            className="flex-1 rounded-xl py-3.5 text-center text-sm font-semibold"
            style={{ border: '1px solid var(--line-strong)', color: 'var(--chalk)' }}
          >
            Done
          </Link>
        </div>
      </div>
    );
  }

  // ===================== REVIEW & BOOK =====================
  if (step === 'review') {
    return (
      <div className="mx-auto max-w-4xl px-4 py-5" style={{ animation: 'fl-rise .3s ease' }}>
        <div className="mb-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setStep('select');
              setOtpOpen(false);
              setOtpSent(false);
              setMsg(null);
            }}
            aria-label="Back to slot selection"
            className="grid h-9 w-9 place-items-center rounded-full text-lg"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--chalk)' }}
          >
            ←
          </button>
          <h1 className="fl-display text-2xl font-extrabold sm:text-3xl">Review &amp; book</h1>
        </div>

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-5">
          {/* LEFT: summary */}
          <div className="space-y-3 lg:col-span-3">
            {/* line items */}
            <div
              className="rounded-2xl px-4"
              style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
            >
              <div
                className="fl-mono py-3 text-[11px] uppercase tracking-[0.08em]"
                style={{ borderBottom: '1px solid var(--line)', color: 'var(--faint)' }}
              >
                {venue.name} · {selectedUnit?.name}
              </div>
              {sortedSelectedSlots.map((s) => {
                const time = new Date(s.start).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                return (
                  <div
                    key={s.start}
                    className="flex items-center justify-between py-3"
                    style={{ borderBottom: '1px solid var(--line)' }}
                  >
                    <div>
                      <div className="text-sm font-medium">{time}</div>
                      <div className="fl-mono mt-0.5 text-[11px]" style={{ color: 'var(--faint)' }}>
                        {date} · {selectedSport ?? 'Court'}
                      </div>
                    </div>
                    <span className="fl-mono text-sm font-semibold">{flMoney(s.price)}</span>
                  </div>
                );
              })}
              {chosenAddons.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between py-3"
                  style={{ borderBottom: '1px solid var(--line)' }}
                >
                  <div>
                    <div className="text-sm font-medium">{a.name}</div>
                    <div className="fl-mono mt-0.5 text-[11px] capitalize" style={{ color: 'var(--faint)' }}>
                      add-on · {a.type}
                    </div>
                  </div>
                  <span className="fl-mono text-sm font-semibold">{flMoney(Number(a.price) || 0)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between py-3.5">
                <span className="fl-display text-lg font-bold">Total</span>
                <span className="fl-mono text-2xl font-semibold" style={{ color: 'var(--brand)' }}>
                  {flMoney(total)}
                </span>
              </div>
            </div>

            {/* recurring — pay-at-venue only */}
            <button
              type="button"
              onClick={() => setRepeatWeekly((v) => !v)}
              className="flex w-full items-center gap-3 rounded-xl p-3.5 text-left"
              style={{
                background: repeatWeekly ? 'color-mix(in oklab, var(--brand) 12%, var(--surface))' : 'var(--surface)',
                border: `1px solid ${repeatWeekly ? 'var(--brand)' : 'var(--line)'}`,
              }}
            >
              <Repeat className="h-5 w-5 shrink-0" style={{ color: 'var(--brand)' }} />
              <div className="flex-1">
                <div className="text-sm font-semibold">Repeat weekly</div>
                <div className="mt-0.5 text-[11.5px]" style={{ color: 'var(--faint)' }}>
                  Books this slot every week. Pay at venue only.
                </div>
              </div>
              <span
                className="relative h-[26px] w-11 shrink-0 rounded-full transition-colors"
                style={{ background: repeatWeekly ? 'var(--brand)' : 'var(--surface-2)' }}
              >
                <span
                  className="absolute top-[3px] h-5 w-5 rounded-full bg-white transition-[left]"
                  style={{ left: repeatWeekly ? '21px' : '3px' }}
                />
              </span>
            </button>
            {repeatWeekly && (
              <div
                className="flex items-center gap-3 rounded-xl p-3.5"
                style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
              >
                <button
                  type="button"
                  aria-label="Fewer weeks"
                  disabled={weeks <= MIN_WEEKS}
                  onClick={() => setWeeks((n) => Math.max(MIN_WEEKS, n - 1))}
                  className="grid h-9 w-9 place-items-center rounded-lg disabled:opacity-40"
                  style={{ border: '1px solid var(--line-strong)', color: 'var(--chalk)' }}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="fl-display text-lg font-bold tabular-nums">{weeks}</span>
                <button
                  type="button"
                  aria-label="More weeks"
                  disabled={weeks >= MAX_WEEKS}
                  onClick={() => setWeeks((n) => Math.min(MAX_WEEKS, n + 1))}
                  className="grid h-9 w-9 place-items-center rounded-lg disabled:opacity-40"
                  style={{ border: '1px solid var(--line-strong)', color: 'var(--chalk)' }}
                >
                  <Plus className="h-4 w-4" />
                </button>
                <span className="text-sm" style={{ color: 'var(--muted)' }}>
                  weeks · pay at venue only
                </span>
              </div>
            )}

            {/* signed-in extras */}
            {user && (
              <div
                className="space-y-3 rounded-xl p-4"
                style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
              >
                <label className="block">
                  <span className="fl-mono mb-1.5 block text-[11px] uppercase tracking-[0.1em]" style={{ color: 'var(--faint)' }}>
                    Use pack
                  </span>
                  <select
                    value={packId}
                    onChange={(e) => setPackId(e.target.value)}
                    className="h-11 w-full rounded-xl px-3.5 text-sm outline-none"
                    style={{ background: 'var(--bg-2)', border: '1px solid var(--line-strong)', color: 'var(--chalk)' }}
                  >
                    <option value="">None</option>
                    {packs.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="fl-mono mb-1.5 block text-[11px] uppercase tracking-[0.1em]" style={{ color: 'var(--faint)' }}>
                    Redeem points
                  </span>
                  <input
                    value={points}
                    onChange={(e) => setPoints(e.target.value)}
                    inputMode="numeric"
                    className="fl-mono h-11 w-full rounded-xl px-3.5 text-sm outline-none"
                    style={{ background: 'var(--bg-2)', border: '1px solid var(--line-strong)', color: 'var(--chalk)' }}
                  />
                </label>
                <label className="block">
                  <span className="fl-mono mb-1.5 block text-[11px] uppercase tracking-[0.1em]" style={{ color: 'var(--faint)' }}>
                    Promo code
                  </span>
                  <input
                    value={offer}
                    onChange={(e) => setOffer(e.target.value)}
                    placeholder="Promo code"
                    className="fl-mono h-11 w-full rounded-xl px-3.5 text-sm outline-none"
                    style={{ background: 'var(--bg-2)', border: '1px solid var(--line-strong)', color: 'var(--chalk)' }}
                  />
                </label>
              </div>
            )}
          </div>

          {/* RIGHT: payment + confirm */}
          <div className="space-y-4 lg:col-span-2 lg:sticky lg:top-20">
            <div
              className="rounded-2xl p-4"
              style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
            >
              <div className="fl-mono mb-2.5 text-[11px] uppercase tracking-[0.1em]" style={{ color: 'var(--faint)' }}>
                Payment
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => !repeatWeekly && checkout(PayMode.PREPAY)}
                  disabled={!selected.size || repeatWeekly}
                  title={repeatWeekly ? 'Weekly bookings are pay-at-venue only' : undefined}
                  className="rounded-xl p-3.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: 'var(--bg-2)', border: '1px solid var(--line-strong)' }}
                >
                  <div className="text-sm font-semibold">Prepay</div>
                  <div className="mt-0.5 text-[11px]" style={{ color: 'var(--faint)' }}>
                    Razorpay · slot locked
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => checkout(PayMode.AT_VENUE)}
                  disabled={!selected.size}
                  className="rounded-xl p-3.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: 'var(--bg-2)', border: '1px solid var(--line-strong)' }}
                >
                  <div className="text-sm font-semibold">Pay at venue</div>
                  <div className="mt-0.5 text-[11px]" style={{ color: 'var(--faint)' }}>
                    Settle on arrival
                  </div>
                </button>
              </div>

              {!otpOpen && (
                <p className="fl-mono mt-3 text-center text-[11px]" style={{ color: 'var(--faint)' }}>
                  {user
                    ? 'Pick a payment method to confirm.'
                    : "Browse freely — we'll ask for a quick OTP only to confirm."}
                </p>
              )}
            </div>

            {/* inline OTP (guest commit) */}
            {otpOpen && !user && (
              <div
                className="rounded-2xl p-4"
                style={{ background: 'var(--surface)', border: '1px solid var(--brand)' }}
              >
                <p className="fl-display flex items-center gap-2 text-lg font-bold">
                  <KeyRound className="h-4 w-4" style={{ color: 'var(--brand)' }} />
                  Verify to confirm
                </p>
                {!otpSent ? (
                  <>
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={mobile}
                      placeholder="10-digit mobile"
                      onChange={(e) => setMobile(e.target.value)}
                      className="fl-mono mt-3 h-12 w-full rounded-xl px-3.5 text-[15px] tracking-[0.05em] outline-none"
                      style={{ background: 'var(--bg-2)', border: '1px solid var(--line-strong)', color: 'var(--chalk)' }}
                    />
                    <input
                      value={name}
                      placeholder="Your name (optional)"
                      onChange={(e) => setName(e.target.value)}
                      className="mt-2.5 h-12 w-full rounded-xl px-3.5 text-sm outline-none"
                      style={{ background: 'var(--bg-2)', border: '1px solid var(--line-strong)', color: 'var(--chalk)' }}
                    />
                    <button
                      type="button"
                      onClick={sendCode}
                      disabled={busy}
                      className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-[15px] font-bold disabled:opacity-60"
                      style={{ background: 'var(--brand)', color: 'var(--on-brand)' }}
                    >
                      <Phone className="h-4 w-4" /> Send code
                    </button>
                  </>
                ) : (
                  <>
                    <div className="fl-mono mt-3 text-[11.5px]" style={{ color: 'var(--faint)' }}>
                      Code sent to {mobile}
                    </div>
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      inputMode="numeric"
                      placeholder="6-digit code"
                      className="fl-mono mt-2 h-12 w-full rounded-xl px-3.5 text-center text-lg tracking-[0.4em] outline-none"
                      style={{ background: 'var(--bg-2)', border: '1px solid var(--line-strong)', color: 'var(--chalk)' }}
                    />
                    <button
                      type="button"
                      onClick={verifyAndContinue}
                      disabled={busy}
                      className="mt-2.5 w-full rounded-xl py-3.5 text-[15px] font-bold disabled:opacity-60"
                      style={{ background: 'var(--brand)', color: 'var(--on-brand)' }}
                    >
                      Verify &amp; confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setOtpSent(false)}
                      className="mt-2 w-full text-center text-xs"
                      style={{ color: 'var(--faint)' }}
                    >
                      Change number
                    </button>
                  </>
                )}
              </div>
            )}

            {msg && (
              <p className="text-center text-sm" style={{ color: 'var(--muted)' }}>
                {msg}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ===================== SELECT (default) =====================
  return (
    <div className="mx-auto max-w-4xl" style={{ animation: 'fl-rise .3s ease' }}>
      {/* hero strip */}
      <div
        className="relative flex h-44 items-start justify-between overflow-hidden p-4"
        style={{ background: 'var(--surface-2)' }}
      >
        <ImageWithFallback
          src={heroPhoto}
          fallback={FALLBACK_VENUE_PHOTO}
          alt={venue.name}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, color-mix(in oklab, var(--bg) 35%, transparent), color-mix(in oklab, var(--bg) 75%, transparent))',
          }}
        />
        <Link
          to="/browse"
          aria-label="All grounds"
          className="relative grid h-9 w-9 place-items-center rounded-full text-lg"
          style={{ background: 'color-mix(in oklab, var(--bg) 55%, transparent)', color: 'var(--chalk)' }}
        >
          ←
        </Link>
        {canSave && (
          <button
            type="button"
            onClick={toggleSaved}
            disabled={savePending}
            aria-pressed={saved}
            aria-label={saved ? 'Saved' : 'Save venue'}
            className="relative grid h-9 w-9 place-items-center rounded-full"
            style={{ background: 'color-mix(in oklab, var(--bg) 55%, transparent)' }}
          >
            <Heart
              className="h-4 w-4"
              style={{ color: saved ? 'var(--brand)' : 'var(--chalk)', fill: saved ? 'var(--brand)' : 'transparent' }}
            />
          </button>
        )}
      </div>

      <div className="px-4 pb-28 sm:px-6">
        {/* name / games / city / hours */}
        <h1 className="fl-display mt-4 text-3xl font-extrabold leading-none sm:text-4xl">{venue.name}</h1>
        <div className="mt-1.5 text-sm" style={{ color: 'var(--muted)' }}>
          {venueGames}
          {venueGames && venue.city ? ' · ' : ''}
          {venue.city}
        </div>
        <div className="fl-mono mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--faint)' }}>
          {locationLine && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {locationLine}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3.5 w-3.5" /> Open {venue.openTime} – {venue.closeTime}
          </span>
        </div>

        {/* 1 · Pick a court */}
        <div className="fl-mono mb-2.5 mt-6 text-[11px] uppercase tracking-[0.1em]" style={{ color: 'var(--faint)' }}>
          1 · Pick a court
        </div>
        <div className="fl-scroll flex gap-2 overflow-x-auto">
          {venue.units.map((u) => {
            const active = unitId === u.id;
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => setUnitId(u.id)}
                aria-pressed={active}
                className="flex-none whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold"
                style={{
                  background: active ? 'var(--brand)' : 'var(--surface)',
                  border: `1px solid ${active ? 'var(--brand)' : 'var(--line)'}`,
                  color: active ? 'var(--on-brand)' : 'var(--chalk)',
                }}
              >
                {u.name} <span style={{ opacity: 0.7 }}>({u.label})</span>
              </button>
            );
          })}
        </div>

        {/* 2 · Pick a date */}
        <div className="fl-mono mb-2.5 mt-6 text-[11px] uppercase tracking-[0.1em]" style={{ color: 'var(--faint)' }}>
          2 · Pick a date
        </div>
        <div className="fl-scroll flex gap-2 overflow-x-auto">
          {dateStrip.map((d) => {
            const active = date === d.iso;
            return (
              <button
                key={d.iso}
                type="button"
                onClick={() => setDate(d.iso)}
                aria-pressed={active}
                className="flex-none rounded-xl py-2.5 text-center"
                style={{
                  width: 56,
                  background: active ? 'var(--brand)' : 'var(--surface)',
                  border: `1px solid ${active ? 'var(--brand)' : 'var(--line)'}`,
                }}
              >
                <div
                  className="fl-mono text-[10px]"
                  style={{ color: active ? 'var(--on-brand)' : 'var(--faint)' }}
                >
                  {d.dow}
                </div>
                <div
                  className="fl-display text-xl font-bold leading-tight"
                  style={{ color: active ? 'var(--on-brand)' : 'var(--chalk)' }}
                >
                  {d.d}
                </div>
              </button>
            );
          })}
        </div>

        {/* explicit reload — design auto-loads on court/date, but keep a manual refresh */}
        <button
          type="button"
          onClick={load}
          disabled={!unitId}
          className="fl-mono mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] uppercase tracking-[0.08em] disabled:opacity-50"
          style={{ border: '1px solid var(--line-strong)', color: 'var(--muted)' }}
        >
          <CalendarDays className="h-3.5 w-3.5" /> Load availability
        </button>

        {/* 3 · Pick slot(s) */}
        <div className="mb-2.5 mt-6 flex items-center justify-between">
          <div className="fl-mono text-[11px] uppercase tracking-[0.1em]" style={{ color: 'var(--faint)' }}>
            3 · Pick slot(s)
          </div>
          <div className="fl-mono flex gap-3 text-[10px]" style={{ color: 'var(--faint)' }}>
            <span className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-[3px]"
                style={{ border: '1px solid var(--line-strong)' }}
              />
              Open
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: 'var(--surface-2)' }} />
              Taken
            </span>
          </div>
        </div>

        {slots.length === 0 ? (
          <div
            className="rounded-xl p-6 text-center text-sm"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--muted)' }}
          >
            No availability loaded yet. Pick a court and date above.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {slots.map((s) => {
              const isOpen = s.status === SlotStatus.OPEN;
              const isSel = selected.has(s.start);
              const time = new Date(s.start).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });
              return (
                <button
                  key={s.start}
                  type="button"
                  onClick={() => toggle(s)}
                  disabled={!isOpen}
                  aria-pressed={isSel}
                  className="rounded-xl p-3 text-left"
                  style={{
                    background: isSel
                      ? 'color-mix(in oklab, var(--brand) 16%, var(--surface))'
                      : isOpen
                        ? 'var(--surface)'
                        : 'var(--surface-2)',
                    border: `1px solid ${isSel ? 'var(--brand)' : isOpen ? 'var(--line)' : 'transparent'}`,
                    opacity: isOpen ? 1 : 0.5,
                    cursor: isOpen ? 'pointer' : 'not-allowed',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className="fl-mono text-[13px] font-semibold"
                      style={{ color: isSel ? 'var(--brand)' : 'var(--chalk)' }}
                    >
                      {time}
                    </span>
                    {isSel && <Check className="h-3.5 w-3.5" style={{ color: 'var(--brand)' }} />}
                  </div>
                  <div
                    className="fl-mono mt-1.5 text-[13px] font-semibold"
                    style={{ color: isSel ? 'var(--brand)' : isOpen ? 'var(--chalk)' : 'var(--faint)' }}
                  >
                    {isOpen ? flMoney(s.price) : 'Taken'}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* 4 · Add-ons */}
        <div className="fl-mono mb-2.5 mt-7 text-[11px] uppercase tracking-[0.1em]" style={{ color: 'var(--faint)' }}>
          4 · Add-ons <span className="lowercase tracking-normal">(optional)</span>
        </div>
        {addonsLoading ? (
          <div className="space-y-2">
            <div className="h-12 animate-pulse rounded-xl" style={{ background: 'var(--surface-2)' }} />
            <div className="h-12 animate-pulse rounded-xl" style={{ background: 'var(--surface-2)' }} />
          </div>
        ) : addonsError ? (
          <p className="text-xs" style={{ color: 'var(--danger)' }}>
            Couldn't load add-ons. {addonsError}
          </p>
        ) : addons.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--faint)' }}>
            No add-ons available at this ground.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {addons.map((a) => {
              const on = addonIds.has(a.id);
              const soldOut = a.stock !== null && a.stock <= 0;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => !soldOut && toggleAddon(a.id)}
                  disabled={soldOut}
                  aria-pressed={on}
                  className="flex items-center gap-3 rounded-xl p-3.5 text-left"
                  style={{
                    background: on ? 'color-mix(in oklab, var(--brand) 10%, var(--surface))' : 'var(--surface)',
                    border: `1px solid ${on ? 'var(--brand)' : 'var(--line)'}`,
                    opacity: soldOut ? 0.5 : 1,
                    cursor: soldOut ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-md"
                    style={{
                      background: on ? 'var(--brand)' : 'transparent',
                      border: `1px solid ${on ? 'var(--brand)' : 'var(--line-strong)'}`,
                      color: 'var(--on-brand)',
                    }}
                  >
                    {on && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{a.name}</div>
                    <div className="fl-mono text-[11px] capitalize" style={{ color: 'var(--faint)' }}>
                      {a.type}
                      {a.stock !== null && ` · ${soldOut ? 'out of stock' : `${a.stock} left`}`}
                    </div>
                  </div>
                  <span className="fl-mono text-[13px] font-semibold">{flMoney(Number(a.price) || 0)}</span>
                </button>
              );
            })}
          </div>
        )}

        {msg && (
          <p className="mt-4 text-sm" style={{ color: 'var(--muted)' }}>
            {msg}
          </p>
        )}
      </div>

      {/* sticky cart bar → advance to review */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-4 pb-4 sm:px-0" style={{ pointerEvents: 'none' }}>
          <div
            className="mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-2xl px-4 py-3 shadow-2xl"
            style={{
              background: 'var(--amber)',
              color: 'var(--on-amber)',
              pointerEvents: 'auto',
              boxShadow: '0 14px 40px -14px var(--amber)',
            }}
          >
            <div>
              <div className="fl-mono text-[11px] uppercase tracking-[0.08em]" style={{ opacity: 0.8 }}>
                {selected.size} slot{selected.size === 1 ? '' : 's'}
                {chosenAddons.length > 0 ? ` · ${chosenAddons.length} add-on${chosenAddons.length === 1 ? '' : 's'}` : ''}
              </div>
              <div className="fl-display text-2xl font-extrabold leading-none">{flMoney(total)}</div>
            </div>
            <button
              type="button"
              onClick={() => {
                setStep('review');
                setMsg(null);
              }}
              className="rounded-xl px-5 py-3 text-sm font-bold"
              style={{ background: 'var(--on-amber)', color: 'var(--amber)' }}
            >
              Review &amp; book →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
