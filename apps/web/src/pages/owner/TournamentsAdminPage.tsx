import {
  FeeBasis,
  RegistrationType,
  TournamentFormat,
} from '@sportsbooking/shared';
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  IndianRupee,
  Loader2,
  MoreVertical,
  Plus,
  Search,
  Swords,
  Trophy,
  Users,
} from 'lucide-react';
import {
  api,
  type FixtureBoard,
  type FixtureMatch,
  type OwnerTournamentDetail,
  type OwnerTournamentListItem,
  type OwnerTournamentStatus,
  type TournamentParticipant,
} from '../../api/client';
import {
  Card,
  EmptyState,
  Msg,
  PageHeader,
  SectionLabel,
  Select,
  Stat,
  StatusPill,
  Tabs,
  useLoad,
} from '../../components/common';
import { Button } from '../../components/ui/button';
import { SearchableSelect } from '../../components/ui/combobox';
import { DatePicker } from '../../components/ui/date-picker';
import { Skeleton } from '../../components/ui/skeleton';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
} from '../../components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';

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
function regClosed(t: { regCloseAt?: string | null }): boolean {
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

/** Pill label + a hidden tone token (-> common.tsx StatusPill toneFor). */
const STATUS_META: Record<OwnerTournamentStatus, { label: string; pill: string }> = {
  open: { label: 'Open', pill: 'active' }, // green
  closing_soon: { label: 'Closing soon', pill: 'await' }, // amber
  in_progress: { label: 'In progress', pill: 'new' }, // blue
  completed: { label: 'Completed', pill: 'off' }, // muted
};

/** Lifecycle tabs, in attention order; ids map to the status filter. */
const STATUS_TABS: { id: 'all' | OwnerTournamentStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'closing_soon', label: 'Closing soon' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
];

const PAGE_SIZE = 12;

/** Short, friendly date (e.g. "16 Jul 2026"). */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Whole-day count from now to a date (negative = past). */
function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

/** The "when it matters" line for a row/header, by lifecycle bucket. */
function scheduleLine(t: {
  status: OwnerTournamentStatus;
  regCloseAt: string | null;
  startDate: string;
  endDate: string;
}): string {
  switch (t.status) {
    case 'open':
    case 'closing_soon': {
      if (!t.regCloseAt) return 'Open until kickoff';
      const d = daysUntil(t.regCloseAt);
      if (d <= 0) return 'Closes today';
      if (d === 1) return 'Closes tomorrow';
      if (d <= 7) return `Closes in ${d} days`;
      return `Closes ${fmtDate(t.regCloseAt)}`;
    }
    case 'in_progress':
      return `Underway · started ${fmtDate(t.startDate)}`;
    case 'completed':
      return `Ended ${fmtDate(t.endDate)}`;
  }
}

/** A slim entries/capacity meter (the list's signature read on each event). */
function EntriesMeter({ entries, capacity }: { entries: number; capacity: number }) {
  const pct = capacity ? Math.min(100, Math.round((entries / capacity) * 100)) : 0;
  return (
    <div className="min-w-[7.5rem]">
      <div className="mb-1 text-xs tabular-nums">
        <span className="font-medium text-foreground">{entries}</span>
        <span className="text-muted-foreground">/{capacity} entries</span>
      </div>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Owner: tournaments master list (PRD §4.7). A scalable, paginated, filterable
 * roster grouped by lifecycle — each row opens a slide-over drawer to manage
 * its participants and fixtures. Creating a tournament stays here.
 */
export function TournamentsAdminPage() {
  const venues = useLoad(() => api.listVenues());

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [venueId, setVenueId] = useState(''); // '' = all venues
  const [statusTab, setStatusTab] = useState<'all' | OwnerTournamentStatus>('all');
  const [page, setPage] = useState(1);

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fixturesFor, setFixturesFor] = useState<{
    id: string;
    name: string;
    format?: string;
  } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Debounce free-text search so we don't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Any filter change returns to the first page.
  useEffect(() => {
    setPage(1);
  }, [debounced, venueId, statusTab]);

  const result = useLoad(
    () =>
      api.listOwnerTournamentsPage({
        q: debounced || undefined,
        venueId: venueId || undefined,
        status: statusTab === 'all' ? undefined : statusTab,
        page,
        pageSize: PAGE_SIZE,
      }),
    [debounced, venueId, statusTab, page],
  );

  const items = result.data?.items ?? [];
  const counts = result.data?.counts;
  const summary = result.data?.summary;
  const total = result.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = !!(debounced || venueId || statusTab !== 'all');

  const venueOpts = useMemo(
    () => [
      { value: '', label: 'All venues' },
      ...(venues.data ?? []).map((v: any) => ({ value: v.id, label: v.name })),
    ],
    [venues.data],
  );

  const openCount = (counts?.open ?? 0) + (counts?.closing_soon ?? 0);
  const fill =
    summary && summary.capacity
      ? Math.round((summary.entries / summary.capacity) * 100)
      : 0;

  // Lifecycle tabs with live counts baked into the label.
  const tabDefs = STATUS_TABS.map((t) => ({
    id: t.id,
    label: (
      <span className="inline-flex items-center gap-1.5">
        {t.label}
        {counts && (
          <span className="tabular-nums text-xs opacity-60">
            {t.id === 'all' ? counts.all : counts[t.id]}
          </span>
        )}
      </span>
    ),
  }));

  const clearFilters = () => {
    setSearch('');
    setVenueId('');
    setStatusTab('all');
  };

  return (
    <div className="container">
      <PageHeader
        title="Tournaments"
        subtitle="Set up events, take registrations, and manage entries"
        action={
          <Button onClick={() => setCreateOpen(true)} disabled={!(venues.data ?? []).length}>
            <Plus className="h-4 w-4" /> New tournament
          </Button>
        }
      />

      {/* Overview strip — live roll-up across the current search/venue scope. */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Tournaments" value={counts?.all ?? 0} icon={Trophy} accent="primary" />
        <Stat
          label="Open for entry"
          value={openCount}
          sub={counts ? `${counts.completed} completed` : undefined}
          icon={CalendarDays}
          accent="blue"
        />
        <Stat
          label="Entries"
          value={summary?.entries ?? 0}
          sub={summary ? `${summary.paidEntries} paid` : undefined}
          icon={Users}
          accent="accent"
        />
        <Stat
          label="Capacity filled"
          value={`${fill}%`}
          sub={
            summary?.capacity
              ? `${summary.entries} of ${summary.capacity} slots`
              : undefined
          }
          icon={CheckCircle2}
          accent="emerald"
        />
      </div>

      {flash && <Msg text={flash} />}

      {/* Toolbar: lifecycle tabs + search + venue filter */}
      <Card className="mb-4">
        <div className="-mx-1 mb-4 overflow-x-auto px-1 pb-1">
          <Tabs
            tabs={tabDefs}
            active={statusTab}
            onChange={setStatusTab}
            className="flex-nowrap"
          />
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <label className="block flex-1 min-w-0">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Search
            </span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tournaments by name"
                className="h-10 w-full rounded-xl border border-border bg-input-background pl-9 pr-3.5 text-sm text-foreground outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
              />
            </div>
          </label>
          <div className="lg:w-72">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Venue
            </span>
            <SearchableSelect
              value={venueId}
              onChange={setVenueId}
              options={venueOpts}
              placeholder="All venues"
              searchPlaceholder="Find a venue"
            />
          </div>
        </div>
      </Card>

      {/* Results */}
      {result.loading && items.length === 0 ? (
        <Card>
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </Card>
      ) : result.error ? (
        <Card>
          <EmptyState title="Couldn't load tournaments" hint={result.error} />
          <div className="flex justify-center pb-4">
            <Button variant="outline" onClick={result.reload}>
              Try again
            </Button>
          </div>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          {hasFilters ? (
            <>
              <EmptyState
                title="No tournaments match these filters"
                hint="Try a different search, switch tabs, or clear the filters to see everything."
              />
              <div className="flex justify-center pb-4">
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              </div>
            </>
          ) : (
            <EmptyState
              title="No tournaments yet"
              hint="Use “New tournament” to set up an event and start taking registrations."
            />
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Tournament</TableHead>
                  <TableHead className="hidden md:table-cell">Registration</TableHead>
                  <TableHead>Entries</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10 pr-5" aria-label="Open" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((t) => (
                  <TournamentListRow
                    key={t.id}
                    t={t}
                    onOpen={() => setSelectedId(t.id)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination footer */}
          <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-5 py-3.5 sm:flex-row">
            <p className="text-xs text-muted-foreground">
              Page <span className="font-medium text-foreground">{page}</span> of{' '}
              <span className="font-medium text-foreground">{pageCount}</span>
              <span className="mx-1.5 opacity-40">·</span>
              {total} {total === 1 ? 'tournament' : 'tournaments'}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || result.loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount || result.loading}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      )}

      {selectedId && (
        <TournamentDrawer
          tournamentId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={result.reload}
          onOpenFixtures={setFixturesFor}
        />
      )}

      <CreateTournamentDialog
        open={createOpen}
        venues={venues.data ?? []}
        defaultVenueId={venueId || (venues.data ?? [])[0]?.id || ''}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          setFlash('Tournament created.');
          result.reload();
        }}
      />

      {fixturesFor && (
        <FixturesDialog
          tournament={fixturesFor}
          onClose={() => setFixturesFor(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One tournament row — whole row opens the detail drawer              */
/* ------------------------------------------------------------------ */

function TournamentListRow({
  t,
  onOpen,
}: {
  t: OwnerTournamentListItem;
  onOpen: () => void;
}) {
  const meta = STATUS_META[t.status];
  const sub = [t.venueName, FORMAT_LABEL[t.format]].filter(Boolean).join(' · ');
  return (
    <TableRow
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group cursor-pointer outline-none transition-colors hover:bg-primary/[0.04] focus-visible:bg-primary/[0.06]"
    >
      <TableCell className="pl-5">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
            <Trophy className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <span className="block truncate font-medium text-foreground">{t.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{sub}</span>
          </div>
        </div>
      </TableCell>
      <TableCell
        className={
          'hidden md:table-cell text-sm ' +
          (t.status === 'closing_soon' ? 'font-medium text-amber-500' : 'text-muted-foreground')
        }
      >
        {scheduleLine(t)}
      </TableCell>
      <TableCell>
        <EntriesMeter entries={t.entries} capacity={t.capacity} />
      </TableCell>
      <TableCell>
        <StatusPill status={meta.pill}>{meta.label}</StatusPill>
      </TableCell>
      <TableCell className="pr-5 text-right">
        <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
      </TableCell>
    </TableRow>
  );
}

/* ------------------------------------------------------------------ */
/* Detail drawer — participants + cancel/refund, fetched on demand     */
/* ------------------------------------------------------------------ */

function TournamentDrawer({
  tournamentId,
  onClose,
  onChanged,
  onOpenFixtures,
}: {
  tournamentId: string;
  onClose: () => void;
  onChanged: () => void;
  onOpenFixtures: (t: { id: string; name: string; format?: string }) => void;
}) {
  const detail = useLoad<OwnerTournamentDetail>(
    () => api.getOwnerTournament(tournamentId),
    [tournamentId],
  );
  const [pending, setPending] = useState<TournamentParticipant | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const t = detail.data;

  const confirmCancel = async () => {
    if (!pending || !t) return;
    setCancelling(true);
    setMsg(null);
    try {
      const res = await api.cancelTournamentRegistration(t.id, pending.id);
      setMsg(
        res.refunded
          ? 'Registration cancelled and entry fee refunded.'
          : 'Registration cancelled. No refund was issued per policy.',
      );
      setPending(null);
      detail.reload();
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  const closed = t ? regClosed(t) : false;

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && !cancelling && onClose()}>
        <SheetContent>
          {detail.loading && !t ? (
            <SheetBody>
              <Skeleton className="mb-3 h-7 w-2/3" />
              <Skeleton className="mb-6 h-4 w-1/2" />
              <Skeleton className="h-40 w-full" />
            </SheetBody>
          ) : detail.error ? (
            <SheetBody>
              <Msg text={detail.error} />
            </SheetBody>
          ) : t ? (
            <>
              <SheetHeader>
                <div className="flex items-start gap-3 pr-8">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
                    <Trophy className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-display text-lg font-semibold leading-tight">
                      {t.name}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {[t.venueName, FORMAT_LABEL[t.format]].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <StatusPill status={STATUS_META[t.status].pill}>
                    {STATUS_META[t.status].label}
                  </StatusPill>
                  <span className="text-xs text-muted-foreground">{scheduleLine(t)}</span>
                  <div className="ml-auto">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onOpenFixtures({ id: t.id, name: t.name, format: t.format })
                      }
                    >
                      <Swords className="h-4 w-4" /> Fixtures
                    </Button>
                  </div>
                </div>

                <div className="mt-3">
                  <EntriesMeter entries={t.entries} capacity={t.capacity} />
                </div>
              </SheetHeader>

              <SheetBody>
                <div className="mb-3">
                  <SectionLabel icon={Users}>Participants</SectionLabel>
                </div>

                {msg && (
                  <div className="mb-4">
                    <Msg text={msg} />
                  </div>
                )}

                {!t.participants.length ? (
                  <EmptyState
                    title="No registrations yet"
                    hint="Entries will appear here as participants register and pay."
                  />
                ) : (
                  <div className="overflow-hidden rounded-xl border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            {t.regType === RegistrationType.TEAM ? 'Team' : 'Player'}
                          </TableHead>
                          <TableHead className="hidden sm:table-cell">Contact</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {t.participants.map((p) => {
                          const cancelled = !p.paid;
                          return (
                            <TableRow key={p.id}>
                              <TableCell className="font-medium">
                                {p.teamName || p.captainName}
                                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                                  {p.roster && p.roster.length > 0
                                    ? p.roster.join(', ')
                                    : `Captain ${p.captainName}`}
                                </span>
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
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`Actions for ${p.teamName || p.captainName}`}
                                    >
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      variant="destructive"
                                      disabled={cancelled}
                                      onSelect={() => {
                                        setMsg(null);
                                        setPending(p);
                                      }}
                                    >
                                      Cancel &amp; refund
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </SheetBody>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog
        open={!!pending}
        onOpenChange={(o) => !o && !cancelling && setPending(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Cancel registration?
            </DialogTitle>
            <DialogDescription>
              {pending && t && (
                <>
                  This cancels{' '}
                  <span className="font-medium text-foreground">
                    {pending.teamName || pending.captainName}
                  </span>{' '}
                  from <span className="font-medium text-foreground">{t.name}</span>.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/50 px-3.5 py-2.5 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>
              {t && closed && !t.refundAllowedAfterClose ? (
                <>
                  Registration has closed for this tournament, so the entry fee will{' '}
                  <span className="font-medium text-foreground">not be refunded</span>. The
                  participant will still be removed.
                </>
              ) : (
                <>
                  The entry fee will be refunded to the participant where applicable. Refunds
                  may be closed once registration has closed.
                </>
              )}
            </span>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={cancelling}>
              Keep registration
            </Button>
            <Button variant="destructive" onClick={confirmCancel} disabled={cancelling}>
              {cancelling && <Loader2 className="h-4 w-4 animate-spin" />}
              Cancel &amp; refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Round name for a knockout bracket of `totalRounds` rounds. */
function roundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  return `Round ${round}`;
}

const scoreInputCls =
  'h-9 w-12 rounded-lg border border-border bg-input-background text-center text-sm text-foreground outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20';

/** One bracket node / league pairing: participants, scores, winner, result entry. */
function MatchCard({
  m,
  scores,
  setScores,
  onSave,
  busy,
}: {
  m: FixtureMatch;
  scores: Record<string, { a: string; b: string }>;
  setScores: Dispatch<
    SetStateAction<Record<string, { a: string; b: string }>>
  >;
  onSave: () => void;
  busy: boolean;
}) {
  const both = !!(m.participantAId && m.participantBId);
  const done = m.status === 'completed';
  const s = scores[m.id] ?? { a: '', b: '' };
  const set = (k: 'a' | 'b', v: string) =>
    setScores((prev) => ({
      ...prev,
      [m.id]: { ...(prev[m.id] ?? { a: '', b: '' }), [k]: v },
    }));
  const label = (text: string | null) =>
    text ?? (done ? 'Bye' : 'TBD');
  const winA = !!m.winnerId && m.winnerId === m.participantAId;
  const winB = !!m.winnerId && m.winnerId === m.participantBId;

  const Row = ({
    text,
    score,
    win,
  }: {
    text: string | null;
    score: number | null;
    win: boolean;
  }) => (
    <div className="flex items-center justify-between gap-2">
      <span
        className={
          'truncate text-sm ' +
          (win ? 'font-semibold text-foreground' : 'text-muted-foreground')
        }
      >
        {label(text)}
      </span>
      {score != null && (
        <span className="tabular-nums text-sm text-foreground">{score}</span>
      )}
    </div>
  );

  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-card">
      <div className="space-y-1">
        <Row text={m.aLabel} score={m.scoreA} win={winA} />
        <Row text={m.bLabel} score={m.scoreB} win={winB} />
      </div>
      {done ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {m.winnerId ? 'Completed' : 'Draw'}
        </p>
      ) : both ? (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            value={s.a}
            onChange={(e) => set('a', e.target.value)}
            inputMode="numeric"
            placeholder="0"
            className={scoreInputCls}
          />
          <span className="text-muted-foreground">–</span>
          <input
            value={s.b}
            onChange={(e) => set('b', e.target.value)}
            inputMode="numeric"
            placeholder="0"
            className={scoreInputCls}
          />
          <Button size="sm" className="ml-auto" onClick={onSave} disabled={busy}>
            Save
          </Button>
        </div>
      ) : (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Awaiting participants
        </p>
      )}
    </div>
  );
}

/** Generate / view / score a tournament's fixtures (bracket or round-robin). */
function FixturesDialog({
  tournament,
  onClose,
}: {
  tournament: { id: string; name: string; format?: string };
  onClose: () => void;
}) {
  const board = useLoad<FixtureBoard>(
    () => api.getFixtures(tournament.id),
    [tournament.id],
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, { a: string; b: string }>>(
    {},
  );

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      board.reload();
      if (ok) setMsg(ok);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const data = board.data;
  const isKnockout = data?.format === 'knockout';

  const generate = () =>
    run(() => api.generateFixtures(tournament.id), 'Fixtures generated.');
  const regenerate = () => {
    if (
      !window.confirm('Regenerate fixtures? All recorded results will be lost.')
    )
      return;
    return run(async () => {
      await api.clearFixtures(tournament.id);
      await api.generateFixtures(tournament.id);
    }, 'Fixtures regenerated.');
  };
  const saveResult = (m: FixtureMatch) => {
    const s = scores[m.id];
    const a = Number(s?.a);
    const b = Number(s?.b);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
      setMsg('Enter both scores as whole non-negative numbers.');
      return;
    }
    return run(
      () => api.recordMatchResult(tournament.id, m.id, { scoreA: a, scoreB: b }),
      'Result saved.',
    );
  };

  const byRound = useMemo(() => {
    const groups: Record<number, FixtureMatch[]> = {};
    for (const m of data?.matches ?? []) (groups[m.round] ??= []).push(m);
    return groups;
  }, [data]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tournament.name} — Fixtures</DialogTitle>
          <DialogDescription>
            {isKnockout
              ? 'Single-elimination bracket — winners advance each round.'
              : 'Round-robin — every entrant plays each other; standings update as results come in.'}
          </DialogDescription>
        </DialogHeader>

        <Msg text={msg || board.error} />

        {board.loading && !data ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : !data?.generated ? (
          <div className="py-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              No fixtures yet. Generate the draw from the paid participants (needs
              at least 2).
            </p>
            <Button onClick={generate} disabled={busy}>
              {busy ? 'Generating…' : 'Generate fixtures'}
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={regenerate}
                disabled={busy}
              >
                Regenerate
              </Button>
            </div>

            {isKnockout ? (
              <div className="flex gap-4 overflow-x-auto pb-2">
                {Object.keys(byRound)
                  .map(Number)
                  .sort((a, b) => a - b)
                  .map((r) => (
                    <div key={r} className="min-w-[210px] flex-1">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {roundLabel(r, data.rounds)}
                      </p>
                      <div className="flex h-full flex-col justify-around gap-3">
                        {byRound[r].map((m) => (
                          <MatchCard
                            key={m.id}
                            m={m}
                            scores={scores}
                            setScores={setScores}
                            onSave={() => saveResult(m)}
                            busy={busy}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Standings
                  </p>
                  <div className="overflow-hidden rounded-xl border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-4">#</TableHead>
                          <TableHead>Entrant</TableHead>
                          <TableHead className="text-center">P</TableHead>
                          <TableHead className="text-center">W</TableHead>
                          <TableHead className="text-center">D</TableHead>
                          <TableHead className="text-center">L</TableHead>
                          <TableHead className="pr-4 text-center">Pts</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.standings.map((s, i) => (
                          <TableRow key={s.participantId}>
                            <TableCell className="pl-4 text-muted-foreground">
                              {i + 1}
                            </TableCell>
                            <TableCell className="font-medium">{s.label}</TableCell>
                            <TableCell className="text-center">{s.played}</TableCell>
                            <TableCell className="text-center">{s.won}</TableCell>
                            <TableCell className="text-center">{s.drawn}</TableCell>
                            <TableCell className="text-center">{s.lost}</TableCell>
                            <TableCell className="pr-4 text-center font-semibold">
                              {s.points}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Matches
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(data.matches ?? []).map((m) => (
                      <MatchCard
                        key={m.id}
                        m={m}
                        scores={scores}
                        setScores={setScores}
                        onSave={() => saveResult(m)}
                        busy={busy}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
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
            <SearchableSelect
              label="Venue"
              value={venueId}
              onChange={setVenueId}
              options={venues.map((v: any) => ({ value: v.id, label: v.name }))}
              searchPlaceholder="Search venues..."
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
                  <DatePicker
                    value={regCloseDate.from}
                    onChange={(d) => setRegCloseDate({ from: d })}
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
