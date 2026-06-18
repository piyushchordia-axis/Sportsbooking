import {
  BookingStatus,
  OwnerBooking,
  PaymentStatus,
  PayMode,
  ResolvedSlot,
  SlotStatus,
} from '@sportsbooking/shared';
import { useEffect, useMemo, useState } from 'react';
import { api, OwnerVenue } from '../../api/client';
import {
  EmptyState,
  Field,
  Msg,
  PageHeader,
  Select,
  useLoad,
} from '../../components/common';

const STATUS_META: Record<
  BookingStatus,
  { label: string; tone: 'green' | 'red' | 'amber' | 'blue' | 'gray' }
> = {
  [BookingStatus.CONFIRMED]: { label: 'Confirmed', tone: 'blue' },
  [BookingStatus.COMPLETED]: { label: 'Completed', tone: 'green' },
  [BookingStatus.NO_SHOW]: { label: 'No-show', tone: 'amber' },
  [BookingStatus.CANCELLED]: { label: 'Cancelled', tone: 'red' },
};

const PAYMENT_META: Record<
  PaymentStatus,
  { label: string; tone: 'green' | 'red' | 'amber' | 'blue' | 'gray' }
> = {
  [PaymentStatus.PENDING]: { label: 'Pending', tone: 'gray' },
  [PaymentStatus.PAID]: { label: 'Paid', tone: 'green' },
  [PaymentStatus.AWAITING_VENUE_SETTLEMENT]: { label: 'Awaiting', tone: 'amber' },
  [PaymentStatus.SETTLED_AT_VENUE]: { label: 'Settled', tone: 'green' },
  [PaymentStatus.REFUNDED]: { label: 'Refunded', tone: 'gray' },
  [PaymentStatus.FAILED]: { label: 'Failed', tone: 'red' },
};

const PAY_MODE_LABEL: Record<PayMode, string> = {
  [PayMode.PREPAY]: 'Prepay',
  [PayMode.AT_VENUE]: 'Pay at venue',
};

const TONE: Record<string, string> = {
  green: 'bg-primary/15 text-primary',
  red: 'bg-destructive/15 text-destructive',
  amber: 'bg-amber-400/15 text-amber-500',
  blue: 'bg-blue-400/15 text-blue-400',
  gray: 'bg-secondary text-secondary-foreground/70',
};

