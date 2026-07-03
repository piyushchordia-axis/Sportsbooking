import {
  BookingResponse,
  PaymentStatus,
  PayMode,
  ResolvedSlot,
  SlotStatus,
} from '@sportsbooking/shared';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Minus,
  Phone,
  Plus,
  Receipt,
  Repeat,
  User,
  Wallet,
} from 'lucide-react';
import { Addon, api, OwnerVenue } from '../../api/client';
import {
  Card,
  EmptyState,
  Field,
  InfoCard,
  Msg,
  PageHeader,
  SectionLabel,
  StatusPill,
  Stepper,
} from '../../components/common';
import { Button } from '../../components/ui/button';
import { SearchableSelect } from '../../components/ui/combobox';
import { DatePicker } from '../../components/ui/date-picker';
import { Switch } from '../../components/ui/switch';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import { fromISODate, toISODate } from '../../lib/date';
import { openCheckout, razorpayEnabled } from '../../lib/razorpay';

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Max occurrences the server allows for a weekly series (PRD §5.2 v1). */
const MAX_OCCURRENCES = 12;

/** A 10-digit Indian mobile, optionally prefixed by +91 / leading 0. */
const MOBILE_RE = /^(?:\+?91|0)?[6-9]\d{9}$/;
const isValidMobile = (v: string) => MOBILE_RE.test(v.replace(/[\s-]/g, ''));

const money = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const addonPrice = (a: Addon) => Number(a.price) || 0;

/**
 * Confirm a prepay booking's Razorpay payment server-side. The `api` client has
 * no method for this endpoint, so we call it directly here, mirroring the
 * client's `/api` base + auth-header convention. The route is `@Public`, but we
 * still forward the token when present.
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

/**
 * Owner/staff offline booking — create a booking on behalf of a phone/walk-in
 * customer (PRD §6.1). Reuses the public availability + booking endpoints; the
 * owner JWT + customer payload attributes the booking and captures them in CRM.
 *
 * Laid out as a guided desk: a left work rail of numbered steps (ground →
 * slots → add-ons → repeat → customer) and a right sticky order summary that
 * tallies the receipt live and, after booking, shows the recurring-series
 * result.
 */
