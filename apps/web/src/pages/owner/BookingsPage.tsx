import {
  BookingStatus,
  OwnerBooking,
  PaymentStatus,
  PayMode,
  ResolvedSlot,
  SlotStatus,
} from '@sportsbooking/shared';
import { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  ListChecks,
  Search,
  SlidersHorizontal,
  User,
  X,
} from 'lucide-react';
import { api, OwnerVenue, PaymentTxn } from '../../api/client';
import {
  Card,
  EmptyState,
  Field,
  InfoCard,
  KeyVal,
  Msg,
  PageHeader,
  SectionLabel,
  Select,
  StatusPill,
  useLoad,
} from '../../components/common';
import { Button } from '../../components/ui/button';
import { SearchableSelect } from '../../components/ui/combobox';
import { Badge } from '../../components/ui/badge';
import {
  DateRangePicker,
  type DateRangeValue,
} from '../../components/ui/date-range-picker';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '../../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { Skeleton } from '../../components/ui/skeleton';

const STATUS_LABEL: Record<BookingStatus, string> = {
  [BookingStatus.CONFIRMED]: 'Confirmed',
  [BookingStatus.COMPLETED]: 'Completed',
  [BookingStatus.NO_SHOW]: 'No-show',
  [BookingStatus.CANCELLED]: 'Cancelled',
};

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  [PaymentStatus.PENDING]: 'Pending',
  [PaymentStatus.PAID]: 'Paid',
  [PaymentStatus.AWAITING_VENUE_SETTLEMENT]: 'Awaiting',
  [PaymentStatus.SETTLED_AT_VENUE]: 'Settled',
  [PaymentStatus.REFUNDED]: 'Refunded',
  [PaymentStatus.FAILED]: 'Failed',
};

const PAY_MODE_LABEL: Record<PayMode, string> = {
  [PayMode.PREPAY]: 'Prepay',
  [PayMode.AT_VENUE]: 'Pay at venue',
};

type BadgeVariant = 'default' | 'secondary' | 'accent' | 'destructive' | 'outline';

const STATUS_VARIANT: Record<BookingStatus, BadgeVariant> = {
  [BookingStatus.CONFIRMED]: 'default',
  [BookingStatus.COMPLETED]: 'default',
  [BookingStatus.NO_SHOW]: 'accent',
  [BookingStatus.CANCELLED]: 'destructive',
};

const PAYMENT_VARIANT: Record<PaymentStatus, BadgeVariant> = {
  [PaymentStatus.PENDING]: 'accent',
  [PaymentStatus.PAID]: 'default',
  [PaymentStatus.AWAITING_VENUE_SETTLEMENT]: 'accent',
  [PaymentStatus.SETTLED_AT_VENUE]: 'default',
  [PaymentStatus.REFUNDED]: 'secondary',
  [PaymentStatus.FAILED]: 'destructive',
};

