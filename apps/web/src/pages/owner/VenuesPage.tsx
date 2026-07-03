import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { api, VenueListItem, VenueStatus } from '../../api/client';
import {
  Card,
  EmptyState,
  Field,
  Msg,
  PageHeader,
  SectionLabel,
  Select,
  StatusPill,
  useLoad,
} from '../../components/common';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { SearchableSelect } from '../../components/ui/combobox';
import { Skeleton } from '../../components/ui/skeleton';

const PAGE_SIZE = 12;

/** Human label + pill status for each derived ground status. */
// `pill` feeds common.tsx StatusPill -> toneFor() keyword matching. "Inactive"
// contains "active" (a green keyword), so we pass a neutral token ("off") that
// falls through to the muted tone; the visible label stays "Inactive".
const STATUS_META: Record<VenueStatus, { label: string; pill: string }> = {
  active: { label: 'Active', pill: 'active' },
  inactive: { label: 'Inactive', pill: 'off' },
  draft: { label: 'Draft', pill: 'draft' },
  needs_setup: { label: 'Needs setup', pill: 'pending' },
};

const STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'draft', label: 'Draft' },
  { value: 'needs_setup', label: 'Needs setup' },
];

/**
 * Owner: GROUNDS master list (PRD §4.1). A scalable, paginated and filterable
 * roster — each row clicks through to the ground's detail page where courts,
 * pricing, blocking, add-ons and policies live. Creating a ground stays here.
 */