export function NewBookingPage() {
  const [venues, setVenues] = useState<OwnerVenue[]>([]);
  const [venueId, setVenueId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [slots, setSlots] = useState<ResolvedSlot[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Add-ons (PRD-5): per-venue extras the staff can attach to the booking.
  const [addons, setAddons] = useState<Addon[]>([]);
  const [addonsLoading, setAddonsLoading] = useState(false);
  const [addonIds, setAddonIds] = useState<Set<string>>(new Set());

  // Weekly recurrence (PRD-1): repeat the same slots N weeks (AT_VENUE only).
  const [repeat, setRepeat] = useState(false);
  const [occurrences, setOccurrences] = useState(4);

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [mobileTouched, setMobileTouched] = useState(false);
  const [consent, setConsent] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [booking, setBooking] = useState<BookingResponse | null>(null);

  useEffect(() => {
    api
      .listVenues()
      .then((vs) => {
        const list = vs as OwnerVenue[];
        setVenues(list);
        if (list[0]) {
          setVenueId(list[0].id);
          setUnitId(list[0].units[0]?.id ?? '');
        }
      })
      .catch((e) => setMsg((e as Error).message));
  }, []);

  // Load the venue's active add-ons whenever the chosen ground changes.
  useEffect(() => {
    if (!venueId) {
      setAddons([]);
      return;
    }
    let live = true;
    setAddonsLoading(true);
    api
      .listAddons(venueId)
      .then((list) => {
        if (!live) return;
        setAddons(list.filter((a) => a.active));
      })
      .catch(() => live && setAddons([]))
      .finally(() => live && setAddonsLoading(false));
    return () => {
      live = false;
    };
  }, [venueId]);

  const venue = venues.find((v) => v.id === venueId) ?? null;
  const units = venue?.units ?? [];

  const pickVenue = (id: string) => {
    setVenueId(id);
    setUnitId(venues.find((v) => v.id === id)?.units[0]?.id ?? '');
    setSlots([]);
    setSelected(new Set());
    setAddonIds(new Set());
  };

  const load = async () => {
    setMsg(null);
    setBooking(null);
    setSelected(new Set());
    if (!unitId) return;
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

  const toggleAddon = (id: string) => {
    const next = new Set(addonIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setAddonIds(next);
  };

  const setOccurrencesClamped = (n: number) =>
    setOccurrences(Math.min(MAX_OCCURRENCES, Math.max(2, n)));

  const selectedSlots = useMemo(
    () => slots.filter((s) => selected.has(s.start)),
    [slots, selected],
  );
  const slotsTotal = selectedSlots.reduce((sum, s) => sum + s.price, 0);
  const chosenAddons = useMemo(
    () => addons.filter((a) => addonIds.has(a.id)),
    [addons, addonIds],
  );
  const addonsTotal = chosenAddons.reduce((sum, a) => sum + addonPrice(a), 0);
  /** Per-occurrence total — what one booking in the series costs. */
  const occurrenceTotal = slotsTotal + addonsTotal;

  const mobileError = mobileTouched && mobile !== '' && !isValidMobile(mobile);

  const book = async (payMode: PayMode) => {
    if (!venue) return;
    setMsg(null);
    if (!name.trim() || !mobile.trim()) {
      setMsg('Enter the customer name and mobile to continue');
      return;
    }
    if (!isValidMobile(mobile)) {
      setMobileTouched(true);
      setMsg('Enter a valid 10-digit mobile number');
      return;
    }
    const cart = selectedSlots.map((s) => ({
      unitId: s.unitId,
      start: s.start,
      end: s.end,
    }));
    // Recurrence is AT_VENUE-only per the API contract; never send it on prepay.
    const recurrence =
      repeat && payMode === PayMode.AT_VENUE
        ? { frequency: 'weekly' as const, count: occurrences }
        : undefined;
    setBusy(true);
    try {
      const res = await api.createBooking({
        venueId: venue.id,
        slots: cart,
        addonIds: chosenAddons.length ? chosenAddons.map((a) => a.id) : undefined,
        payMode,
        customer: { name: name.trim(), mobile: mobile.trim(), consent },
        recurrence,
      });

      // Production prepay: a live Razorpay key + a server-issued order id means we
      // open the hosted checkout and confirm the payment server-side. In dev (no
      // key) razorpayEnabled is false, so we fall through to the existing
      // mock-payment behavior unchanged.
      if (payMode === PayMode.PREPAY && razorpayEnabled && res.razorpayOrderId) {
        setBooking(res);
        setMsg('Opening secure payment…');
        await openCheckout({
          orderId: res.razorpayOrderId,
          amount: Math.round(res.total * 100),
          name: venue.name,
          prefill: { name: name.trim(), contact: mobile.trim() },
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
              await load();
              setBooking(res);
              setMsg(
                `Booking confirmed for ${name.trim()} — payment received, ${money(res.total)} paid`,
              );
            } catch (e) {
              setMsg((e as Error).message);
            }
          },
        });
        return;
      }

      setBooking(res);
      await load();
      setBooking(res);
      if (res.series) {
        setMsg(
          `Series created for ${name.trim()} — ${res.series.created} booking(s) confirmed` +
            (res.series.skipped.length
              ? `, ${res.series.skipped.length} skipped`
              : ''),
        );
      } else {
        setMsg(
          `Booking confirmed for ${name.trim()} — ${res.status}, ${money(res.total)} (${res.paymentStatus})`,
        );
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const settle = async () => {
    if (!booking) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.settleBooking(booking.id);
      setBooking({ ...booking, paymentStatus: PaymentStatus.PAID });
      setMsg('Marked as settled — paid at the venue');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const awaitingSettlement =
    booking?.payMode === PayMode.AT_VENUE &&
    booking.paymentStatus !== PaymentStatus.PAID &&
    booking.paymentStatus !== PaymentStatus.SETTLED_AT_VENUE;

  // Visual-only wizard progress (no logic change): which step the owner is on.
  const currentStep = slots.length === 0 ? 0 : selected.size === 0 ? 1 : 2;

  const canBook = selected.size > 0 && !busy;

  return (
    <div className="container">
      <PageHeader
        title="New booking"
        subtitle="Book on behalf of a phone or walk-in customer"
        badge={<StatusPill status="open">Offline booking</StatusPill>}
      />

      {venues.length === 0 ? (
        <Card>
          {msg ? (
            <Msg text={msg} />
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
            </div>
          )}
        </Card>
      ) : (
        <>
          <div className="mb-6">
            <Stepper
              steps={[
                { label: 'Availability', icon: CalendarDays },
                { label: 'Slots', icon: Clock },
                { label: 'Customer', icon: User },
              ]}
              current={currentStep}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            {/* ---------- Work rail: the numbered steps ---------- */}
            <div className="lg:col-span-2 space-y-4">
              <StepSection
                step={1}
                title="Ground & date"
                hint="Pick the court and the day, then load the slot grid"
                accent="primary"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <SearchableSelect
                    label="Ground"
                    value={venueId}
                    onChange={pickVenue}
                    options={venues.map((v) => ({ value: v.id, label: v.name }))}
                    searchPlaceholder="Search grounds..."
                  />
                  <div className="w-full sm:max-w-[12rem]">
                    <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Date
                    </span>
                    <DatePicker
                      value={fromISODate(date)}
                      onChange={(d) => setDate(d ? toISODate(d) : todayISO())}
                    />
                  </div>
                </div>

                <SectionLabel className="mb-2 mt-1">Court / turf</SectionLabel>
                <div className="flex flex-wrap gap-2 mb-4">
                  {units.map((u) => {
                    const active = unitId === u.id;
                    return (
                      <button
                        key={u.id}
                        onClick={() => setUnitId(u.id)}
                        aria-pressed={active}
                        className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                          active
                            ? 'bg-primary/12 border-primary/40 text-primary'
                            : 'bg-muted border-border text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {u.name} <span className="opacity-70">({u.label})</span>
                      </button>
                    );
                  })}
                  {units.length === 0 && (
                    <span className="text-sm text-muted-foreground">
                      This ground has no courts yet — add one under Grounds.
                    </span>
                  )}
                </div>

                <Button onClick={load} disabled={!unitId} size="lg">
                  <CalendarDays className="h-4 w-4" /> Load availability
                </Button>
              </StepSection>

              {/* ---------- Step 2: slot grid ---------- */}
              {slots.length > 0 ? (
                <StepSection
                  step={2}
                  title="Pick slots"
                  hint={`Tap open slots for ${date} to add them to the booking`}
                  accent="blue"
                  action={
                    selected.size > 0 ? (
                      <StatusPill status="open">
                        {selected.size} selected
                      </StatusPill>
                    ) : undefined
                  }
                >
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
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
                        cls =
                          'border-primary bg-primary/15 ring-1 ring-primary/40 cursor-pointer';
                      else if (!isOpen)
                        cls =
                          'border-transparent bg-muted opacity-50 cursor-not-allowed';
                      return (
                        <button
                          key={s.start}
                          onClick={() => toggle(s)}
                          disabled={!isOpen}
                          aria-pressed={isSel}
                          className={`flex flex-col items-center justify-center gap-1 rounded-xl border py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${cls}`}
                        >
                          <span className="text-xs font-mono text-muted-foreground">
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
                            {isOpen ? money(s.price) : s.status}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </StepSection>
              ) : (
                <Card>
                  <EmptyState
                    title="No slots loaded yet"
                    hint="Choose a ground, court and date above, then load availability to see the slot grid."
                  />
                </Card>
              )}

              {/* ---------- Step 3: add-ons (PRD-5) ---------- */}
              {slots.length > 0 && (
                <StepSection
                  step={3}
                  title="Add-ons"
                  hint="Attach extras like equipment or refreshments to this booking"
                  accent="orange"
                  action={
                    chosenAddons.length > 0 ? (
                      <StatusPill status="open">
                        {chosenAddons.length} added
                      </StatusPill>
                    ) : undefined
                  }
                >
                  {addonsLoading ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Skeleton className="h-14 w-full" />
                      <Skeleton className="h-14 w-full" />
                    </div>
                  ) : addons.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No add-ons set up for this ground. Create them under
                      Grounds to offer extras here.
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
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
                            className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                              soldOut
                                ? 'border-border bg-muted opacity-50 cursor-not-allowed'
                                : on
                                  ? 'border-primary/40 bg-primary/10 cursor-pointer'
                                  : 'border-border bg-input-background hover:border-primary/40 cursor-pointer'
                            }`}
                          >
                            <span
                              className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${
                                on
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-border'
                              }`}
                            >
                              {on && <Check className="h-3.5 w-3.5" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {a.name}
                              </span>
                              <span className="block text-xs text-muted-foreground capitalize">
                                {a.type}
                                {a.stock !== null &&
                                  ` · ${soldOut ? 'out of stock' : `${a.stock} left`}`}
                              </span>
                            </span>
                            <span className="shrink-0 font-display font-semibold text-sm text-foreground">
                              {money(addonPrice(a))}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </StepSection>
              )}

              {/* ---------- Step 4: repeat weekly (PRD-1) ---------- */}
              {slots.length > 0 && (
                <StepSection
                  step={4}
                  title="Repeat weekly"
                  hint="Book the same slots on the same day for several weeks"
                  accent="purple"
                >
                  <label className="flex items-start justify-between gap-4 cursor-pointer">
                    <span className="flex items-center gap-2.5 text-sm text-foreground">
                      <Repeat className="h-4 w-4 text-muted-foreground" />
                      Repeat this booking every week
                    </span>
                    <Switch
                      checked={repeat}
                      onCheckedChange={setRepeat}
                      aria-label="Repeat weekly"
                    />
                  </label>

                  {repeat && (
                    <div className="mt-4 rounded-xl border border-border bg-elevated p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            Number of weeks
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Including this week · up to {MAX_OCCURRENCES}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => setOccurrencesClamped(occurrences - 1)}
                            disabled={occurrences <= 2}
                            aria-label="One fewer week"
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                          <span className="w-12 text-center font-display font-bold text-xl text-foreground tabular-nums">
                            {occurrences}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => setOccurrencesClamped(occurrences + 1)}
                            disabled={occurrences >= MAX_OCCURRENCES}
                            aria-label="One more week"
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" />
                        Series bookings are paid at the venue. Any week whose
                        slots are already taken is skipped — you'll see the
                        result after booking.
                      </p>
                    </div>
                  )}
                </StepSection>
              )}
            </div>

            {/* ---------- Summary rail: customer + receipt ---------- */}
            {slots.length > 0 && (
              <div className="lg:sticky lg:top-20 space-y-4">
                <InfoCard title="Customer" icon={User} accent="primary">
                  <Field
                    label="Name"
                    value={name}
                    onChange={setName}
                    placeholder="e.g. Priya Sharma"
                  />

                  {/* FE-11: tel input + inputMode + inline validation. */}
                  <label className="block mb-3">
                    <span className="block text-xs font-medium text-muted-foreground mb-1.5">
                      Mobile
                    </span>
                    <div className="relative">
                      <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        maxLength={14}
                        value={mobile}
                        placeholder="10-digit mobile"
                        onChange={(e) => setMobile(e.target.value)}
                        onBlur={() => setMobileTouched(true)}
                        aria-invalid={mobileError}
                        className={`flex h-10 w-full min-w-0 rounded-xl border bg-input-background pl-9 pr-3.5 py-1 text-sm text-foreground transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:ring-2 ${
                          mobileError
                            ? 'border-destructive/60 focus-visible:border-destructive/60 focus-visible:ring-destructive/20'
                            : 'border-border focus-visible:border-primary/50 focus-visible:ring-primary/20'
                        }`}
                      />
                    </div>
                    {mobileError && (
                      <span className="mt-1 block text-xs font-medium text-destructive">
                        Enter a valid 10-digit mobile number
                      </span>
                    )}
                  </label>

                  <label className="flex items-center gap-2 mb-4 text-sm text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      className="h-4 w-4 rounded border-border accent-primary"
                    />
                    Consents to marketing messages
                  </label>

                  {/* ---- Itemised receipt ---- */}
                  <div className="border-t border-border pt-4">
                    <SectionLabel icon={Receipt} className="mb-3">
                      Order summary
                    </SectionLabel>

                    <ReceiptRow
                      label={`Slots × ${selected.size}`}
                      value={money(slotsTotal)}
                    />
                    {chosenAddons.map((a) => (
                      <ReceiptRow
                        key={a.id}
                        label={a.name}
                        value={money(addonPrice(a))}
                        muted
                      />
                    ))}
                    {chosenAddons.length > 0 && (
                      <ReceiptRow
                        label={`Add-ons × ${chosenAddons.length}`}
                        value={money(addonsTotal)}
                      />
                    )}

                    <div className="flex items-end justify-between border-t border-border mt-3 pt-3">
                      <div>
                        <span className="block text-xs text-muted-foreground">
                          {repeat ? 'Per week' : 'Total'}
                        </span>
                        {repeat && (
                          <span className="block text-xs text-muted-foreground">
                            {occurrences} weeks ≈ {money(occurrenceTotal * occurrences)}
                          </span>
                        )}
                      </div>
                      <span className="font-display font-bold text-2xl text-foreground tabular-nums">
                        {money(occurrenceTotal)}
                      </span>
                    </div>
                  </div>

                  {/* ---- Pay actions ---- */}
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    <Button
                      onClick={() => book(PayMode.AT_VENUE)}
                      disabled={!canBook}
                    >
                      <Wallet className="h-4 w-4" /> Pay at venue
                    </Button>
                    {repeat ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="inline-flex">
                            <Button
                              variant="outline"
                              disabled
                              className="w-full"
                            >
                              <CreditCard className="h-4 w-4" /> Prepay
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          Weekly series must be paid at the venue
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => book(PayMode.PREPAY)}
                        disabled={!canBook}
                      >
                        <CreditCard className="h-4 w-4" /> Prepay
                      </Button>
                    )}
                  </div>

                  {booking && awaitingSettlement && (
                    <Button
                      variant="secondary"
                      onClick={settle}
                      disabled={busy}
                      className="w-full mt-3"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Mark settled (paid on
                      the ground)
                    </Button>
                  )}
                </InfoCard>

                {/* ---- Series result ledger (PRD-1) ---- */}
                {booking?.series && (
                  <InfoCard
                    title="Weekly series"
                    icon={Repeat}
                    accent="purple"
                    action={
                      <StatusPill status="confirmed">
                        {booking.series.created} created
                      </StatusPill>
                    }
                  >
                    <div className="flex gap-3">
                      <div className="flex-1 rounded-xl border border-border bg-elevated p-3 text-center">
                        <p className="font-display font-bold text-2xl text-primary tabular-nums">
                          {booking.series.created}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Booked
                        </p>
                      </div>
                      <div className="flex-1 rounded-xl border border-border bg-elevated p-3 text-center">
                        <p className="font-display font-bold text-2xl text-amber-500 tabular-nums">
                          {booking.series.skipped.length}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Skipped
                        </p>
                      </div>
                    </div>

                    {booking.series.skipped.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        <SectionLabel className="mb-1">Skipped weeks</SectionLabel>
                        {booking.series.skipped.map((c) => (
                          <div
                            key={c.start}
                            className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-xs"
                          >
                            <span className="font-medium text-foreground">
                              {new Date(c.start).toLocaleDateString([], {
                                weekday: 'short',
                                day: 'numeric',
                                month: 'short',
                              })}
                            </span>
                            <span className="text-muted-foreground text-right">
                              {c.reason}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </InfoCard>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <div className="mt-4">
        <Msg text={msg} />
      </div>
    </div>
  );
}

/**
 * A numbered work-rail section: a Card with a numbered step marker eyebrow.
 * The numbering is meaningful — booking is a real sequence (ground → slots →
 * extras → repeat → customer), so the markers signpost progress, not decorate.
 */
function StepSection({
  step,
  title,
  hint,
  accent,
  action,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  accent: 'primary' | 'blue' | 'orange' | 'purple';
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card topAccent={accent} className="mb-0">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/12 font-display font-bold text-sm text-primary">
            {step}
          </span>
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-lg leading-none">
              {title}
            </h3>
            {hint && (
              <p className="text-sm text-muted-foreground mt-1.5">{hint}</p>
            )}
          </div>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** A single line in the order-summary receipt. */
function ReceiptRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span
        className={`text-sm ${muted ? 'text-muted-foreground pl-3' : 'text-foreground'}`}
      >
        {label}
      </span>
      <span
        className={`text-sm tabular-nums ${muted ? 'text-muted-foreground' : 'font-medium text-foreground'}`}
      >
        {value}
      </span>
    </div>
  );
}