/** Convert a Date to a local `YYYY-MM-DD` string the bookings API expects. */
const toISODate = (d?: Date) =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate(),
      ).padStart(2, '0')}`
    : '';

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
  const [range, setRange] = useState<DateRangeValue>({});
  const [venueId, setVenueId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [q, setQ] = useState('');

  const from = toISODate(range.from);
  const to = toISODate(range.to);

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

  const hasFilters = Boolean(
    range.from || range.to || venueId || unitId || status || paymentStatus || q,
  );

  const clearFilters = () => {
    setRange({});
    setVenueId('');
    setUnitId('');
    setStatus('');
    setPaymentStatus('');
    setQ('');
  };

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
    { value: '', label: 'All grounds' },
    ...venues.map((v) => ({ value: v.id, label: v.name })),
  ];
  const unitOpts = [
    { value: '', label: 'All courts' },
    ...venueUnits.map((u) => ({ value: u.id, label: u.name })),
  ];

  const total = list.data?.length ?? 0;

  return (
    <div className="container">
      <PageHeader
        title="Bookings"
        subtitle="Review, reschedule, settle and update your bookings"
        badge={
          list.data ? (
            <Badge variant="outline" className="tabular-nums">
              {total} {total === 1 ? 'booking' : 'bookings'}
            </Badge>
          ) : undefined
        }
      />

      {/* Filters */}
      <Card className="mb-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <SectionLabel icon={SlidersHorizontal}>Filters</SectionLabel>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" /> Clear all
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
          {/* Date range spans two columns so it reads as the primary control. */}
          <div className="mb-3 sm:col-span-2">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Date range
            </span>
            <DateRangePicker
              value={range}
              onChange={setRange}
              placeholder="Any date"
              align="start"
            />
          </div>
          <SearchableSelect
            label="Venue"
            value={venueId}
            onChange={pickVenue}
            options={venueOpts}
            searchPlaceholder="Search grounds..."
          />
          <SearchableSelect
            label="Court"
            value={unitId}
            onChange={setUnitId}
            options={unitOpts}
            searchPlaceholder="Search courts..."
          />
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
          <div className="sm:col-span-2">
            <label className="mb-3 block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Search customer
              </span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={q}
                  placeholder="Name or mobile"
                  onChange={(e) => setQ(e.target.value)}
                  className="flex h-10 w-full min-w-0 rounded-xl border border-border bg-input-background pl-9 pr-3.5 py-1 text-sm text-foreground outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
                />
              </div>
            </label>
          </div>
        </div>
      </Card>

      {/* List */}
      {list.error ? (
        <Card>
          <Msg text={list.error} />
          <Button
            variant="secondary"
            size="sm"
            onClick={list.reload}
            className="mt-3"
          >
            Try again
          </Button>
        </Card>
      ) : list.loading && !list.data ? (
        <Card className="p-0">
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      ) : !list.data || list.data.length === 0 ? (
        <Card>
          <EmptyState
            title={hasFilters ? 'No bookings match your filters' : 'No bookings yet'}
            hint={
              hasFilters
                ? 'Widen the date range or clear filters to see more.'
                : 'New bookings made at your venues will show up here.'
            }
          />
          {hasFilters && (
            <div className="flex justify-center pb-2">
              <Button variant="secondary" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-5">Customer</TableHead>
                <TableHead className="px-5">Venue / court</TableHead>
                <TableHead className="px-5">When</TableHead>
                <TableHead className="px-5">Status</TableHead>
                <TableHead className="px-5">Payment</TableHead>
                <TableHead className="px-5">Pay mode</TableHead>
                <TableHead className="px-5 text-right">Total</TableHead>
                <TableHead className="px-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((b) => {
                const first = b.slots[0];
                const extra = b.slots.length - 1;
                return (
                  <TableRow key={b.id}>
                    <TableCell className="px-5 py-3.5">
                      <p className="font-medium text-foreground">
                        {b.customerName ?? 'Unknown'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {b.customerMobile ?? '—'}
                      </p>
                    </TableCell>
                    <TableCell className="px-5 py-3.5">
                      <p className="text-foreground">{b.venueName}</p>
                      <p className="text-xs text-muted-foreground">
                        {first?.unitName ?? '—'}
                        {extra > 0 && ` +${extra}`}
                      </p>
                    </TableCell>
                    <TableCell className="px-5 py-3.5 whitespace-nowrap">
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
                    </TableCell>
                    <TableCell className="px-5 py-3.5">
                      <Badge variant={STATUS_VARIANT[b.status]}>
                        {STATUS_LABEL[b.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-5 py-3.5">
                      <Badge variant={PAYMENT_VARIANT[b.paymentStatus]}>
                        {PAYMENT_LABEL[b.paymentStatus]}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-5 py-3.5 whitespace-nowrap text-sm text-muted-foreground">
                      {PAY_MODE_LABEL[b.payMode]}
                    </TableCell>
                    <TableCell className="px-5 py-3.5 text-right font-display font-semibold whitespace-nowrap">
                      ₹{b.total}
                    </TableCell>
                    <TableCell className="px-5 py-3.5 text-right">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setEditingId(b.id)}
                      >
                        Manage
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
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
  const [payments, setPayments] = useState<PaymentTxn[]>([]);
  const [payKey, setPayKey] = useState(0);

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

  // Load the gateway payment history (captures + refunds); refreshes after an
  // action (payKey) so a just-issued refund appears.
  useEffect(() => {
    let alive = true;
    api
      .listPayments('booking', booking.id)
      .then((rows) => alive && setPayments(rows))
      .catch(() => alive && setPayments([]));
    return () => {
      alive = false;
    };
  }, [booking.id, payKey]);

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
      setPayKey((k) => k + 1);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (s: BookingStatus, ok: string) =>
    run(() => api.updateBookingStatus(booking.id, s), ok);

  // Mark no-show: backend applies the venue's flat no-show fee (idempotent via
  // Booking.noShowFeeApplied). Confirm first so staff know the customer will be
  // charged, then surface the outcome.
  const markNoShow = () => {
    const ok = window.confirm(
      "Mark this booking as a no-show? The venue's no-show fee will be charged to the customer.",
    );
    if (!ok) return;
    return run(
      () => api.updateBookingStatus(booking.id, BookingStatus.NO_SHOW),
      "Marked as no-show — the venue's no-show fee has been applied to the customer.",
    );
  };

  // Cancel: backend refunds per the venue's cancellation policy. Cash for
  // prepaid bookings (a cancellation fee may be withheld), session/loyalty
  // credit otherwise. Confirm first, then surface the expected outcome.
  const cancelBooking = () => {
    const prepaid =
      booking.payMode === PayMode.PREPAY &&
      booking.paymentStatus === PaymentStatus.PAID;
    const ok = window.confirm(
      prepaid
        ? "Cancel this booking? The customer will be refunded per the venue's cancellation policy — a cancellation fee may be withheld."
        : 'Cancel this booking? Any pack sessions or loyalty credit used will be returned to the customer.',
    );
    if (!ok) return;
    return run(
      () => api.cancelBooking(booking.id),
      prepaid
        ? "Booking cancelled — refund issued per the venue's cancellation policy (any cancellation fee withheld)."
        : 'Booking cancelled — any pack sessions or loyalty credit have been returned.',
    );
  };

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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="flex flex-row items-start justify-between gap-3 p-5 border-b border-border text-left space-y-0">
          <div className="min-w-0">
            <DialogTitle className="font-display font-bold text-xl">
              Manage booking
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1 truncate">
              {booking.venueName} · {booking.customerName ?? 'Unknown'}
            </DialogDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0 pr-8">
            <StatusPill status={booking.status}>{STATUS_LABEL[booking.status]}</StatusPill>
          </div>
        </DialogHeader>

        <div className="p-5 space-y-4">
          {/* Booking detail */}
          <InfoCard title="Booking detail" icon={CalendarDays} accent="blue">
            <KeyVal label="Venue" value={booking.venueName} />
            <KeyVal label="Customer" value={booking.customerName ?? 'Unknown'} />
            <KeyVal label="Mobile" value={booking.customerMobile ?? ''} />
            <KeyVal
              label="Status"
              value={<StatusPill status={booking.status}>{STATUS_LABEL[booking.status]}</StatusPill>}
            />
            <KeyVal
              label="Payment"
              value={
                <StatusPill status={booking.paymentStatus}>
                  {PAYMENT_LABEL[booking.paymentStatus]}
                </StatusPill>
              }
            />
            <KeyVal label="Pay mode" value={PAY_MODE_LABEL[booking.payMode]} />
            <KeyVal label="Total" value={`₹${booking.total}`} />
          </InfoCard>

          {/* Payment history (gateway captures + refunds) */}
          {payments.length > 0 && (
            <div>
              <SectionLabel icon={CreditCard} className="mb-2">
                Payment history
              </SectionLabel>
              <div className="space-y-1.5">
                {payments.map((p) => {
                  const isRefund = p.type === 'refund';
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          className={
                            'shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ' +
                            (isRefund
                              ? 'bg-amber-500/15 text-amber-500'
                              : 'bg-primary/15 text-primary')
                          }
                        >
                          {isRefund ? 'Refund' : 'Capture'}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {fmtDateTime(p.createdAt)}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        {Number(p.fee) > 0 && (
                          <span className="text-xs text-muted-foreground">
                            fee ₹{p.fee}
                          </span>
                        )}
                        <span className="tabular-nums font-medium text-foreground">
                          {isRefund ? '−' : ''}₹{p.amount}
                        </span>
                        <span className="text-xs capitalize text-muted-foreground">
                          {p.status}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Current slots */}
          <div>
            <SectionLabel icon={CalendarClock} className="mb-2">
              Current slots
            </SectionLabel>
            <div className="flex flex-wrap gap-2">
              {booking.slots.map((s) => (
                <span
                  key={s.start}
                  className="px-2.5 py-1 rounded-lg bg-muted text-foreground text-xs"
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
            <SectionLabel icon={ListChecks} className="mb-2">
              Status &amp; payment
            </SectionLabel>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() =>
                  setStatus(BookingStatus.COMPLETED, 'Marked as completed.')
                }
                disabled={busy || cancelled || booking.status === BookingStatus.COMPLETED}
                size="sm"
              >
                <CheckCircle2 className="h-4 w-4" /> Mark completed
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={markNoShow}
                disabled={busy || cancelled || booking.status === BookingStatus.NO_SHOW}
                className="border-amber-500/40 text-amber-500 hover:bg-amber-500/10 hover:border-amber-500/60"
              >
                Mark no-show
              </Button>
              {canSettle && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={settle}
                  disabled={busy}
                >
                  <CreditCard className="h-4 w-4" /> Record payment
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={cancelBooking}
                disabled={busy || cancelled}
                className="ml-auto border-destructive/40 text-destructive hover:bg-destructive/10 hover:border-destructive/60"
              >
                Cancel booking
              </Button>
            </div>
            {!cancelled && (
              <p className="mt-2 text-xs text-muted-foreground">
                No-show charges the venue&apos;s no-show fee to the customer.
                Cancelling refunds the customer per the venue&apos;s cancellation
                policy (any cancellation fee withheld), or returns pack/loyalty
                credit.
              </p>
            )}
          </div>

          {/* Customer */}
          <div>
            <SectionLabel icon={User} className="mb-2">
              Customer details
            </SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
              <Field label="Name" value={name} onChange={setName} />
              <Field label="Mobile" value={mobile} onChange={setMobile} />
            </div>
            <Button variant="secondary" size="sm" onClick={saveCustomer} disabled={busy}>
              Save customer
            </Button>
          </div>

          {/* Reschedule */}
          {!cancelled && (
            <div>
              <SectionLabel icon={CalendarClock} className="mb-2">
                Reschedule
              </SectionLabel>
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
                <Button
                  className="mb-3"
                  size="sm"
                  onClick={loadAvailability}
                  disabled={!rUnit || busy}
                >
                  Load availability
                </Button>
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
                          'border-transparent bg-muted/40 opacity-50 cursor-not-allowed';
                      return (
                        <button
                          key={s.start}
                          onClick={() => toggle(s)}
                          disabled={!isOpen}
                          aria-pressed={isSel}
                          className={`flex flex-col items-center justify-center gap-0.5 rounded-xl border py-2 transition-colors ${cls}`}
                        >
                          <span className="text-[11px] text-muted-foreground">
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
                    <Button
                      size="sm"
                      onClick={confirmReschedule}
                      disabled={busy || selected.size === 0}
                    >
                      Confirm reschedule
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          <Msg text={msg} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