function Pill({ text, tone }: { text: string; tone: string }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-widest ${TONE[tone]}`}
    >
      {text}
    </span>
  );
}

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString([], {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * Owner/staff booking management (PRD §4.3). A filterable directory of the
 * tenant's bookings with edit actions: reschedule, change status, record
 * payment, and edit the customer's name/mobile.
 */
export function BookingsPage() {
  const [venues, setVenues] = useState<OwnerVenue[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [venueId, setVenueId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [q, setQ] = useState('');

  // Debounce filters into an "applied" key so typing doesn't refetch per keystroke.
  const [applied, setApplied] = useState({
    from: '',
    to: '',
    venueId: '',
    unitId: '',
    status: '',
    paymentStatus: '',
    q: '',
  });
  useEffect(() => {
    const t = setTimeout(
      () => setApplied({ from, to, venueId, unitId, status, paymentStatus, q }),
      250,
    );
    return () => clearTimeout(t);
  }, [from, to, venueId, unitId, status, paymentStatus, q]);

  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    api
      .listVenues()
      .then((vs) => setVenues(vs as OwnerVenue[]))
      .catch(() => undefined);
  }, []);

  const list = useLoad<OwnerBooking[]>(
    () =>
      api.listBookings({
        from: applied.from || undefined,
        to: applied.to || undefined,
        venueId: applied.venueId || undefined,
        unitId: applied.unitId || undefined,
        status: (applied.status as BookingStatus) || undefined,
        paymentStatus: (applied.paymentStatus as PaymentStatus) || undefined,
        q: applied.q || undefined,
      }),
    [JSON.stringify(applied)],
  );

  const venueUnits = useMemo(
    () => venues.find((v) => v.id === venueId)?.units ?? [],
    [venues, venueId],
  );

  const pickVenue = (id: string) => {
    setVenueId(id);
    setUnitId('');
  };

  const editing = list.data?.find((b) => b.id === editingId) ?? null;

  const venueOpts = [
    { value: '', label: 'All venues' },
    ...venues.map((v) => ({ value: v.id, label: v.name })),
  ];
  const unitOpts = [
    { value: '', label: 'All courts' },
    ...venueUnits.map((u) => ({ value: u.id, label: u.name })),
  ];

  return (
    <div className="container">
      <PageHeader
        title="Bookings"
        subtitle="View, reschedule, settle and update your bookings"
      />

      {/* Filters */}
      <div className="bg-card border border-border rounded-xl p-5 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4">
          <Field label="From" type="date" value={from} onChange={setFrom} />
          <Field label="To" type="date" value={to} onChange={setTo} />
          <Select label="Venue" value={venueId} onChange={pickVenue} options={venueOpts} />
          <Select label="Court" value={unitId} onChange={setUnitId} options={unitOpts} />
          <Select
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: '', label: 'All statuses' },
              { value: BookingStatus.CONFIRMED, label: 'Confirmed' },
              { value: BookingStatus.COMPLETED, label: 'Completed' },
              { value: BookingStatus.NO_SHOW, label: 'No-show' },
              { value: BookingStatus.CANCELLED, label: 'Cancelled' },
            ]}
          />
          <Select
            label="Payment"
            value={paymentStatus}
            onChange={setPaymentStatus}
            options={[
              { value: '', label: 'All payments' },
              { value: PaymentStatus.PENDING, label: 'Pending' },
              {
                value: PaymentStatus.AWAITING_VENUE_SETTLEMENT,
                label: 'Awaiting settlement',
              },
              { value: PaymentStatus.SETTLED_AT_VENUE, label: 'Settled at venue' },
              { value: PaymentStatus.PAID, label: 'Paid' },
              { value: PaymentStatus.REFUNDED, label: 'Refunded' },
              { value: PaymentStatus.FAILED, label: 'Failed' },
            ]}
          />
          <div className="lg:col-span-2">
            <Field
              label="Search customer"
              value={q}
              onChange={setQ}
              placeholder="Name or mobile"
            />
          </div>
        </div>
      </div>

      {/* List */}
      {list.error ? (
        <Msg text={list.error} />
      ) : list.loading && !list.data ? (
        <p className="text-muted-foreground text-sm py-6">Loading bookings…</p>
      ) : !list.data || list.data.length === 0 ? (
        <EmptyState
          title="No bookings match"
          hint="Try widening the date range or clearing filters."
        />
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Customer
                  </th>
                  <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Venue / court
                  </th>
                  <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    When
                  </th>
                  <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Payment
                  </th>
                  <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Pay mode
                  </th>
                  <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-right">
                    Total
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((b) => {
                  const first = b.slots[0];
                  const extra = b.slots.length - 1;
                  return (
                    <tr key={b.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">
                          {b.customerName ?? 'Unknown'}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {b.customerMobile ?? '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-foreground">{b.venueName}</p>
                        <p className="text-xs text-muted-foreground">
                          {first?.unitName ?? '—'}
                          {extra > 0 && ` +${extra}`}
                        </p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {first ? (
                          <>
                            <p className="text-foreground">{fmtDateTime(first.start)}</p>
                            <p className="text-xs text-muted-foreground">
                              {b.slots.length} slot{b.slots.length === 1 ? '' : 's'}
                            </p>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Pill
                          text={STATUS_META[b.status].label}
                          tone={STATUS_META[b.status].tone}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Pill
                          text={PAYMENT_META[b.paymentStatus].label}
                          tone={PAYMENT_META[b.paymentStatus].tone}
                        />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted-foreground">
                        {PAY_MODE_LABEL[b.payMode]}
                      </td>
                      <td className="px-4 py-3 text-right font-display font-semibold whitespace-nowrap">
                        ₹{b.total}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setEditingId(b.id)}
                          className="px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <BookingEditor
          booking={editing}
          venues={venues}
          onClose={() => setEditingId(null)}
          onChanged={list.reload}
        />
      )}
    </div>
  );
}

function BookingEditor({
  booking,
  venues,
  onClose,
  onChanged,
}: {
  booking: OwnerBooking;
  venues: OwnerVenue[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(booking.customerName ?? '');
  const [mobile, setMobile] = useState(booking.customerMobile ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const units = venues.find((v) => v.id === booking.venueId)?.units ?? [];
  const firstSlot = booking.slots[0];

  const [rUnit, setRUnit] = useState(firstSlot?.unitId ?? units[0]?.id ?? '');
  const [rDate, setRDate] = useState(
    firstSlot ? firstSlot.start.slice(0, 10) : todayISO(),
  );
  const [slots, setSlots] = useState<ResolvedSlot[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset all editor state when switching to a different booking.
  useEffect(() => {
    setName(booking.customerName ?? '');
    setMobile(booking.customerMobile ?? '');
    setRUnit(booking.slots[0]?.unitId ?? units[0]?.id ?? '');
    setRDate(booking.slots[0] ? booking.slots[0].start.slice(0, 10) : todayISO());
    setSlots([]);
    setSelected(new Set());
    setMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.id]);

  const cancelled = booking.status === BookingStatus.CANCELLED;
  const canSettle =
    booking.payMode === PayMode.AT_VENUE &&
    booking.paymentStatus !== PaymentStatus.PAID &&
    booking.paymentStatus !== PaymentStatus.SETTLED_AT_VENUE &&
    !cancelled;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (s: BookingStatus, ok: string) =>
    run(() => api.updateBookingStatus(booking.id, s), ok);

  const settle = () =>
    run(() => api.settleBooking(booking.id), 'Payment recorded — settled at venue.');

  const saveCustomer = () => {
    if (!name.trim() || !mobile.trim()) {
      setMsg('Name and mobile are required.');
      return;
    }
    return run(
      () =>
        api.updateBookingCustomer(booking.id, {
          name: name.trim(),
          mobile: mobile.trim(),
        }),
      'Customer details updated.',
    );
  };

  const loadAvailability = async () => {
    setMsg(null);
    setSelected(new Set());
    if (!rUnit) return;
    try {
      const res = await api.availability(rUnit, rDate);
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

  const newTotal = slots
    .filter((s) => selected.has(s.start))
    .reduce((sum, s) => sum + s.price, 0);

  const confirmReschedule = () => {
    const cart = slots
      .filter((s) => selected.has(s.start))
      .map((s) => ({ unitId: s.unitId, start: s.start, end: s.end }));
    if (cart.length === 0) {
      setMsg('Pick at least one new slot.');
      return;
    }
    return run(() => api.rescheduleBooking(booking.id, cart), 'Booking rescheduled.');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl w-full max-w-2xl my-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b border-border">
          <div>
            <h3 className="font-display font-bold text-xl">Manage booking</h3>
            <p className="text-xs text-muted-foreground font-mono mt-1">
              {booking.venueName} · {booking.customerName ?? 'Unknown'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Pill text={STATUS_META[booking.status].label} tone={STATUS_META[booking.status].tone} />
            <button
              onClick={onClose}
              className="grid place-items-center h-8 w-8 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-5 space-y-6">
          {/* Current slots */}
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
              Current slots
            </p>
            <div className="flex flex-wrap gap-2">
              {booking.slots.map((s) => (
                <span
                  key={s.start}
                  className="px-2.5 py-1 rounded-lg bg-secondary text-secondary-foreground text-xs"
                >
                  {s.unitName} · {fmtDateTime(s.start)}–{fmtTime(s.end)}
                </span>
              ))}
              {booking.slots.length === 0 && (
                <span className="text-sm text-muted-foreground">No slots (cancelled).</span>
              )}
            </div>
          </div>

          {/* Status + payment */}
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
              Status &amp; payment
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() =>
                  setStatus(BookingStatus.COMPLETED, 'Marked as completed.')
                }
                disabled={busy || cancelled || booking.status === BookingStatus.COMPLETED}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors"
              >
                Mark completed
              </button>
              <button
                onClick={() => setStatus(BookingStatus.NO_SHOW, 'Marked as no-show.')}
                disabled={busy || cancelled || booking.status === BookingStatus.NO_SHOW}
                className="px-3 py-1.5 rounded-lg border border-amber-400/60 text-amber-500 text-sm font-medium disabled:opacity-40 hover:bg-amber-400/10 transition-colors"
              >
                Mark no-show
              </button>
              {canSettle && (
                <button
                  onClick={settle}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-medium disabled:opacity-40 hover:bg-accent/90 transition-colors"
                >
                  Record payment
                </button>
              )}
              <button
                onClick={() => setStatus(BookingStatus.CANCELLED, 'Booking cancelled.')}
                disabled={busy || cancelled}
                className="px-3 py-1.5 rounded-lg border border-destructive/60 text-destructive text-sm font-medium disabled:opacity-40 hover:bg-destructive/10 transition-colors ml-auto"
              >
                Cancel booking
              </button>
            </div>
          </div>

          {/* Customer */}
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
              Customer details
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
              <Field label="Name" value={name} onChange={setName} />
              <Field label="Mobile" value={mobile} onChange={setMobile} />
            </div>
            <button
              onClick={saveCustomer}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-semibold disabled:opacity-40 hover:bg-secondary/80 transition-colors"
            >
              Save customer
            </button>
          </div>

          {/* Reschedule */}
          {!cancelled && (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                Reschedule
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-40">
                  <Select
                    label="Court"
                    value={rUnit}
                    onChange={setRUnit}
                    options={units.map((u) => ({ value: u.id, label: u.name }))}
                  />
                </div>
                <div className="w-40">
                  <Field label="Date" type="date" value={rDate} onChange={setRDate} />
                </div>
                <button
                  onClick={loadAvailability}
                  disabled={!rUnit || busy}
                  className="mb-3 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40 hover:bg-primary/90 transition-colors"
                >
                  Load availability
                </button>
              </div>

              {slots.length > 0 && (
                <>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 mt-2">
                    {slots.map((s) => {
                      const isOpen = s.status === SlotStatus.OPEN;
                      const isSel = selected.has(s.start);
                      let cls =
                        'border-border bg-input-background hover:border-primary/50 cursor-pointer';
                      if (isSel)
                        cls =
                          'border-primary bg-primary/15 ring-1 ring-primary/40 cursor-pointer';
                      else if (!isOpen)
                        cls =
                          'border-transparent bg-secondary/40 opacity-50 cursor-not-allowed';
                      return (
                        <button
                          key={s.start}
                          onClick={() => toggle(s)}
                          disabled={!isOpen}
                          aria-pressed={isSel}
                          className={`flex flex-col items-center justify-center gap-0.5 rounded-lg border py-2 transition-colors ${cls}`}
                        >
                          <span className="text-[11px] font-mono text-muted-foreground">
                            {fmtTime(s.start)}
                          </span>
                          <span
                            className={`text-sm font-display font-semibold ${
                              isSel ? 'text-primary' : isOpen ? 'text-foreground' : 'text-muted-foreground'
                            }`}
                          >
                            {isOpen ? `₹${s.price}` : s.status}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-sm text-muted-foreground">
                      {selected.size} slot(s) · ₹{newTotal}
                    </span>
                    <button
                      onClick={confirmReschedule}
                      disabled={busy || selected.size === 0}
                      className="px-4 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-semibold disabled:opacity-40 hover:bg-accent/90 transition-colors"
                    >
                      Confirm reschedule
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <Msg text={msg} />
        </div>
      </div>
    </div>
  );
}
