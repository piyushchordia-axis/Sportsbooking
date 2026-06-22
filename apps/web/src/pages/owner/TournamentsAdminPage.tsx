import {
  FeeBasis,
  RegistrationType,
  TournamentFormat,
} from '@sportsbooking/shared';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  IndianRupee,
  Loader2,
  Plus,
  Trophy,
  Users,
} from 'lucide-react';
import { api } from '../../api/client';
import {
  Card,
  EmptyState,
  Msg,
  PageHeader,
  SectionLabel,
  Select,
  Stat,
  StatusPill,
  useLoad,
} from '../../components/common';
import { Button } from '../../components/ui/button';
import { Switch } from '../../components/ui/switch';
import {
  DateRangePicker,
  type DateRangeValue,
} from '../../components/ui/date-range-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';

/** A registered participant as surfaced on a tournament (additive API shape). */
interface Participant {
  id: string;
  teamName?: string | null;
  captainName: string;
  captainMobile: string;
  paid: boolean;
}

/** A tournament row from GET /tournaments/manage/venue/:venueId. */
interface TournamentRow {
  id: string;
  name: string;
  capacity: number;
  regType?: RegistrationType;
  regCloseAt?: string | null;
  refundAllowedAfterClose?: boolean;
  participants?: Participant[];
  _count?: { participants: number };
}

/** Human-readable labels for the registration enums (sentence case). */
const FORMAT_LABEL: Record<TournamentFormat, string> = {
  [TournamentFormat.KNOCKOUT]: 'Knockout',
  [TournamentFormat.LEAGUE]: 'League',
  [TournamentFormat.ROUND_ROBIN]: 'Round robin',
};
const REG_TYPE_LABEL: Record<RegistrationType, string> = {
  [RegistrationType.SOLO]: 'Solo players',
  [RegistrationType.TEAM]: 'Teams',
};
const FEE_BASIS_LABEL: Record<FeeBasis, string> = {
  [FeeBasis.PER_PLAYER]: 'Per player',
  [FeeBasis.PER_TEAM]: 'Per team',
};

/** True once the registration window has closed (per stored regCloseAt). */
function regClosed(t: TournamentRow): boolean {
  return !!t.regCloseAt && new Date(t.regCloseAt) < new Date();
}