export function VenuesPage() {
  const navigate = useNavigate();

  // Filter options sourced once (not paginated): games for the sport filter and
  // the distinct city set across this owner's grounds for the city filter.
  const games = useLoad(() => api.discoverGames());
  const allVenues = useLoad(() => api.listVenues());

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [city, setCity] = useState('');
  const [gameId, setGameId] = useState('');
  const [status, setStatus] = useState<VenueStatus | ''>('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Debounce free-text search so we don't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Any filter change returns to the first page.
  useEffect(() => {
    setPage(1);
  }, [debounced, city, gameId, status]);

  const result = useLoad(
    () =>
      api.listVenuesPage({
        q: debounced || undefined,
        city: city || undefined,
        gameId: gameId || undefined,
        status: status || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    [debounced, city, gameId, status, page],
  );

  const gameOpts = useMemo(
    () => [
      { value: '', label: 'All sports' },
      ...(games.data ?? []).map((g: any) => ({ value: g.id, label: g.name })),
    ],
    [games.data],
  );

  const cityOpts = useMemo(() => {
    const set = new Set<string>();
    for (const v of allVenues.data ?? []) {
      if (v.city) set.add(v.city);
    }
    return [
      { value: '', label: 'All cities' },
      ...[...set].sort().map((c) => ({ value: c, label: c })),
    ];
  }, [allVenues.data]);

  const items = result.data?.items ?? [];
  const total = result.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = !!(debounced || city || gameId || status);
  const noGames = (games.data ?? []).length === 0;

  const clearFilters = () => {
    setSearch('');
    setCity('');
    setGameId('');
    setStatus('');
  };

  return (
    <div className="container">
      <PageHeader
        title="Grounds"
        subtitle="Your portfolio at a glance. Open a ground to manage its courts, pricing and policies."
        badge={
          total > 0 ? (
            <StatusPill status="active">{`${total} ${total === 1 ? 'ground' : 'grounds'}`}</StatusPill>
          ) : undefined
        }
        action={
          <Button onClick={() => setCreateOpen(true)} disabled={noGames}>
            <Plus className="h-4 w-4" /> New ground
          </Button>
        }
      />

      <Msg text={msg} />

      {/* Toolbar: search + city / sport / status filters */}
      <Card className="mb-4">
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
                placeholder="Search grounds by name or city"
                className="h-10 w-full rounded-xl border border-border bg-input-background pl-9 pr-3.5 text-sm text-foreground outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
              />
            </div>
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:w-auto lg:min-w-[34rem]">
            <div>
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                City
              </span>
              <SearchableSelect
                value={city}
                onChange={setCity}
                options={cityOpts}
                placeholder="All cities"
                searchPlaceholder="Find a city"
              />
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Sport
              </span>
              <SearchableSelect
                value={gameId}
                onChange={setGameId}
                options={gameOpts}
                placeholder="All sports"
                searchPlaceholder="Find a sport"
              />
            </div>
            <div className="[&_label]:mb-0">
              <Select
                label="Status"
                value={status}
                onChange={(v) => setStatus(v as VenueStatus | '')}
                options={STATUS_OPTS}
              />
            </div>
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
          <EmptyState
            title="Couldn't load grounds"
            hint={result.error}
          />
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
                title="No grounds match these filters"
                hint="Try a different search, or clear the filters to see every ground."
              />
              <div className="flex justify-center pb-4">
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              </div>
            </>
          ) : (
            <EmptyState
              title="No grounds yet"
              hint={
                noGames
                  ? 'Ask your admin to enable a sport, then create your first ground.'
                  : 'Use "New ground" to add your first ground, then set up its courts, pricing and add-ons.'
              }
            />
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Ground</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead className="text-center">Courts</TableHead>
                  <TableHead className="min-w-[10rem]">Occupancy</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10 pr-5" aria-label="Open" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((v) => (
                  <GroundRow
                    key={v.id}
                    venue={v}
                    onOpen={() => navigate(`/owner/venues/${v.id}`)}
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
              {total} {total === 1 ? 'ground' : 'grounds'}
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

      <CreateGroundDialog
        open={createOpen}
        gameOpts={(games.data ?? []).map((g: any) => ({ value: g.id, label: g.name }))}
        defaultGame={(games.data ?? [])[0]?.id ?? ''}
        onClose={() => setCreateOpen(false)}
        onSaved={(created) => {
          setCreateOpen(false);
          setMsg('Ground created.');
          allVenues.reload();
          result.reload();
          if (created?.id) navigate(`/owner/venues/${created.id}`);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One ground row — whole row navigates to the detail page             */
/* ------------------------------------------------------------------ */

function GroundRow({
  venue: v,
  onOpen,
}: {
  venue: VenueListItem;
  onOpen: () => void;
}) {
  const meta = STATUS_META[v.status] ?? STATUS_META.active;
  const pct = Math.max(0, Math.min(100, Math.round(v.occupancyPct)));

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
            <Building2 className="h-[18px] w-[18px]" />
          </span>
          <span className="font-medium text-foreground">{v.name}</span>
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{v.city || '—'}</TableCell>
      <TableCell className="text-center tabular-nums">{v.courtCount}</TableCell>
      <TableCell>
        <OccupancyMeter pct={pct} courtCount={v.courtCount} />
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

/** Slim utilization meter — the list's signature read on each ground's pulse. */
function OccupancyMeter({ pct, courtCount }: { pct: number; courtCount: number }) {
  if (courtCount === 0) {
    return <span className="text-xs text-muted-foreground">No courts yet</span>;
  }
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-9 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
        {pct}%
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create-ground dialog (preserved from the previous page)             */
/* ------------------------------------------------------------------ */

function CreateGroundDialog({
  open,
  gameOpts,
  defaultGame,
  onClose,
  onSaved,
}: {
  open: boolean;
  gameOpts: { value: string; label: string }[];
  defaultGame: string;
  onClose: () => void;
  onSaved: (created: { id?: string } | null) => void;
}) {
  const [name, setName] = useState('New Ground');
  const [city, setCity] = useState('Bengaluru');
  const [gameId, setGameId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  // Reset the form each time the dialog opens (fresh defaults, no stale errors).
  if (open && !seeded) {
    setSeeded(true);
    setName('New Ground');
    setCity('Bengaluru');
    setGameId(defaultGame);
    setErr(null);
  }
  if (!open && seeded) setSeeded(false);

  const game = gameId || defaultGame;

  const save = async () => {
    if (!game) return;
    setBusy(true);
    setErr(null);
    try {
      const created = (await api.createVenue({
        name,
        city,
        gameIds: [game],
      })) as { id?: string } | null;
      onSaved(created);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New ground</DialogTitle>
          <DialogDescription>
            Add a ground to your portfolio. You'll set up its courts, pricing and
            add-ons on the next screen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section className="space-y-1">
            <SectionLabel icon={Building2}>Ground details</SectionLabel>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name" value={name} onChange={setName} />
              <Field label="City" value={city} onChange={setCity} />
            </div>
            <Select
              label="Sport"
              value={game}
              onChange={setGameId}
              options={gameOpts}
            />
          </section>
        </div>

        <Msg text={err} />

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!game || !name.trim() || busy}>
            <Plus className="h-4 w-4" /> {busy ? 'Creating…' : 'Create ground'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
