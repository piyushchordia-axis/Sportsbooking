import { PayMode, ResolvedSlot, SlotStatus } from '@sportsbooking/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  ImageIcon,
  KeyRound,
  MapPin,
  Phone,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { Addon, api, DiscoverVenue, Pack } from '../../api/client';
import {
  Card,
  EmptyState,
  Field,
  ImageWithFallback,
  KeyVal,
  Msg,
  SectionLabel,
  Select,
  SportIcon,
  StatusPill,
} from '../../components/common';
import { Button } from '../../components/ui/button';
import { DatePicker } from '../../components/ui/date-picker';
import { Skeleton } from '../../components/ui/skeleton';
import { fromISODate, toISODate } from '../../lib/date';
import { FALLBACK_VENUE_PHOTO, venuePhoto } from '../../lib/imagery';
import { openCheckout, razorpayEnabled } from '../../lib/razorpay';
import { useAuth } from '../../auth/AuthContext';

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
}

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

export function VenueDetailPage() {
  const { venueId } = useParams();
  const [searchParams] = useSearchParams();
  const { user, setSession } = useAuth();

  const [venue, setVenue] = useState<DiscoverVenue | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [unitId, setUnitId] = useState('');
  // 3) Seed the date from a ?date= deep-link (Browse links into a specific day),
  // falling back to today.
  const [date, setDate] = useState(() => searchParams.get('date') || todayISO());
  const [slots, setSlots] = useState<ResolvedSlot[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 2) Photo gallery: which gallery image is shown in the main frame.
  const [activePhoto, setActivePhoto] = useState(0);

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
        setActivePhoto(0);
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

  const load = async () => {
    setMsg(null);
    setConfirmation(null);
    setSelected(new Set());
    setAddonIds(new Set());
    try {
      const res = await api.availability(unitId, date);
      setSlots(res.slots);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

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

  // 2) Gallery sources: stored venue.photos when present, else a single
  // sport-derived hero so a photo-less ground still renders gracefully.
  const gallery = useMemo(() => {
    const stored = (venue?.photos ?? []).filter(Boolean);
    if (stored.length) return stored;
    return [venuePhoto({ photos: venue?.photos, games: venue?.games })];
  }, [venue]);
  const hasThumbs = gallery.length > 1;
  const mainPhoto = gallery[Math.min(activePhoto, gallery.length - 1)];

  /** Create the booking + run prepay/Razorpay or pay-at-venue. Assumes auth. */
  const createBooking = async (payMode: PayMode) => {
    if (!venue) return;
    setMsg(null);
    const cart = slots
      .filter((s) => selected.has(s.start))
      .map((s) => ({ unitId: s.unitId, start: s.start, end: s.end }));
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
              await load();
            } catch (e) {
              setMsg((e as Error).message);
            }
          },
        });
        return;
      }

      setMsg(null);
      setConfirmation({ id: res.id, total: res.total, status: res.paymentStatus });
      await load();
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
      <div className="container">
        <Card>
          <EmptyState
            title="Venue not found"
            hint="This ground may have been removed or the link is incorrect."
          />
          <div className="flex justify-center">
            <Button asChild variant="outline">
              <Link to="/browse">
                <ArrowLeft className="h-4 w-4" /> Back to browse
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (!venue) {
    return (
      <div className="container">
        {loadError ? (
          <Card>
            <EmptyState title="Couldn't load this venue" hint={loadError} />
            <div className="flex justify-center">
              <Button asChild variant="outline">
                <Link to="/browse">
                  <ArrowLeft className="h-4 w-4" /> Back to browse
                </Link>
              </Button>
            </div>
          </Card>
        ) : (
          <div className="h-64 rounded-2xl bg-muted/40 animate-pulse" />
        )}
      </div>
    );
  }

  const locationLine = [venue.address, venue.city].filter(Boolean).join(', ');

  return (
    <div className="container">
      {/* Breadcrumb */}
      <Link
        to="/browse"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All grounds
      </Link>

      {/* 2 + 3) Photo gallery + venue header */}
      <div className="mb-6 overflow-hidden rounded-2xl border border-border bg-card">
        {/* Main image */}
        <div className="relative h-60 w-full bg-muted sm:h-80">
          <ImageWithFallback
            key={mainPhoto}
            src={mainPhoto}
            fallback={FALLBACK_VENUE_PHOTO}
            alt={venue.name}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-card/90 via-card/20 to-transparent" />
          {hasThumbs && (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-background/85 px-2.5 py-1 text-xs font-medium text-foreground backdrop-blur">
              <ImageIcon className="h-3.5 w-3.5" />
              {gallery.length} photos
            </span>
          )}
        </div>

        {/* Thumbnail strip — only when there's more than one photo */}
        {hasThumbs && (
          <div className="flex gap-2 overflow-x-auto border-b border-border p-3">
            {gallery.map((src, i) => {
              const active = i === Math.min(activePhoto, gallery.length - 1);
              return (
                <button
                  key={`${src}-${i}`}
                  type="button"
                  onClick={() => setActivePhoto(i)}
                  aria-label={`View photo ${i + 1}`}
                  aria-pressed={active}
                  className={`relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border transition-all ${
                    active
                      ? 'border-primary ring-2 ring-primary/40'
                      : 'border-border opacity-75 hover:opacity-100'
                  }`}
                >
                  <ImageWithFallback
                    src={src}
                    fallback={FALLBACK_VENUE_PHOTO}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </button>
              );
            })}
          </div>
        )}

        {/* Venue header */}
        <div className="p-5 sm:p-6">
          <h1 className="font-display text-3xl font-bold leading-tight text-foreground sm:text-4xl">
            {venue.name}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {locationLine && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-primary" /> {locationLine}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="h-4 w-4 text-primary" /> {venue.openTime} – {venue.closeTime}
            </span>
          </div>
          {venue.games.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {venue.games.map((g) => (
                <span
                  key={g.id}
                  className="inline-flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                >
                  <SportIcon name={g.name} className="h-3.5 w-3.5" />
                  {g.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 4) Booking panel: court + date */}
      <Card
        title={
          <span className="flex items-center gap-2">
            <SportIcon name={selectedSport} className="h-5 w-5" />
            Pick a court &amp; date
          </span>
        }
        topAccent="primary"
      >
        <SectionLabel className="mb-2">Court</SectionLabel>
        <div className="mb-5 flex flex-wrap gap-2">
          {venue.units.map((u) => {
            const active = unitId === u.id;
            return (
              <button
                key={u.id}
                onClick={() => setUnitId(u.id)}
                aria-pressed={active}
                className={`rounded-xl px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {u.name} <span className="opacity-70">({u.label})</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Date
            </span>
            <DatePicker
              value={fromISODate(date)}
              onChange={(d) => setDate(d ? toISODate(d) : todayISO())}
            />
          </div>
          <Button onClick={load} disabled={!unitId} className="mb-3">
            <CalendarDays className="h-4 w-4" /> Load availability
          </Button>
        </div>
      </Card>

      {/* 4 + 5) Slot grid + order summary / checkout */}
      {slots.length > 0 && (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          <Card
            className="lg:col-span-2"
            title={
              <span className="flex items-center gap-2">
                <SportIcon name={selectedSport} className="h-5 w-5" />
                {date}
              </span>
            }
            subtitle="Resolved per-court dynamic pricing"
            topAccent="blue"
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {slots.map((s) => {
                const isOpen = s.status === SlotStatus.OPEN;
                const isSel = selected.has(s.start);
                const time = new Date(s.start).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                let cls =
                  'border-border bg-input-background hover:border-primary/50 cursor-pointer';
                if (isSel)
                  cls = 'border-primary bg-primary/15 ring-1 ring-primary/40 cursor-pointer';
                else if (!isOpen)
                  cls = 'border-transparent bg-muted/40 opacity-50 cursor-not-allowed';
                return (
                  <button
                    key={s.start}
                    onClick={() => toggle(s)}
                    disabled={!isOpen}
                    aria-pressed={isSel}
                    className={`flex flex-col items-center justify-center gap-1 rounded-xl border py-3 transition-colors ${cls}`}
                  >
                    <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                      <Clock3 className="h-3 w-3" />
                      {time}
                    </span>
                    <span
                      className={`font-display font-semibold ${
                        isSel
                          ? 'text-primary'
                          : isOpen
                            ? 'text-foreground'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {isOpen ? `₹${s.price}` : s.status}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Order summary + checkout */}
          <Card
            className="lg:sticky lg:top-20"
            title={
              <span className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-primary" /> Order summary
              </span>
            }
            topAccent="emerald"
          >
            {confirmation ? (
              // 5) Confirmation
              <div>
                <div className="mb-4 flex flex-col items-center text-center">
                  <CheckCircle2 className="mb-2 h-12 w-12 text-primary" />
                  <p className="font-display text-lg font-semibold text-foreground">
                    Booking confirmed
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    A confirmation has been saved to your account.
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-muted/30 p-3">
                  <KeyVal label="Booking ID" value={<span className="font-mono">{confirmation.id}</span>} />
                  <KeyVal label="Amount" value={`₹${confirmation.total}`} />
                  <KeyVal
                    label="Status"
                    value={<StatusPill status={confirmation.status}>{confirmation.status}</StatusPill>}
                  />
                </div>
                <Button asChild className="mt-4 w-full">
                  <Link to="/my-bookings">View my bookings</Link>
                </Button>
              </div>
            ) : (
              <>
                {/* 6) Logged-in-only extras */}
                {user && (
                  <>
                    <Select
                      label="Use pack"
                      value={packId}
                      onChange={setPackId}
                      options={[
                        { value: '', label: 'None' },
                        ...packs.map((p) => ({ value: p.id, label: p.name })),
                      ]}
                    />
                    <Field label="Redeem points" value={points} onChange={setPoints} />
                    <Field label="Offer code" value={offer} onChange={setOffer} />
                  </>
                )}

                {/* PRD-5) Add-on picker — venue extras attached to this order. */}
                <div className="mb-1">
                  <div className="mb-2 flex items-center justify-between">
                    <SectionLabel icon={ShoppingBag}>Add-ons</SectionLabel>
                    {chosenAddons.length > 0 && (
                      <StatusPill status="open">{chosenAddons.length} added</StatusPill>
                    )}
                  </div>
                  {addonsLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : addonsError ? (
                    <p className="text-xs text-destructive">
                      Couldn't load add-ons. {addonsError}
                    </p>
                  ) : addons.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No add-ons available at this ground.
                    </p>
                  ) : (
                    <div className="space-y-2">
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
                            className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                              soldOut
                                ? 'cursor-not-allowed border-border bg-muted opacity-50'
                                : on
                                  ? 'cursor-pointer border-primary/40 bg-primary/10'
                                  : 'cursor-pointer border-border bg-input-background hover:border-primary/40'
                            }`}
                          >
                            <span
                              className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${
                                on ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                              }`}
                            >
                              {on && <Check className="h-3.5 w-3.5" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {a.name}
                              </span>
                              <span className="block text-xs capitalize text-muted-foreground">
                                {a.type}
                                {a.stock !== null &&
                                  ` · ${soldOut ? 'out of stock' : `${a.stock} left`}`}
                              </span>
                            </span>
                            <span className="shrink-0 font-display text-sm font-semibold text-foreground">
                              ₹{Number(a.price) || 0}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Price breakdown */}
                <div className="mt-4 space-y-1.5 border-t border-border pt-4">
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      {selected.size} slot{selected.size === 1 ? '' : 's'}
                    </span>
                    <span>₹{slotsTotal}</span>
                  </div>
                  {chosenAddons.length > 0 && (
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>
                        Add-ons × {chosenAddons.length}
                      </span>
                      <span>₹{addonsTotal}</span>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <div>
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      <Sparkles className="h-3.5 w-3.5" />
                      Total
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {user ? 'before pack / points / offer' : 'login at checkout'}
                    </p>
                  </div>
                  <span className="font-display text-2xl font-bold text-foreground">₹{total}</span>
                </div>

                {/* 5) Inline login-at-checkout */}
                {otpOpen && !user ? (
                  <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
                    <p className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-foreground">
                      <KeyRound className="h-4 w-4 text-primary" />
                      Verify to confirm your booking
                    </p>
                    {!otpSent ? (
                      <>
                        {/* FE-11) tel keyboard + E.164/Indian-mobile validation. */}
                        <label className="mb-3 block">
                          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                            Mobile number
                          </span>
                          <input
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            value={mobile}
                            placeholder="9876543210"
                            onChange={(e) => setMobile(e.target.value)}
                            className="flex h-10 w-full min-w-0 rounded-xl border border-border bg-input-background px-3.5 py-1 text-sm text-foreground outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
                          />
                        </label>
                        <Field
                          label="Your name"
                          value={name}
                          onChange={setName}
                          placeholder="Optional"
                        />
                        <Button onClick={sendCode} disabled={busy} className="w-full">
                          <Phone className="h-4 w-4" /> Send code
                        </Button>
                      </>
                    ) : (
                      <>
                        <Field
                          label={`Code sent to ${mobile}`}
                          value={code}
                          onChange={setCode}
                          placeholder="6-digit code"
                        />
                        <Button onClick={verifyAndContinue} disabled={busy} className="w-full">
                          <CheckCircle2 className="h-4 w-4" /> Verify &amp; continue
                        </Button>
                        <button
                          onClick={() => setOtpSent(false)}
                          className="mt-2 w-full text-center text-xs text-muted-foreground hover:text-foreground"
                        >
                          Change number
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button onClick={() => checkout(PayMode.PREPAY)} disabled={!selected.size}>
                      <Wallet className="h-4 w-4" /> Prepay
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => checkout(PayMode.AT_VENUE)}
                      disabled={!selected.size}
                    >
                      Pay at venue
                    </Button>
                  </div>
                )}

                {!user && !otpOpen && (
                  <p className="mt-3 text-center text-xs text-muted-foreground">
                    Browse freely — we'll ask for a quick OTP only to confirm.
                  </p>
                )}
              </>
            )}
          </Card>
        </div>
      )}

      <div className="mt-4">
        <Msg text={msg} />
      </div>
    </div>
  );
}
