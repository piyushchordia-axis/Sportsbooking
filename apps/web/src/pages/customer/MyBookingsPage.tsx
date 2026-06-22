import { BookingStatus, PaymentStatus, PayMode, SkillLevel } from '@sportsbooking/shared';
import { CalendarClock, Check, MapPin, Minus, Plus, Users, XCircle } from 'lucide-react';
import { useState } from 'react';
import { api, CustomerBooking } from '../../api/client';
import {
  Card,
  EmptyState,
  Msg,
  PageHeader,
  StatusPill,
  useLoad,
} from '../../components/common';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '../../components/ui/table';
import { Skeleton } from '../../components/ui/skeleton';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';

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

/** Skill levels in ascending order, used for the min/max range pickers. */
const SKILL_ORDER: SkillLevel[] = [
  SkillLevel.BEGINNER,
  SkillLevel.INTERMEDIATE,
  SkillLevel.ADVANCED,
  SkillLevel.PRO,
];

const SKILL_LABEL: Record<SkillLevel, string> = {
  [SkillLevel.BEGINNER]: 'Beginner',
  [SkillLevel.INTERMEDIATE]: 'Intermediate',
  [SkillLevel.ADVANCED]: 'Advanced',
  [SkillLevel.PRO]: 'Pro',
};

const MIN_SPOTS = 1;
const MAX_SPOTS = 12;

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);

/** Date + time range for a booking's slots (first slot start → last slot end). */
function whenLabel(b: CustomerBooking): { date: string; time: string } {
  if (b.slots.length === 0) {
    const d = new Date(b.createdAt);
    return {
      date: d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
      time: '—',
    };
  }
  const start = new Date(b.slots[0].start);
  const end = new Date(b.slots[b.slots.length - 1].end);
  const fmtTime = (d: Date) =>
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return {
    date: start.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
    time: `${fmtTime(start)} – ${fmtTime(end)}`,
  };
}

/** Distinct court/unit names for a booking. */
const courtLabel = (b: CustomerBooking) =>
  [...new Set(b.slots.map((s) => s.unitName))].join(', ') || '—';

/**
 * A booking can be cancelled while it's still CONFIRMED and its first slot is
 * in the future. Completed / no-show / already-cancelled bookings are not
 * cancellable.
 */
function isCancellable(b: CustomerBooking): boolean {
  if (b.status !== BookingStatus.CONFIRMED) return false;
  if (b.slots.length === 0) return false;
  return new Date(b.slots[0].start).getTime() > Date.now();
}

/**
 * A booking can be opened up as a match while it's still CONFIRMED and its first
 * slot is in the future — the same window as cancellation. Past or non-confirmed
 * bookings can't take new players.
 */
function isHostable(b: CustomerBooking): boolean {
  if (b.status !== BookingStatus.CONFIRMED) return false;
  if (b.slots.length === 0) return false;
  return new Date(b.slots[0].start).getTime() > Date.now();
}

/**
 * Human-readable note about what the customer can expect after cancelling,
 * derived from the booking's payment state. The API confirms the cancellation;
 * any gateway refund follows the venue's cancellation policy.
 */
function refundOutcome(b: CustomerBooking): string {
  if (b.payMode === PayMode.PREPAY && b.paymentStatus === PaymentStatus.PAID) {
    return 'Any eligible refund will be credited per the venue’s cancellation policy.';
  }
  return 'Nothing was charged, so no refund is due.';
}