/** Local YYYY-MM-DD (avoids the UTC shift that toISOString() introduces). */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Small labelled number input — replaces free-text fields for counts/amounts. */
function NumberField({
  label,
  value,
  onChange,
  min,
  step = 1,
  prefix,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  step?: number;
  prefix?: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</span>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute inset-y-0 left-0 grid w-9 place-items-center text-muted-foreground">
            {prefix}
          </span>
        )}
        <input
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          step={step}
          onChange={(e) => onChange(e.target.value)}
          className={`flex h-10 w-full min-w-0 rounded-xl border border-border bg-input-background py-1 text-sm text-foreground transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 ${prefix ? 'pl-9 pr-3.5' : 'px-3.5'}`}
        />
      </div>
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Owner: create tournaments + manage participants (PRD §4.7). */
export function TournamentsAdminPage() {
  const venues = useLoad(() => api.listVenues());
  const [venueId, setVenueId] = useState('');

  // Create-tournament modal (form state lives inside the dialog).
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!venueId && venues.data?.[0]) setVenueId(venues.data[0].id);
  }, [venues.data, venueId]);

  const tournaments = useLoad<TournamentRow[]>(
    () => (venueId ? api.listOwnerTournaments(venueId) : Promise.resolve([])),
    [venueId],
  );

  // Roll-up stats for the overview strip.
  const stats = useMemo(() => {
    const rows = tournaments.data ?? [];
    let entries = 0;
    let capacityTotal = 0;
    let openCount = 0;
    for (const t of rows) {
      const count = (t.participants ?? []).length || t._count?.participants || 0;
      entries += count;
      capacityTotal += t.capacity;
      if (!regClosed(t)) openCount += 1;
    }
    const fill = capacityTotal ? Math.round((entries / capacityTotal) * 100) : 0;
    return { total: rows.length, openCount, entries, capacityTotal, fill };
  }, [tournaments.data]);

  // Participant pending cancellation (drives the confirm dialog).
  const [pending, setPending] = useState<{ t: TournamentRow; p: Participant } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelMsg, setCancelMsg] = useState<string | null>(null);

  const confirmCancel = async () => {
    if (!pending) return;
    setCancelling(true);
    setCancelMsg(null);
    try {
      const res = await api.cancelTournamentRegistration(pending.t.id, pending.p.id);
      setCancelMsg(
        res.refunded
          ? 'Registration cancelled and entry fee refunded.'
          : 'Registration cancelled. No refund was issued per policy.',
      );
      setPending(null);
      tournaments.reload();
    } catch (e) {
      setCancelMsg((e as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="container">
      <PageHeader
        title="Tournaments"
        subtitle="Set up events, take registrations, and manage entries"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New tournament
          </Button>
        }
      />

      {/* Overview strip — live roll-up across the selected venue. */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Tournaments" value={stats.total} icon={Trophy} accent="primary" />
        <Stat
          label="Open for entry"
          value={stats.openCount}
          sub={stats.total ? `${stats.total - stats.openCount} closed` : undefined}
          icon={CalendarDays}
          accent="blue"
        />
        <Stat label="Entries" value={stats.entries} icon={Users} accent="accent" />
        <Stat
          label="Capacity filled"
          value={`${stats.fill}%`}
          sub={stats.capacityTotal ? `${stats.entries} of ${stats.capacityTotal} slots` : undefined}
          icon={CheckCircle2}
          accent="emerald"
        />
      </div>

      <Card title="Participants" subtitle="View entries, cancel and refund registrations" topAccent="accent">
        <div className="mb-4">
          <SectionLabel icon={Users}>Manage entries</SectionLabel>
        </div>

        {cancelMsg && (
          <div className="mb-4">
            <Msg text={cancelMsg} />
          </div>
        )}

        {tournaments.loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading tournaments…
          </div>
        ) : tournaments.error ? (
          <Msg text={tournaments.error} />
        ) : !(tournaments.data ?? []).length ? (
          <EmptyState
            title="No tournaments yet"
            hint="Use “New tournament” to set up an event and start taking registrations."
          />
        ) : (
          <div className="space-y-5">
            {(tournaments.data ?? []).map((t) => {
              const participants = t.participants ?? [];
              const count = participants.length || t._count?.participants || 0;
              const closed = regClosed(t);
              const fill = t.capacity ? Math.min(100, Math.round((count / t.capacity) * 100)) : 0;
              return (
                <div
                  key={t.id}
                  className="rounded-2xl border border-border bg-elevated/40 overflow-hidden"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
                        <Trophy className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="font-display font-semibold text-sm truncate leading-tight">
                          {t.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t.regCloseAt
                            ? `Registration ${closed ? 'closed' : 'closes'} ${new Date(
                                t.regCloseAt,
                              ).toLocaleDateString()}`
                            : 'Open until the event starts'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="hidden sm:flex flex-col items-end">
                        <span className="text-xs font-medium text-foreground">
                          {count}/{t.capacity} entries
                        </span>
                        <span
                          className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-border"
                          aria-hidden
                        >
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{ width: `${fill}%` }}
                          />
                        </span>
                      </div>
                      <StatusPill status={closed ? 'closed' : 'open'}>
                        {closed ? 'Registration closed' : 'Open'}
                      </StatusPill>
                    </div>
                  </div>

                  {!participants.length ? (
                    <p className="px-4 py-6 text-sm text-muted-foreground">
                      No registrations yet for this tournament.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t.regType === RegistrationType.TEAM ? 'Team' : 'Player'}</TableHead>
                          <TableHead>Captain</TableHead>
                          <TableHead className="hidden sm:table-cell">Contact</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {participants.map((p) => {
                          const cancelled = !p.paid;
                          return (
                            <TableRow key={p.id}>
                              <TableCell className="font-medium">
                                {p.teamName || p.captainName}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {p.captainName}
                              </TableCell>
                              <TableCell className="hidden sm:table-cell text-muted-foreground">
                                {p.captainMobile}
                              </TableCell>
                              <TableCell>
                                <StatusPill status={cancelled ? 'cancelled' : 'paid'}>
                                  {cancelled ? 'Cancelled' : 'Paid'}
                                </StatusPill>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  disabled={cancelled}
                                  onClick={() => {
                                    setCancelMsg(null);
                                    setPending({ t, p });
                                  }}
                                >
                                  Cancel &amp; refund
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Dialog open={!!pending} onOpenChange={(o) => !o && !cancelling && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Cancel registration?
            </DialogTitle>
            <DialogDescription>
              {pending && (
                <>
                  This cancels{' '}
                  <span className="font-medium text-foreground">
                    {pending.p.teamName || pending.p.captainName}
                  </span>{' '}
                  from{' '}
                  <span className="font-medium text-foreground">{pending.t.name}</span>.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/50 px-3.5 py-2.5 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>
              {pending && regClosed(pending.t) && !pending.t.refundAllowedAfterClose ? (
                <>
                  Registration has closed for this tournament, so the entry fee will{' '}
                  <span className="font-medium text-foreground">not be refunded</span>.
                  The participant will still be removed.
                </>
              ) : (
                <>
                  The entry fee will be refunded to the participant where applicable. Refunds may
                  be closed once registration has closed.
                </>
              )}
            </span>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPending(null)}
              disabled={cancelling}
            >
              Keep registration
            </Button>
            <Button variant="destructive" onClick={confirmCancel} disabled={cancelling}>
              {cancelling && <Loader2 className="h-4 w-4 animate-spin" />}
              Cancel &amp; refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateTournamentDialog
        open={createOpen}
        venues={venues.data ?? []}
        defaultVenueId={venueId}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          tournaments.reload();
        }}
      />
    </div>
  );
}

/* ── Create tournament dialog ───────────────────────────────────────────── */

/** The create-tournament form, hosted in a modal opened from the page header. */
function CreateTournamentDialog({
  open,
  venues,
  defaultVenueId,
  onClose,
  onCreated,
}: {
  open: boolean;
  venues: any[];
  defaultVenueId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [venueId, setVenueId] = useState('');
  const [name, setName] = useState('');
  const [format, setFormat] = useState<TournamentFormat>(TournamentFormat.KNOCKOUT);
  const [regType, setRegType] = useState<RegistrationType>(RegistrationType.TEAM);
  const [feeBasis, setFeeBasis] = useState<FeeBasis>(FeeBasis.PER_TEAM);
  const [fee, setFee] = useState('1500');
  const [capacity, setCapacity] = useState('16');
  const [dates, setDates] = useState<DateRangeValue>({});
  const [regCloses, setRegCloses] = useState(false);
  const [regCloseDate, setRegCloseDate] = useState<DateRangeValue>({});
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Reset to a fresh draft each time the modal opens.
  useEffect(() => {
    if (open) {
      setVenueId(defaultVenueId || venues[0]?.id || '');
      setName('');
      setFormat(TournamentFormat.KNOCKOUT);
      setRegType(RegistrationType.TEAM);
      setFeeBasis(FeeBasis.PER_TEAM);
      setFee('1500');
      setCapacity('16');
      setDates({});
      setRegCloses(false);
      setRegCloseDate({});
      setMsg(null);
    }
  }, [open, defaultVenueId, venues]);

  const venue = venues.find((v: any) => v.id === venueId);

  const dateError =
    dates.from && dates.to && dates.to < dates.from
      ? 'End date cannot fall before the start date.'
      : null;
  const canCreate =
    !!venueId && !!name.trim() && !!dates.from && !!dates.to && !dateError && !submitting;

  const create = async () => {
    setMsg(null);
    if (!dates.from || !dates.to) {
      setMsg('Pick the tournament start and end dates.');
      return;
    }
    setSubmitting(true);
    try {
      await api.createTournament({
        venueId,
        name: name.trim(),
        gameId: venue?.games?.[0]?.gameId,
        format,
        regType,
        feeBasis,
        fee: Number(fee),
        capacity: Number(capacity),
        startDate: toISODate(dates.from),
        endDate: toISODate(dates.to),
        ...(regCloses && regCloseDate.from
          ? { regCloseAt: toISODate(regCloseDate.from) }
          : {}),
      });
      onCreated();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create tournament</DialogTitle>
          <DialogDescription>
            Set up a new event at one of your venues and open it for registrations.
          </DialogDescription>
        </DialogHeader>

        {/* Section 1: event details */}
        <SectionLabel icon={Trophy} className="mb-3">
          Event details
        </SectionLabel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="[&_label]:!mb-0">
            <Select
              label="Venue"
              value={venueId}
              onChange={setVenueId}
              options={venues.map((v: any) => ({ value: v.id, label: v.name }))}
            />
          </div>
          <label className="block">
            <span className="block text-xs font-medium text-muted-foreground mb-1.5">Name</span>
            <input
              value={name}
              placeholder="e.g. Summer Smash"
              onChange={(e) => setName(e.target.value)}
              className="flex h-10 w-full min-w-0 rounded-xl border border-border bg-input-background px-3.5 py-1 text-sm text-foreground transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
            />
          </label>
        </div>

        {/* Section 2: schedule — real range picker, never two date fields */}
        <div className="mt-5 rounded-2xl border border-border bg-elevated/60 p-4">
          <SectionLabel icon={CalendarDays} className="mb-3">
            Schedule
          </SectionLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="block text-xs font-medium text-muted-foreground mb-1.5">
                Tournament dates
              </span>
              <DateRangePicker
                value={dates}
                onChange={setDates}
                placeholder="Pick start and end dates"
              />
              {dateError ? (
                <span className="mt-1 block text-xs text-destructive">{dateError}</span>
              ) : (
                <span className="mt-1 block text-xs text-muted-foreground">
                  Choose the first and last day of play.
                </span>
              )}
            </label>

            <div>
              <div className="flex items-center justify-between gap-3">
                <span className="block text-xs font-medium text-muted-foreground">
                  Close registration early
                </span>
                <Switch
                  checked={regCloses}
                  onCheckedChange={setRegCloses}
                  aria-label="Close registration before the tournament starts"
                />
              </div>
              {regCloses ? (
                <div className="mt-1.5">
                  <DateRangePicker
                    value={regCloseDate}
                    onChange={(v) => setRegCloseDate({ from: v.from })}
                    numberOfMonths={1}
                    placeholder="Pick a cut-off date"
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    No new entries after this date.
                  </span>
                </div>
              ) : (
                <span className="mt-1.5 block text-xs text-muted-foreground">
                  Entries stay open until the tournament begins.
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Section 3: format & pricing — Selects for enums, steppers for counts */}
        <div className="mt-5">
          <SectionLabel icon={IndianRupee} className="mb-3">
            Format & pricing
          </SectionLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="[&_label]:!mb-0">
              <Select
                label="Format"
                value={format}
                onChange={(x) => setFormat(x as TournamentFormat)}
                options={Object.values(TournamentFormat).map((f) => ({
                  value: f,
                  label: FORMAT_LABEL[f],
                }))}
              />
            </div>
            <div className="[&_label]:!mb-0">
              <Select
                label="Registration"
                value={regType}
                onChange={(x) => setRegType(x as RegistrationType)}
                options={Object.values(RegistrationType).map((r) => ({
                  value: r,
                  label: REG_TYPE_LABEL[r],
                }))}
              />
            </div>
            <div className="[&_label]:!mb-0">
              <Select
                label="Fee basis"
                value={feeBasis}
                onChange={(x) => setFeeBasis(x as FeeBasis)}
                options={Object.values(FeeBasis).map((f) => ({
                  value: f,
                  label: FEE_BASIS_LABEL[f],
                }))}
              />
            </div>
            <NumberField
              label="Entry fee"
              value={fee}
              onChange={setFee}
              min={0}
              step={50}
              prefix={<IndianRupee className="h-4 w-4" />}
              hint={feeBasis === FeeBasis.PER_TEAM ? 'Charged per team' : 'Charged per player'}
            />
            <NumberField
              label="Capacity"
              value={capacity}
              onChange={setCapacity}
              min={2}
              hint={regType === RegistrationType.TEAM ? 'Maximum teams' : 'Maximum players'}
            />
          </div>
        </div>

        <Msg text={msg} />

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!canCreate}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create tournament
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
