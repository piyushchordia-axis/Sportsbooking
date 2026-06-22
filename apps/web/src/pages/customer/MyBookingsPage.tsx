import { BookingStatus, PaymentStatus, PayMode, SkillLevel } from '@sportsbooking/shared';
import { Check, Minus, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { api, CustomerBooking } from '../../api/client';
import { Msg, useLoad } from '../../components/common';
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
import { useFloodlitToast, flMoney } from '../../floodlit/toast';

const STATUS_LABEL: Record<BookingStatus, string> = {
  [BookingStatus.CONFIRMED]: 'Confirmed',
  [BookingStatus.COMPLETED]: 'Played',
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

/**
 * Pill colours per booking status, following the Floodlit design:
 * confirmed/played → brand, awaiting → amber, no-show/cancelled → danger.
 */
function statusStyle(b: CustomerBooking): { bg: string; color: string } {
  switch (b.status) {
    case BookingStatus.CONFIRMED:
    case BookingStatus.COMPLETED:
      return { bg: 'var(--brand)', color: 'var(--on-brand)' };
    case BookingStatus.NO_SHOW:
    case BookingStatus.CANCELLED:
      return {
        bg: 'color-mix(in oklab, var(--danger) 16%, var(--surface))',
        color: 'var(--danger)',
      };
    default:
      return { bg: 'var(--surface-2)', color: 'var(--chalk)' };
  }
}

/** Awaiting-payment bookings get the warm amber accent on their pill. */
function isAwaitingPayment(b: CustomerBooking): boolean {
  return (
    b.paymentStatus === PaymentStatus.PENDING ||
    b.paymentStatus === PaymentStatus.AWAITING_VENUE_SETTLEMENT
  );
}

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
 * A booking is "upcoming" if it's confirmed and its first slot is in the future;
 * everything else (completed, no-show, cancelled, or past confirmed) is "past".
 */
function isUpcoming(b: CustomerBooking): boolean {
  if (b.status !== BookingStatus.CONFIRMED) return false;
  if (b.slots.length === 0) return true;
  return new Date(b.slots[0].start).getTime() > Date.now();
}

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
  const { flash } = useFloodlitToast();

  // Which booking has its inline cancel-policy panel expanded.
  const [policyOpen, setPolicyOpen] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

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

  const openHost = (b: CustomerBooking) => {
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
      flash(`Match opened — ${spotsLabel} now visible to nearby players.`);
      setHostedIds((prev) => new Set(prev).add(hostTarget.id));
      setHostTarget(null);
      reload();
    } catch (e) {
      setHostError((e as Error).message);
    } finally {
      setHosting(false);
    }
  };

  const confirmCancel = async (b: CustomerBooking) => {
    setCancellingId(b.id);
    setCancelError(null);
    try {
      await api.cancelBooking(b.id);
      const message =
        b.payMode === PayMode.PREPAY &&
        b.paymentStatus === PaymentStatus.PAID
          ? 'Booking cancelled. Any eligible refund will be credited per the venue’s cancellation policy.'
          : 'Booking cancelled.';
      flash(message);
      setPolicyOpen(null);
      reload();
    } catch (e) {
      setCancelError((e as Error).message);
    } finally {
      setCancellingId(null);
    }
  };

  const bookings = data ?? [];
  const upcoming = bookings.filter(isUpcoming);
  const past = bookings.filter((b) => !isUpcoming(b));

  return (
    <div className="space-y-1" style={{ padding: '4px 2px 24px' }}>
      <h1 className="fl-display" style={{ fontSize: 30, lineHeight: 1.05 }}>
        My bookings
      </h1>
      <p className="text-sm" style={{ color: 'var(--muted)', marginTop: 2 }}>
        Your upcoming and past court bookings
      </p>

      <Msg text={error} />

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mt-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              style={{
                height: 120,
                borderRadius: 14,
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                opacity: 0.6,
              }}
            />
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <div
          className="text-center mt-5 mx-auto"
          style={{
            maxWidth: 460,
            padding: '34px 22px',
            background: 'var(--surface)',
            border: '1px dashed var(--line-strong)',
            borderRadius: 16,
          }}
        >
          <div style={{ fontSize: 30 }}>📋</div>
          <div
            className="fl-display"
            style={{ fontSize: 18, marginTop: 10 }}
          >
            No bookings yet
          </div>
          <div
            className="text-sm"
            style={{ color: 'var(--muted)', marginTop: 6, lineHeight: 1.45 }}
          >
            Once you book a court it will show up here with its date, status and
            payment.
          </div>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <Section
              title="Upcoming"
              bookings={upcoming}
              dim={false}
              policyOpen={policyOpen}
              setPolicyOpen={setPolicyOpen}
              cancellingId={cancellingId}
              cancelError={cancelError}
              setCancelError={setCancelError}
              confirmCancel={confirmCancel}
              openHost={openHost}
              hostedIds={hostedIds}
            />
          )}
          {past.length > 0 && (
            <Section
              title="Past"
              bookings={past}
              dim
              policyOpen={policyOpen}
              setPolicyOpen={setPolicyOpen}
              cancellingId={cancellingId}
              cancelError={cancelError}
              setCancelError={setCancelError}
              confirmCancel={confirmCancel}
              openHost={openHost}
              hostedIds={hostedIds}
            />
          )}
        </>
      )}

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
                <button
                  type="button"
                  aria-label="Remove a spot"
                  disabled={hosting || openSpots <= MIN_SPOTS}
                  onClick={() =>
                    setOpenSpots((n) => Math.max(MIN_SPOTS, n - 1))
                  }
                  className="grid h-10 w-10 place-items-center rounded-xl disabled:opacity-40"
                  style={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--line-strong)',
                    color: 'var(--chalk)',
                  }}
                >
                  <Minus className="h-4 w-4" />
                </button>
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
                  className="fl-mono h-10 w-20 rounded-xl px-3 text-center text-sm font-semibold outline-none"
                  style={{
                    background: 'var(--bg)',
                    border: '1px solid var(--line-strong)',
                    color: 'var(--chalk)',
                  }}
                />
                <button
                  type="button"
                  aria-label="Add a spot"
                  disabled={hosting || openSpots >= MAX_SPOTS}
                  onClick={() =>
                    setOpenSpots((n) => Math.min(MAX_SPOTS, n + 1))
                  }
                  className="grid h-10 w-10 place-items-center rounded-xl disabled:opacity-40"
                  style={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--line-strong)',
                    color: 'var(--chalk)',
                  }}
                >
                  <Plus className="h-4 w-4" />
                </button>
                <span className="text-sm" style={{ color: 'var(--muted)' }}>
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
            <button
              onClick={closeHost}
              disabled={hosting}
              className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
              style={{
                background: 'transparent',
                border: '1px solid var(--line-strong)',
                color: 'var(--muted)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={confirmHost}
              disabled={hosting}
              className="rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
              style={{ background: 'var(--brand)', color: 'var(--on-brand)' }}
            >
              {hosting ? 'Opening match…' : 'Open match'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface SectionProps {
  title: string;
  bookings: CustomerBooking[];
  dim: boolean;
  policyOpen: string | null;
  setPolicyOpen: (id: string | null) => void;
  cancellingId: string | null;
  cancelError: string | null;
  setCancelError: (s: string | null) => void;
  confirmCancel: (b: CustomerBooking) => void;
  openHost: (b: CustomerBooking) => void;
  hostedIds: Set<string>;
}

function Section({
  title,
  bookings,
  dim,
  policyOpen,
  setPolicyOpen,
  cancellingId,
  cancelError,
  setCancelError,
  confirmCancel,
  openHost,
  hostedIds,
}: SectionProps) {
  return (
    <div>
      <div
        className="fl-mono"
        style={{
          fontSize: 11,
          letterSpacing: '.1em',
          color: 'var(--faint)',
          margin: '24px 0 10px',
        }}
      >
        {title}
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {bookings.map((b) => {
          const when = whenLabel(b);
          const pill = isAwaitingPayment(b)
            ? { bg: 'var(--amber)', color: 'var(--on-amber)' }
            : statusStyle(b);
          const expanded = policyOpen === b.id;
          const busy = cancellingId === b.id;
          return (
            <div
              key={b.id}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 14,
                padding: 15,
                opacity: dim ? 0.85 : 1,
              }}
            >
              <div className="flex items-start justify-between gap-2.5">
                <div>
                  <div className="fl-display" style={{ fontSize: 17 }}>
                    {b.venueName}
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: 'var(--muted)', marginTop: 3 }}
                  >
                    {courtLabel(b)} · {when.date} · {when.time}
                  </div>
                </div>
                <span
                  className="whitespace-nowrap"
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '5px 9px',
                    borderRadius: 7,
                    background: pill.bg,
                    color: pill.color,
                  }}
                >
                  {isAwaitingPayment(b)
                    ? PAYMENT_LABEL[b.paymentStatus]
                    : STATUS_LABEL[b.status] ?? b.status}
                </span>
              </div>

              <div
                className="flex items-center justify-between"
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: '1px solid var(--line)',
                }}
              >
                <span className="fl-mono" style={{ fontSize: 13 }}>
                  {flMoney(b.total)} · {PAY_MODE_LABEL[b.payMode] ?? b.payMode}
                </span>
                <div className="flex gap-2">
                  {isHostable(b) &&
                    (hostedIds.has(b.id) ? (
                      <span
                        className="inline-flex items-center gap-1"
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          padding: '7px 11px',
                          borderRadius: 8,
                          color: 'var(--muted)',
                        }}
                      >
                        <Check className="h-3.5 w-3.5" />
                        Match open
                      </span>
                    ) : (
                      <button
                        onClick={() => openHost(b)}
                        className="inline-flex items-center gap-1"
                        style={{
                          cursor: 'pointer',
                          background: 'transparent',
                          border: '1px solid var(--line-strong)',
                          color: 'var(--muted)',
                          fontSize: 12,
                          fontWeight: 600,
                          padding: '7px 11px',
                          borderRadius: 8,
                        }}
                      >
                        <Users className="h-3.5 w-3.5" />
                        Host
                      </button>
                    ))}
                  {isCancellable(b) && (
                    <button
                      onClick={() => {
                        setCancelError(null);
                        setPolicyOpen(expanded ? null : b.id);
                      }}
                      style={{
                        cursor: 'pointer',
                        background: 'transparent',
                        border: '1px solid var(--line-strong)',
                        color: 'var(--muted)',
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '7px 13px',
                        borderRadius: 8,
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>

              {expanded && isCancellable(b) && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '11px 13px',
                    borderRadius: 10,
                    background: 'var(--bg)',
                    border: '1px solid var(--line)',
                    fontSize: 12,
                    color: 'var(--muted)',
                    lineHeight: 1.45,
                  }}
                >
                  {refundOutcome(b)}
                  {cancelError ? (
                    <div style={{ marginTop: 8 }}>
                      <Msg text={cancelError} />
                    </div>
                  ) : null}
                  <div className="flex gap-2" style={{ marginTop: 10 }}>
                    <button
                      onClick={() => confirmCancel(b)}
                      disabled={busy}
                      style={{
                        cursor: 'pointer',
                        flex: 1,
                        background: 'var(--danger)',
                        color: '#fff',
                        border: 'none',
                        fontWeight: 600,
                        fontSize: 12,
                        padding: 9,
                        borderRadius: 8,
                        opacity: busy ? 0.6 : 1,
                      }}
                    >
                      {busy ? 'Cancelling…' : 'Confirm cancel'}
                    </button>
                    <button
                      onClick={() => setPolicyOpen(null)}
                      disabled={busy}
                      style={{
                        cursor: 'pointer',
                        flex: 1,
                        background: 'transparent',
                        color: 'var(--muted)',
                        border: '1px solid var(--line-strong)',
                        fontSize: 12,
                        padding: 9,
                        borderRadius: 8,
                      }}
                    >
                      Keep it
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