export function MyBookingsPage() {
  const { data, error, loading, reload } = useLoad<CustomerBooking[]>(
    () => api.myBookings(),
    [],
  );

  const [target, setTarget] = useState<CustomerBooking | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  // Host-an-open-match dialog state.
  const [hostTarget, setHostTarget] = useState<CustomerBooking | null>(null);
  const [openSpots, setOpenSpots] = useState(1);
  const [skillMin, setSkillMin] = useState<SkillLevel>(SkillLevel.BEGINNER);
  const [skillMax, setSkillMax] = useState<SkillLevel>(SkillLevel.PRO);
  const [hosting, setHosting] = useState(false);
  const [hostError, setHostError] = useState<string | null>(null);
  // Bookings hosted during this session — used to relabel/disable the action
  // immediately (the bookings feed doesn't carry an "is hosted" flag).
  const [hostedIds, setHostedIds] = useState<Set<string>>(new Set());

  const closeDialog = () => {
    if (cancelling) return;
    setTarget(null);
    setCancelError(null);
  };

  const openHost = (b: CustomerBooking) => {
    setResult(null);
    setHostError(null);
    setOpenSpots(1);
    setSkillMin(SkillLevel.BEGINNER);
    setSkillMax(SkillLevel.PRO);
    setHostTarget(b);
  };

  const closeHost = () => {
    if (hosting) return;
    setHostTarget(null);
    setHostError(null);
  };

  // Keep the range coherent: nudge the other end so min never exceeds max.
  const changeSkillMin = (v: SkillLevel) => {
    setSkillMin(v);
    if (SKILL_ORDER.indexOf(v) > SKILL_ORDER.indexOf(skillMax)) setSkillMax(v);
  };
  const changeSkillMax = (v: SkillLevel) => {
    setSkillMax(v);
    if (SKILL_ORDER.indexOf(v) < SKILL_ORDER.indexOf(skillMin)) setSkillMin(v);
  };

  const confirmHost = async () => {
    if (!hostTarget) return;
    setHosting(true);
    setHostError(null);
    try {
      await api.createOpenMatch({
        bookingId: hostTarget.id,
        openSpots,
        skillMin,
        skillMax,
      });
      const spotsLabel = openSpots === 1 ? '1 spot' : `${openSpots} spots`;
      setResult(`Match opened — ${spotsLabel} now visible to nearby players.`);
      setHostedIds((prev) => new Set(prev).add(hostTarget.id));
      setHostTarget(null);
      reload();
    } catch (e) {
      setHostError((e as Error).message);
    } finally {
      setHosting(false);
    }
  };

  const confirmCancel = async () => {
    if (!target) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await api.cancelBooking(target.id);
      const message =
        target.payMode === PayMode.PREPAY &&
        target.paymentStatus === PaymentStatus.PAID
          ? 'Booking cancelled. Any eligible refund will be credited per the venue’s cancellation policy.'
          : 'Booking cancelled.';
      setResult(message);
      setTarget(null);
      reload();
    } catch (e) {
      setCancelError((e as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  const bookings = data ?? [];

  return (
    <div className="container">
      <PageHeader
        title="My bookings"
        subtitle="Your upcoming and past court bookings"
        badge={
          !loading && bookings.length > 0 ? (
            <StatusPill status="active">{bookings.length} total</StatusPill>
          ) : undefined
        }
      />

      <Card title="Booking history" topAccent="primary">
        <Msg text={error} />
        {result ? (
          <div className="mb-3 rounded-xl border border-border bg-muted px-3 py-2 text-sm text-foreground">
            {result}
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : bookings.length === 0 ? (
          <EmptyState
            title="No bookings yet"
            hint="Once you book a court it will show up here with its date, status and payment."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Ground</TableHead>
                <TableHead>Court</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((b) => {
                const when = whenLabel(b);
                return (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-2">
                        <CalendarClock className="h-4 w-4 text-muted-foreground" />
                        {when.date}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{when.time}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        {b.venueName}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {courtLabel(b)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {inr(b.total)}
                    </TableCell>
                    <TableCell>
                      <StatusPill status={b.status}>
                        {STATUS_LABEL[b.status] ?? b.status}
                      </StatusPill>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <StatusPill status={b.paymentStatus}>
                          {PAYMENT_LABEL[b.paymentStatus] ?? b.paymentStatus}
                        </StatusPill>
                        <span className="text-[11px] text-muted-foreground">
                          {PAY_MODE_LABEL[b.payMode] ?? b.payMode}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {isCancellable(b) || isHostable(b) ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          {isHostable(b) &&
                            (hostedIds.has(b.id) ? (
                              <Button variant="ghost" size="sm" disabled>
                                <Check className="h-4 w-4" />
                                Match open
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openHost(b)}
                              >
                                <Users className="h-4 w-4" />
                                Host an open match
                              </Button>
                            ))}
                          {isCancellable(b) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setResult(null);
                                setCancelError(null);
                                setTarget(b);
                              }}
                            >
                              <XCircle className="h-4 w-4" />
                              Cancel booking
                            </Button>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={target != null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent showCloseButton={!cancelling}>
          <DialogHeader>
            <DialogTitle>Cancel this booking?</DialogTitle>
            <DialogDescription>
              {target ? (
                <>
                  {whenLabel(target).date} · {whenLabel(target).time} ·{' '}
                  {target.venueName}. {refundOutcome(target)}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <Msg text={cancelError} />
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={cancelling}>
              Keep booking
            </Button>
            <Button
              variant="destructive"
              onClick={confirmCancel}
              disabled={cancelling}
            >
              {cancelling ? 'Cancelling…' : 'Cancel booking'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={hostTarget != null}
        onOpenChange={(open) => !open && closeHost()}
      >
        <DialogContent showCloseButton={!hosting}>
          <DialogHeader>
            <DialogTitle>Host an open match</DialogTitle>
            <DialogDescription>
              {hostTarget ? (
                <>
                  Invite players to fill your court on{' '}
                  {whenLabel(hostTarget).date} · {whenLabel(hostTarget).time} at{' '}
                  {hostTarget.venueName}.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <span className="block text-xs font-medium text-muted-foreground mb-1.5">
                Open spots
              </span>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Remove a spot"
                  disabled={hosting || openSpots <= MIN_SPOTS}
                  onClick={() =>
                    setOpenSpots((n) => Math.max(MIN_SPOTS, n - 1))
                  }
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={MIN_SPOTS}
                  max={MAX_SPOTS}
                  value={openSpots}
                  disabled={hosting}
                  onChange={(e) => {
                    const n = Math.floor(Number(e.target.value));
                    if (Number.isNaN(n)) return;
                    setOpenSpots(Math.min(MAX_SPOTS, Math.max(MIN_SPOTS, n)));
                  }}
                  className="h-10 w-20 rounded-xl border border-border bg-input-background px-3 text-center text-sm font-semibold tabular-nums text-foreground outline-none transition-[color,box-shadow] focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Add a spot"
                  disabled={hosting || openSpots >= MAX_SPOTS}
                  onClick={() =>
                    setOpenSpots((n) => Math.min(MAX_SPOTS, n + 1))
                  }
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  player{openSpots === 1 ? '' : 's'} can join
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Skill from
                </span>
                <Select
                  value={skillMin}
                  onValueChange={(v) => changeSkillMin(v as SkillLevel)}
                  disabled={hosting}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SKILL_ORDER.map((s) => (
                      <SelectItem key={s} value={s}>
                        {SKILL_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Skill to
                </span>
                <Select
                  value={skillMax}
                  onValueChange={(v) => changeSkillMax(v as SkillLevel)}
                  disabled={hosting}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SKILL_ORDER.map((s) => (
                      <SelectItem key={s} value={s}>
                        {SKILL_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
          </div>

          <Msg text={hostError} />
          <DialogFooter>
            <Button variant="outline" onClick={closeHost} disabled={hosting}>
              Cancel
            </Button>
            <Button onClick={confirmHost} disabled={hosting}>
              {hosting ? 'Opening match…' : 'Open match'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
