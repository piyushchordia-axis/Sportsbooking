import {
  BookingQuoteResponse,
  OwnedPack,
  PayMode,
  ResolvedSlot,
  SlotStatus,
  UserRole,
} from '@sportsbooking/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Clock3,
  Coins,
  Heart,
  KeyRound,
  MapPin,
  Minus,
  Phone,
  Plus,
  RefreshCw,
  Repeat,
  Ticket,
  Wallet,
} from 'lucide-react';
import { Addon, api, DiscoverVenue, OfferInboxItem } from '../../api/client';
import { EmptyState, ImageWithFallback } from '../../components/common';
import { DateRail, SlotCell, TierLegend } from '../../components/slot-ui';
import { FALLBACK_VENUE_PHOTO, venuePhoto } from '../../lib/imagery';
import { normalizeMobile } from '../../lib/mobile';
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
  const [refreshing, setRefreshing] = useState(false);

  // In-page step: "select" (pick court/date/slots) → "review" (confirm & pay).
  const [step, setStep] = useState<Step>('select');

  // Logged-in extras (skipped for guests pre-login). Packs are now the packs the
  // customer actually OWNS (positive balance) — not the whole sale catalogue.
  const [ownedPacks, setOwnedPacks] = useState<OwnedPack[]>([]);
  const [packId, setPackId] = useState('');
  const [points, setPoints] = useState(0); // redeem-slider value (whole points)
  const [offer, setOffer] = useState(''); // promo-code input text
  const [appliedOffer, setAppliedOffer] = useState(''); // code currently applied
  const [offers, setOffers] = useState<OfferInboxItem[]>([]); // available promos
  // Server price preview (pack/offer/points discounts + redeem max). Refetched
  // when the cart/extras change; the booking re-computes authoritatively.
  const [quote, setQuote] = useState<BookingQuoteResponse | null>(null);

  // Add-ons (PRD-5): venue extras a guest can attach at checkout. Loaded for
  // everyone — they're part of the order summary, not a logged-in-only input.
  // Quantity-aware: addonQty maps an add-on id → chosen quantity (>=1).
  const [addons, setAddons] = useState<Addon[]>([]);
  const [addonsLoading, setAddonsLoading] = useState(false);
  const [addonsError, setAddonsError] = useState<string | null>(null);
  const [addonQty, setAddonQty] = useState<Map<string, number>>(new Map());

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

  // 6) Owned packs + available promos, only when logged in (packs/offers/points
  // are logged-in-only inputs). Packs are the ones the customer actually holds a
  // balance on; offers are their eligible promo inbox.
  useEffect(() => {
    if (venue && user) {
      api
        .listOwnedPacks(venue.ownerId)
        .then(setOwnedPacks)
        .catch(() => setOwnedPacks([]));
      api
        .offersInbox(venue.ownerId)
        .then(setOffers)
        .catch(() => setOffers([]));
    } else {
      setOwnedPacks([]);
      setPackId('');
      setOffers([]);
      setAppliedOffer('');
      setOffer('');
      setPoints(0);
    }
  }, [venue, user]);

  // PRD-5) Load the venue's add-ons once the venue resolves. Shown to guests and
  // members alike; only active add-ons are offered at checkout.
  useEffect(() => {
    if (!venue) return;
    let alive = true;
    setAddonsLoading(true);
    setAddonsError(null);
    setAddonQty(new Map());
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

  /** Manual refresh of the slot grid — re-fetch availability for the current
   *  court/date, keeping the user's current selection. */
  const handleRefresh = async () => {
    if (!unitId || refreshing) return;
    setRefreshing(true);
    try {
      await refreshSlots();
    } finally {
      setRefreshing(false);
    }
  };

  // The design loads availability the moment a court+date is chosen. Auto-fetch
  // whenever the selection changes (a small refresh button re-fetches on demand).
  // Skip while a confirmation is shown so the post-booking confirmation isn't
  // wiped by an effect.
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

  // PRD-5) Add-ons are quantity-aware: a stepper sets each add-on's quantity
  // (0 removes it). Subtotal folds quantity × price into the order total.
  const setAddonQuantity = (id: string, qty: number) => {
    const next = new Map(addonQty);
    if (qty <= 0) next.delete(id);
    else next.set(id, qty);
    setAddonQty(next);
  };
  const chosenAddons = useMemo(
    () =>
      addons
        .filter((a) => addonQty.has(a.id))
        .map((a) => ({ ...a, qty: addonQty.get(a.id) ?? 1 })),
    [addons, addonQty],
  );
  const addonsTotal = chosenAddons.reduce(
    (sum, a) => sum + (Number(a.price) || 0) * a.qty,
    0,
  );

  // The cart (selected slots), reused by the price quote and the booking call.
  const cart = useMemo(
    () =>
      slots
        .filter((s) => selected.has(s.start))
        .map((s) => ({ unitId: s.unitId, start: s.start, end: s.end })),
    [slots, selected],
  );
  // Add-ons in API shape ({ addonId, quantity }).
  const addonItems = useMemo(
    () => chosenAddons.map((a) => ({ addonId: a.id, quantity: a.qty })),
    [chosenAddons],
  );

  // Only packs the customer OWNS that also apply to this venue + selected court
  // (empty scope arrays = applies everywhere). The "use pack" picker shows just
  // these, so a customer never sees a pack they can't actually redeem here.
  const applicablePacks = useMemo(
    () =>
      ownedPacks.filter(
        (p) =>
          (!p.venueIds.length || (!!venue && p.venueIds.includes(venue.id))) &&
          (!p.unitIds.length || (!!unitId && p.unitIds.includes(unitId))),
      ),
    [ownedPacks, venue, unitId],
  );

  // Discounts come from the server quote. Points apply client-side off the
  // quote's redeemValue so the slider is instant; the booking re-computes
  // authoritatively. Subtotal stays client-side for immediate feedback.
  const subtotal = slotsTotal + addonsTotal;
  const packDiscount = quote?.packDiscount ?? 0;
  const offerDiscount = quote?.offerDiscount ?? 0;
  const redeemValue = quote?.redeemValue ?? 0;
  const maxPoints = quote?.maxRedeemablePoints ?? 0;
  const pointsValue = points * redeemValue;
  const total = Math.max(subtotal - packDiscount - offerDiscount - pointsValue, 0);
  const savings = packDiscount + offerDiscount + pointsValue;

  // Fetch the server price preview when the cart/extras change (logged-in only,
  // non-empty cart). Debounced so dragging the stepper doesn't spam the API.
  // pointsToRedeem is sent as 0 — the slider applies points locally; the booking
  // sends the real amount and the server re-computes.
  useEffect(() => {
    if (!venue || !user || cart.length === 0) {
      setQuote(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      api
        .quoteBooking({
          venueId: venue.id,
          slots: cart,
          addons: addonItems.length ? addonItems : undefined,
          packId: packId || undefined,
          offerCode: appliedOffer || undefined,
          pointsToRedeem: 0,
        })
        .then((q) => alive && setQuote(q))
        .catch(() => alive && setQuote(null));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [venue, user, cart, addonItems, packId, appliedOffer]);

  // Keep the redeem slider within the current max (cart/extras can shrink it).
  useEffect(() => {
    setPoints((p) => Math.min(p, maxPoints));
  }, [maxPoints]);

  // Drop a selected pack that no longer applies (court/venue changed).
  useEffect(() => {
    if (packId && !applicablePacks.some((p) => p.id === packId)) setPackId('');
  }, [applicablePacks, packId]);

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
        // PRD-5) Chosen extras (with quantity) travel with every booking.
        addons: addonItems.length ? addonItems : undefined,
        // Logged-in-only extras — guests just verified send none.
        packId: packId || undefined,
        offerCode: appliedOffer || undefined,
        pointsToRedeem: points || undefined,
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
                  timeZone: 'Asia/Kolkata',
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
                    <div className="text-sm font-medium">
                      {a.name}
                      {a.qty > 1 ? ` × ${a.qty}` : ''}
                    </div>
                    <div className="fl-mono mt-0.5 text-[11px] capitalize" style={{ color: 'var(--faint)' }}>
                      add-on · {a.type}
                    </div>
                  </div>
                  <span className="fl-mono text-sm font-semibold">
                    {flMoney((Number(a.price) || 0) * a.qty)}
                  </span>
                </div>
              ))}
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

            {/* Member savings — packs & points the player owns (offers live in the
                right-hand summary, next to the total + pay). */}
            {user && (applicablePacks.length > 0 || maxPoints > 0 || ownedPacks.length > 0) && (
              <div
                className="overflow-hidden rounded-2xl"
                style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
              >
                <div
                  className="flex items-center justify-between px-4 py-3.5"
                  style={{ borderBottom: '1px solid var(--line)' }}
                >
                  <span className="fl-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--faint)' }}>
                    Member savings
                  </span>
                  <span className="fl-mono text-[11px]" style={{ color: 'var(--faint)' }}>
                    packs &amp; points
                  </span>
                </div>

                {/* SESSION PACKS — selectable cards (not a dropdown) */}
                <div className="px-4 py-4">
                  <div className="mb-2.5 flex items-center gap-2">
                    <Wallet className="h-3.5 w-3.5" style={{ color: 'var(--faint)' }} />
                    <span className="fl-mono text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--faint)' }}>
                      Session packs
                    </span>
                  </div>
                  {applicablePacks.length === 0 ? (
                    <div className="text-[12.5px]" style={{ color: 'var(--faint)' }}>
                      No packs apply to this court.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {applicablePacks.map((p) => {
                        const on = packId === p.id;
                        const mech =
                          p.pricingMode === 'discount' && p.discountPct != null
                            ? `${p.discountPct}% off this slot`
                            : 'Covers this slot';
                        return (
                          <button
                            key={p.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setPackId(on ? '' : p.id)}
                            className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors"
                            style={{
                              background: on
                                ? 'color-mix(in oklab, var(--brand) 12%, var(--surface))'
                                : 'var(--bg-2)',
                              border: `1px solid ${on ? 'var(--brand)' : 'var(--line)'}`,
                            }}
                          >
                            <span
                              className="grid h-5 w-5 shrink-0 place-items-center rounded-full"
                              style={{
                                border: `1.5px solid ${on ? 'var(--brand)' : 'var(--line-strong)'}`,
                                background: on ? 'var(--brand)' : 'transparent',
                                color: 'var(--on-brand)',
                              }}
                            >
                              {on && <Check className="h-3 w-3" strokeWidth={3} />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-semibold">{p.name}</div>
                              <div className="fl-mono text-[11px]" style={{ color: 'var(--faint)' }}>
                                {p.balance} session{p.balance === 1 ? '' : 's'} left · {mech}
                              </div>
                            </div>
                            {on && packDiscount > 0 && (
                              <span
                                className="fl-mono text-sm font-bold tabular-nums"
                                style={{ color: 'var(--brand)' }}
                              >
                                −{flMoney(packDiscount)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* LOYALTY POINTS — custom track slider (no free typing) */}
                <div className="px-4 py-4" style={{ borderTop: '1px solid var(--line)' }}>
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Coins className="h-3.5 w-3.5" style={{ color: 'var(--faint)' }} />
                      <span className="fl-mono text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--faint)' }}>
                        Loyalty points
                      </span>
                    </div>
                    {quote && (
                      <span
                        className="fl-mono rounded-full px-2 py-0.5 text-[10.5px] font-semibold tabular-nums"
                        style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--muted)' }}
                      >
                        {quote.pointsBalance} available
                      </span>
                    )}
                  </div>
                  {maxPoints > 0 ? (
                    <>
                      <div className="relative h-6 select-none">
                        <div
                          className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
                          style={{ background: 'var(--bg-2)', border: '1px solid var(--line)' }}
                        />
                        <div
                          className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
                          style={{ width: `${(points / maxPoints) * 100}%`, background: 'var(--brand)' }}
                        />
                        <div
                          className="absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                          style={{
                            left: `${(points / maxPoints) * 100}%`,
                            background: 'var(--chalk)',
                            boxShadow: '0 0 0 4px color-mix(in oklab, var(--brand) 30%, transparent)',
                          }}
                        />
                        <input
                          type="range"
                          min={0}
                          max={maxPoints}
                          step={1}
                          value={points}
                          onChange={(e) => setPoints(Number(e.target.value))}
                          aria-label="Redeem points"
                          className="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0"
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="fl-mono text-[12px] tabular-nums" style={{ color: 'var(--muted)' }}>
                          {points} of {maxPoints} pts
                        </span>
                        <div className="flex items-center gap-2.5">
                          {pointsValue > 0 && (
                            <span
                              className="fl-mono text-sm font-bold tabular-nums"
                              style={{ color: 'var(--brand)' }}
                            >
                              −{flMoney(pointsValue)}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setPoints(points >= maxPoints ? 0 : maxPoints)}
                            className="fl-mono rounded-md px-2 py-1 text-[10.5px] font-bold uppercase tracking-wide"
                            style={{ border: '1px solid var(--line-strong)', color: 'var(--chalk)' }}
                          >
                            {points >= maxPoints ? 'Clear' : 'Max'}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-[12.5px]" style={{ color: 'var(--faint)' }}>
                      {cart.length === 0
                        ? 'Pick a slot to redeem points.'
                        : quote && quote.pointsBalance > 0
                          ? 'Points can’t be applied to this booking.'
                          : 'No points to redeem yet.'}
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>

          {/* RIGHT: payment + confirm */}
          <div className="space-y-4 lg:col-span-2 lg:sticky lg:top-20">
            <div
              className="overflow-hidden rounded-2xl"
              style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
            >
              {/* COUPON — code entry + available offers, kept directly above the
                  total + pay so it reads like a standard checkout. Logged-in only. */}
              {user && (
                <div className="px-4 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
                  <div className="mb-2.5 flex items-center gap-2">
                    <Ticket className="h-3.5 w-3.5" style={{ color: 'var(--faint)' }} />
                    <span className="fl-mono text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--faint)' }}>
                      Coupon
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={offer}
                      onChange={(e) => setOffer(e.target.value.toUpperCase())}
                      placeholder="Coupon code"
                      className="fl-mono h-10 flex-1 rounded-lg px-3 text-sm tracking-wide outline-none"
                      style={{ background: 'var(--bg-2)', border: '1px solid var(--line-strong)', color: 'var(--chalk)' }}
                    />
                    <button
                      type="button"
                      onClick={() => setAppliedOffer(offer.trim())}
                      disabled={!offer.trim()}
                      className="h-10 shrink-0 rounded-lg px-4 text-sm font-bold disabled:opacity-40"
                      style={{ background: 'var(--brand)', color: 'var(--on-brand)' }}
                    >
                      Apply
                    </button>
                  </div>
                  {appliedOffer && offerDiscount === 0 && quote && (
                    <div className="fl-mono mt-2 text-[11.5px]" style={{ color: 'var(--bad, #e5484d)' }}>
                      “{appliedOffer.toUpperCase()}” isn’t valid for this booking.
                    </div>
                  )}
                  {offers.filter((o) => o.code).length > 0 && (
                    <div className="mt-2.5 space-y-1.5">
                      {offers
                        .filter((o) => o.code)
                        .map((o) => {
                          const claimed = appliedOffer === o.code && offerDiscount > 0;
                          return (
                            <button
                              key={o.id}
                              type="button"
                              aria-pressed={claimed}
                              onClick={() => {
                                if (claimed) {
                                  setAppliedOffer('');
                                  setOffer('');
                                } else {
                                  setOffer(o.code!);
                                  setAppliedOffer(o.code!);
                                }
                              }}
                              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left"
                              style={{
                                border: `1px solid ${claimed ? 'var(--brand)' : 'var(--line)'}`,
                                background: claimed
                                  ? 'color-mix(in oklab, var(--brand) 10%, var(--surface))'
                                  : 'var(--bg-2)',
                              }}
                            >
                              <span
                                className="grid h-7 w-7 shrink-0 place-items-center rounded-md"
                                style={{
                                  background: claimed
                                    ? 'var(--brand)'
                                    : 'color-mix(in oklab, var(--amber) 16%, transparent)',
                                  color: claimed ? 'var(--on-brand)' : 'var(--amber)',
                                }}
                              >
                                {claimed ? (
                                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                                ) : (
                                  <Ticket className="h-3.5 w-3.5" />
                                )}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div
                                  className="fl-mono text-[12.5px] font-bold tracking-[0.04em]"
                                  style={{ color: claimed ? 'var(--brand)' : 'var(--chalk)' }}
                                >
                                  {o.code}
                                </div>
                                <div className="truncate text-[10.5px]" style={{ color: 'var(--faint)' }}>
                                  {claimed ? 'Applied · tap to remove' : o.name}
                                </div>
                              </div>
                              <span
                                className="fl-mono shrink-0 text-[12px] font-bold"
                                style={{ color: claimed ? 'var(--brand)' : 'var(--amber)' }}
                              >
                                {o.type === 'percent' ? `${o.value}% off` : `${flMoney(o.value)} off`}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}

              {/* PRICE SUMMARY */}
              <div className="px-4 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
                {savings > 0 && (
                  <div className="mb-3 space-y-2">
                    <div className="flex items-center justify-between text-[13px]">
                      <span style={{ color: 'var(--muted)' }}>Subtotal</span>
                      <span className="fl-mono tabular-nums" style={{ color: 'var(--muted)' }}>
                        {flMoney(subtotal)}
                      </span>
                    </div>
                    {packDiscount > 0 && (
                      <div className="flex items-center justify-between text-[13px]">
                        <span style={{ color: 'var(--chalk)' }}>Pack</span>
                        <span className="fl-mono tabular-nums" style={{ color: 'var(--brand)' }}>
                          −{flMoney(packDiscount)}
                        </span>
                      </div>
                    )}
                    {offerDiscount > 0 && (
                      <div className="flex items-center justify-between text-[13px]">
                        <span style={{ color: 'var(--chalk)' }}>
                          Promo{appliedOffer ? ` · ${appliedOffer.toUpperCase()}` : ''}
                        </span>
                        <span className="fl-mono tabular-nums" style={{ color: 'var(--brand)' }}>
                          −{flMoney(offerDiscount)}
                        </span>
                      </div>
                    )}
                    {pointsValue > 0 && (
                      <div className="flex items-center justify-between text-[13px]">
                        <span style={{ color: 'var(--chalk)' }}>Points · {points}</span>
                        <span className="fl-mono tabular-nums" style={{ color: 'var(--brand)' }}>
                          −{flMoney(pointsValue)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex items-end justify-between">
                  <div>
                    <div className="fl-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--faint)' }}>
                      Total
                    </div>
                    {savings > 0 && (
                      <div className="fl-mono mt-1 text-[11px] font-semibold" style={{ color: 'var(--brand)' }}>
                        You save {flMoney(savings)}
                      </div>
                    )}
                  </div>
                  <span
                    className="fl-display text-[30px] font-extrabold leading-none tabular-nums"
                    style={{ color: 'var(--chalk)' }}
                  >
                    {flMoney(total)}
                  </span>
                </div>
              </div>

              {/* PAY */}
              <div className="px-4 py-4">
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

      <div className="pb-28 sm:px-6">
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
        <DateRail days={dateStrip.map((d) => d.iso)} active={date} onSelect={setDate} />

        {/* 3 · Pick slot(s) — with a compact refresh that re-fetches availability */}
        <div className="mb-2.5 mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <div className="fl-mono text-[11px] uppercase tracking-[0.1em]" style={{ color: 'var(--faint)' }}>
              3 · Pick slot(s)
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={!unitId || refreshing}
              aria-label="Refresh availability"
              title="Refresh availability"
              className="grid h-7 w-7 place-items-center rounded-lg disabled:opacity-40"
              style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--muted)' }}
            >
              <RefreshCw className={`h-3.5 w-3.5${refreshing ? ' animate-spin' : ''}`} />
            </button>
          </div>
          <TierLegend slots={slots} />
        </div>

        {slots.length === 0 ? (
          <div
            className="rounded-xl p-6 text-center text-sm"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--muted)' }}
          >
            No slots for this court on this day. Try another date or court.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
            {slots.map((s) => (
              <SlotCell key={s.start} slot={s} selected={selected.has(s.start)} onSelect={toggle} />
            ))}
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
              const qty = addonQty.get(a.id) ?? 0;
              const soldOut = a.stock !== null && a.stock <= 0;
              const on = qty > 0;
              return (
                <div
                  key={a.id}
                  className="flex items-center gap-3 rounded-xl p-3.5 text-left"
                  style={{
                    background: on ? 'color-mix(in oklab, var(--brand) 10%, var(--surface))' : 'var(--surface)',
                    border: `1px solid ${on ? 'var(--brand)' : 'var(--line)'}`,
                    opacity: soldOut ? 0.5 : 1,
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{a.name}</div>
                    <div className="fl-mono text-[11px] capitalize" style={{ color: 'var(--faint)' }}>
                      {a.type}
                      {a.stock !== null && ` · ${soldOut ? 'out of stock' : `${a.stock} left`}`}
                    </div>
                  </div>
                  <span className="fl-mono text-[13px] font-semibold">{flMoney(Number(a.price) || 0)}</span>
                  {on ? (
                    <div
                      className="flex items-center"
                      style={{
                        background: 'var(--bg-2)',
                        border: '1px solid var(--line-strong)',
                        borderRadius: 10,
                      }}
                    >
                      <button
                        type="button"
                        aria-label={`Fewer ${a.name}`}
                        onClick={() => setAddonQuantity(a.id, qty - 1)}
                        className="grid h-9 w-9 place-items-center"
                        style={{ color: 'var(--chalk)' }}
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="fl-mono w-6 text-center text-sm font-semibold tabular-nums">
                        {qty}
                      </span>
                      <button
                        type="button"
                        aria-label={`More ${a.name}`}
                        onClick={() => setAddonQuantity(a.id, qty + 1)}
                        className="grid h-9 w-9 place-items-center"
                        style={{ color: 'var(--chalk)' }}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={soldOut}
                      onClick={() => setAddonQuantity(a.id, 1)}
                      className="h-9 shrink-0 rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
                      style={{
                        border: '1px solid var(--line-strong)',
                        color: 'var(--chalk)',
                        cursor: soldOut ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Add
                    </button>
                  )}
                </div>
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

      {/* sticky cart bar → advance to review. Viewport-fixed (the page wrapper no
          longer creates a transform containing block — see .fl-page-enter), so it
          stays glued to the bottom once a slot is chosen, no scrolling needed. On
          mobile/tablet it sits above the bottom nav; on desktop (no nav) it floats
          just off the bottom edge. */}
      {selected.size > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 z-50 px-4 pb-[calc(76px_+_env(safe-area-inset-bottom))] sm:px-0 md:pb-6"
          style={{ pointerEvents: 'none' }}
        >
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
