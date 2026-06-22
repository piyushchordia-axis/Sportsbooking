import {
  AddonType,
  DayType,
  OpenMatchRepaymentMode,
  TimeBand,
  UnitLabel,
} from '@sportsbooking/shared';
import { useState } from 'react';
import {
  Ban,
  Building2,
  CalendarClock,
  Grid3x3,
  IndianRupee,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Plus,
  PlusCircle,
  Settings2,
  Sparkles,
  Timer,
  Trash2,
} from 'lucide-react';
import { api, Addon, VenueSettings } from '../../api/client';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import {
  Select as UISelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  DateRangePicker,
  DateRangeValue,
} from '../../components/ui/date-range-picker';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import { Skeleton } from '../../components/ui/skeleton';

const UNIT_LABEL_OPTS = Object.values(UnitLabel).map((l) => ({ value: l, label: l }));

/** Owner: grounds, courts, per-court pricing grid, slot blocking and add-ons (PRD §4.1–4.3, §4.6). */
export function VenuesPage() {
  const games = useLoad(() => api.discoverGames());
  const venues = useLoad(() => api.listVenues());
  const [msg, setMsg] = useState<string | null>(null);

  // new venue
  const [vName, setVName] = useState('New Ground');
  const [city, setCity] = useState('Bengaluru');
  const [gameId, setGameId] = useState('');

  // edit dialogs
  const [editVenue, setEditVenue] = useState<any | null>(null);
  const [editUnit, setEditUnit] = useState<any | null>(null);
  const [settingsVenue, setSettingsVenue] = useState<any | null>(null);

  const wrap = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      venues.reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const gameOpts = (games.data ?? []).map((g: any) => ({ value: g.id, label: g.name }));
  const firstGame = gameId || gameOpts[0]?.value || '';

  const venueList = venues.data ?? [];
  const courtCount = venueList.reduce((n: number, v: any) => n + v.units.length, 0);

  const removeVenue = (v: any) => {
    if (
      !window.confirm(
        `Delete or deactivate "${v.name}"? Grounds with courts or bookings are deactivated, not removed.`,
      )
    )
      return;
    wrap(() => api.deleteVenue(v.id), `"${v.name}" removed.`);
  };

  const removeUnit = (u: any) => {
    if (
      !window.confirm(
        `Delete or deactivate court "${u.name}"? Courts with booking history are deactivated, not removed.`,
      )
    )
      return;
    wrap(() => api.deleteUnit(u.id), `Court "${u.name}" removed.`);
  };

  return (
    <div className="container">
      <PageHeader
        title="Grounds"
        subtitle="Manage courts, set the pricing grid, block slots and add-ons"
        badge={
          <div className="flex items-center gap-2">
            <StatusPill status="active">{`${venueList.length} grounds`}</StatusPill>
            <StatusPill status="active">{`${courtCount} courts`}</StatusPill>
          </div>
        }
      />

      <Card
        title="Create a ground"
        subtitle="Add a new ground to your portfolio, then set up its courts below"
        topAccent="primary"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Name" value={vName} onChange={setVName} />
          <Field label="City" value={city} onChange={setCity} />
          <Select label="Game" value={firstGame} onChange={setGameId} options={gameOpts} />
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button
            onClick={() =>
              wrap(
                () => api.createVenue({ name: vName, city, gameIds: [firstGame] }),
                'Ground created.',
              )
            }
            disabled={!firstGame}
          >
            <Plus className="h-4 w-4" /> Create ground
          </Button>
        </div>
        <Msg text={msg} />
      </Card>

      {venues.loading && venueList.length === 0 ? (
        <Card>
          <div className="space-y-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </Card>
      ) : venues.error ? (
        <Card>
          <Msg text={venues.error} />
        </Card>
      ) : venueList.length === 0 ? (
        <Card>
          <EmptyState
            title="No grounds yet"
            hint="Create your first ground above to start adding courts, pricing and add-ons."
          />
        </Card>
      ) : (
        venueList.map((v: any) => (
          <VenueCard
            key={v.id}
            venue={v}
            firstGame={firstGame}
            onMsg={setMsg}
            onReload={venues.reload}
            onEditVenue={() => setEditVenue(v)}
            onSettings={() => setSettingsVenue(v)}
            onRemoveVenue={() => removeVenue(v)}
            onEditUnit={setEditUnit}
            onRemoveUnit={removeUnit}
            wrap={wrap}
          />
        ))
      )}

      <EditVenueDialog
        venue={editVenue}
        onClose={() => setEditVenue(null)}
        onSave={(id, body) => wrap(() => api.updateVenue(id, body), 'Ground updated.')}
      />
      <EditUnitDialog
        unit={editUnit}
        onClose={() => setEditUnit(null)}
        onSave={(id, body) => wrap(() => api.updateUnit(id, body), 'Court updated.')}
      />
      <VenueSettingsDialog
        venue={settingsVenue}
        onClose={() => setSettingsVenue(null)}
        onSaved={(m) => {
          setMsg(m);
          venues.reload();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ground card — courts table, add-court, per-court tabbed workspace   */
/* ------------------------------------------------------------------ */

function VenueCard({
  venue: v,
  firstGame,
  onMsg,
  onReload,
  onEditVenue,
  onSettings,
  onRemoveVenue,
  onEditUnit,
  onRemoveUnit,
  wrap,
}: {
  venue: any;
  firstGame: string;
  onMsg: (m: string) => void;
  onReload: () => void;
  onEditVenue: () => void;
  onSettings: () => void;
  onRemoveVenue: () => void;
  onEditUnit: (u: any) => void;
  onRemoveUnit: (u: any) => void;
  wrap: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  const [activeCourt, setActiveCourt] = useState<string>(v.units[0]?.id ?? '');

  // Keep the active tab valid as courts change.
  if (v.units.length > 0 && !v.units.some((u: any) => u.id === activeCourt)) {
    setActiveCourt(v.units[0].id);
  }

  return (
    <InfoCard
      title={v.name}
      icon={Building2}
      accent="primary"
      action={
        <div className="flex items-center gap-2">
          <StatusPill status={v.active === false ? 'inactive' : 'active'}>
            {v.active === false ? 'Inactive' : 'Active'}
          </StatusPill>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Ground actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEditVenue}>
                <Pencil className="h-4 w-4" /> Edit ground
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onSettings}>
                <Settings2 className="h-4 w-4" /> Policies & settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onRemoveVenue}>
                <Trash2 className="h-4 w-4" /> Delete / deactivate
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1">
        <KeyVal label="City" value={v.city ?? ''} />
        <KeyVal label="Courts" value={v.units.length} />
      </div>

      {/* Courts roster */}
      <div className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel icon={LayoutGrid}>Courts</SectionLabel>
          <AddCourtButton venue={v} firstGame={firstGame} wrap={wrap} />
        </div>
        {v.units.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center">
            <p className="text-sm font-medium text-foreground">No courts yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add your first court to set its pricing grid and block slots.
            </p>
          </div>
        ) : (
          <div className="mt-3 overflow-hidden rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {v.units.map((u: any) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="capitalize">{u.label}</TableCell>
                    <TableCell>{u.capacity ?? '—'}</TableCell>
                    <TableCell>
                      <StatusPill status={u.active === false ? 'inactive' : 'active'}>
                        {u.active === false ? 'Inactive' : 'Active'}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Court actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => onEditUnit(u)}>
                            <Pencil className="h-4 w-4" /> Edit court
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => onRemoveUnit(u)}
                          >
                            <Trash2 className="h-4 w-4" /> Delete / deactivate
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Per-court workspace: one tab per court, never a long scroll */}
      {v.units.length > 0 && (
        <div className="mt-5 rounded-2xl border border-border bg-elevated/60 p-4">
          <SectionLabel icon={Settings2} className="mb-3">
            Court setup
          </SectionLabel>
          <Tabs value={activeCourt} onValueChange={setActiveCourt}>
            <TabsList className="flex w-full flex-wrap justify-start gap-1 overflow-x-auto">
              {v.units.map((u: any) => (
                <TabsTrigger key={u.id} value={u.id} className="flex-none">
                  {u.name}
                </TabsTrigger>
              ))}
            </TabsList>
            {v.units.map((u: any) => (
              <TabsContent key={u.id} value={u.id} className="mt-4 space-y-4">
                <PricingGridEditor unit={u} onMsg={onMsg} />
                <BlockSlotsPanel units={v.units} defaultUnitId={u.id} onMsg={onMsg} />
              </TabsContent>
            ))}
          </Tabs>
        </div>
      )}

      {/* Add-ons */}
      <AddonManager venueId={v.id} onMsg={onMsg} onReload={onReload} />
    </InfoCard>
  );
}

function AddCourtButton({
  venue: v,
  firstGame,
  wrap,
}: {
  venue: any;
  firstGame: string;
  wrap: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('Court 1');
  const [label, setLabel] = useState<UnitLabel>(UnitLabel.COURT);
  const [capacity, setCapacity] = useState('4');

  const add = () => {
    wrap(
      () =>
        api.addUnit(v.id, {
          name,
          label,
          gameId: v.games[0]?.gameId ?? firstGame,
          capacity: Math.max(1, Number(capacity) || 1),
        }),
      'Court added.',
    );
    setOpen(false);
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Add court
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a court</DialogTitle>
            <DialogDescription>
              Add a bookable court to {v.name}. You can set its pricing right after.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Court name" value={name} onChange={setName} />
            <Select
              label="Label"
              value={label}
              onChange={(x) => setLabel(x as UnitLabel)}
              options={UNIT_LABEL_OPTS}
            />
            <Field label="Capacity" type="number" value={capacity} onChange={setCapacity} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={add} disabled={!name.trim()}>
              <Plus className="h-4 w-4" /> Add court
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* FE-3: Pricing grid editor — weekday × time-band matrix + extras     */
/* ------------------------------------------------------------------ */

const DAY_ROWS: { day: DayType; label: string }[] = [
  { day: DayType.WEEKDAY, label: 'Weekdays' },
  { day: DayType.WEEKEND, label: 'Weekends' },
];

const BAND_COLS: { band: TimeBand; label: string; hint: string }[] = [
  { band: TimeBand.MORNING, label: 'Morning', hint: 'Opening – noon' },
  { band: TimeBand.AFTERNOON, label: 'Afternoon', hint: 'Noon – 5 pm' },
  { band: TimeBand.EVENING, label: 'Evening', hint: 'After 5 pm' },
];

type GridState = Record<string, string>; // `${day}|${band}` -> price string
type Tier = { id: number; minDuration: string; price: string };
type Override = { id: number; range: DateRangeValue; price: string };

const cellKey = (d: DayType, b: TimeBand) => `${d}|${b}`;

const DEFAULT_GRID: GridState = {
  [cellKey(DayType.WEEKDAY, TimeBand.MORNING)]: '600',
  [cellKey(DayType.WEEKDAY, TimeBand.AFTERNOON)]: '600',
  [cellKey(DayType.WEEKDAY, TimeBand.EVENING)]: '800',
  [cellKey(DayType.WEEKEND, TimeBand.MORNING)]: '800',
  [cellKey(DayType.WEEKEND, TimeBand.AFTERNOON)]: '800',
  [cellKey(DayType.WEEKEND, TimeBand.EVENING)]: '900',
};

/** Cell input for one weekday × time-band rate. */
function RateCell({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        ₹
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-xl border border-border bg-input-background pl-7 pr-3 text-sm font-medium text-foreground outline-none transition-[color,box-shadow] focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
      />
    </div>
  );
}

function PricingGridEditor({ unit, onMsg }: { unit: any; onMsg: (m: string) => void }) {
  const [grid, setGrid] = useState<GridState>(DEFAULT_GRID);
  const [base, setBase] = useState('600');
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useState(() => ({ n: 1 }))[0];
  const nextId = () => seq.n++;

  const setCell = (d: DayType, b: TimeBand, val: string) =>
    setGrid((g) => ({ ...g, [cellKey(d, b)]: val }));

  const fillRow = (d: DayType) => {
    const first = grid[cellKey(d, TimeBand.MORNING)] || base;
    setGrid((g) => ({
      ...g,
      [cellKey(d, TimeBand.MORNING)]: first,
      [cellKey(d, TimeBand.AFTERNOON)]: first,
      [cellKey(d, TimeBand.EVENING)]: first,
    }));
  };

  const save = async () => {
    onMsg('');
    setBusy(true);
    try {
      const rules: {
        dayType?: DayType;
        timeBand?: TimeBand;
        dateOverride?: string;
        minDuration?: number;
        price: number;
      }[] = [];

      // 1) Base fallback rate.
      rules.push({ price: Math.max(0, Number(base) || 0) });

      // 2) Weekday × time-band grid cells.
      for (const { day } of DAY_ROWS) {
        for (const { band } of BAND_COLS) {
          const raw = grid[cellKey(day, band)];
          if (raw == null || raw === '') continue;
          rules.push({ dayType: day, timeBand: band, price: Math.max(0, Number(raw) || 0) });
        }
      }

      // 3) Optional duration tiers.
      for (const t of tiers) {
        const mins = Number(t.minDuration);
        const price = Number(t.price);
        if (!mins || mins <= 0 || !price) continue;
        rules.push({ minDuration: Math.round(mins), price: Math.max(0, price) });
      }

      // 4) Optional date overrides — one rule per day in the chosen range.
      for (const o of overrides) {
        const price = Number(o.price);
        if (!o.range.from || !price) continue;
        const last = o.range.to ?? o.range.from;
        for (
          let d = new Date(o.range.from);
          d <= last;
          d.setDate(d.getDate() + 1)
        ) {
          rules.push({
            dateOverride: new Date(d).toISOString(),
            price: Math.max(0, price),
          });
        }
      }

      await api.setPricing(unit.id, rules);
      onMsg(`Pricing saved for ${unit.name}.`);
    } catch (e) {
      onMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 font-display text-base font-semibold">
            <IndianRupee className="h-4 w-4 text-primary" /> Pricing grid
          </h4>
          <p className="mt-1 text-sm text-muted-foreground">
            Set the hourly rate for each day type and time of day. Cells you leave
            empty fall back to the base rate.
          </p>
        </div>
      </div>

      {/* Grid matrix */}
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[34rem]">
          <div
            className="grid items-center gap-2"
            style={{ gridTemplateColumns: '7.5rem repeat(3, 1fr)' }}
          >
            {/* header row */}
            <div />
            {BAND_COLS.map((c) => (
              <div key={c.band} className="px-1 text-center">
                <p className="text-xs font-semibold text-foreground">{c.label}</p>
                <p className="text-[11px] text-muted-foreground">{c.hint}</p>
              </div>
            ))}

            {/* day rows */}
            {DAY_ROWS.map(({ day, label }) => (
              <Row
                key={day}
                day={day}
                label={label}
                grid={grid}
                onCell={setCell}
                onFill={() => fillRow(day)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Base rate */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:max-w-xs">
        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            Base rate (fallback)
          </span>
          <RateCell value={base} onChange={setBase} ariaLabel="Base hourly rate" />
        </label>
      </div>

      {/* Duration tiers */}
      <div className="mt-5 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel icon={Timer}>Duration tiers (optional)</SectionLabel>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setTiers((t) => [...t, { id: nextId(), minDuration: '90', price: '' }])
            }
          >
            <Plus className="h-4 w-4" /> Add tier
          </Button>
        </div>
        {tiers.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Charge a different rate for longer slots, e.g. 90 minutes and up.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {tiers.map((t) => (
              <div key={t.id} className="flex items-end gap-2">
                <label className="block flex-1">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Minimum minutes
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={t.minDuration}
                    onChange={(e) =>
                      setTiers((all) =>
                        all.map((x) =>
                          x.id === t.id ? { ...x, minDuration: e.target.value } : x,
                        ),
                      )
                    }
                    className="h-10 w-full rounded-xl border border-border bg-input-background px-3 text-sm outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
                  />
                </label>
                <label className="block flex-1">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Rate
                  </span>
                  <RateCell
                    value={t.price}
                    onChange={(v) =>
                      setTiers((all) =>
                        all.map((x) => (x.id === t.id ? { ...x, price: v } : x)),
                      )
                    }
                    ariaLabel="Tier rate"
                  />
                </label>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove tier"
                  onClick={() => setTiers((all) => all.filter((x) => x.id !== t.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Date overrides */}
      <div className="mt-5 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel icon={CalendarClock}>Date overrides (optional)</SectionLabel>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setOverrides((o) => [...o, { id: nextId(), range: {}, price: '' }])
            }
          >
            <Plus className="h-4 w-4" /> Add override
          </Button>
        </div>
        {overrides.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Override the grid on specific dates, e.g. holidays or peak weekends.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {overrides.map((o) => (
              <div key={o.id} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="block flex-1">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Dates
                  </span>
                  <DateRangePicker
                    value={o.range}
                    onChange={(range) =>
                      setOverrides((all) =>
                        all.map((x) => (x.id === o.id ? { ...x, range } : x)),
                      )
                    }
                    placeholder="Pick the dates"
                    numberOfMonths={1}
                  />
                </label>
                <label className="block sm:w-40">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Rate
                  </span>
                  <RateCell
                    value={o.price}
                    onChange={(v) =>
                      setOverrides((all) =>
                        all.map((x) => (x.id === o.id ? { ...x, price: v } : x)),
                      )
                    }
                    ariaLabel="Override rate"
                  />
                </label>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove override"
                  onClick={() =>
                    setOverrides((all) => all.filter((x) => x.id !== o.id))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save pricing grid'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Saving replaces this court's full pricing grid.
        </p>
      </div>
    </section>
  );
}

function Row({
  day,
  label,
  grid,
  onCell,
  onFill,
}: {
  day: DayType;
  label: string;
  grid: GridState;
  onCell: (d: DayType, b: TimeBand, v: string) => void;
  onFill: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onFill}
              aria-label={`Copy ${label} morning rate across the row`}
              className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/20"
            >
              <Grid3x3 className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Apply morning rate across the row</TooltipContent>
        </Tooltip>
      </div>
      {BAND_COLS.map((c) => (
        <RateCell
          key={c.band}
          value={grid[cellKey(day, c.band)] ?? ''}
          onChange={(v) => onCell(day, c.band, v)}
          ariaLabel={`${label} ${c.label} rate`}
        />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* PRD-6: Block slots — unit + date range + time window + reason       */
/* ------------------------------------------------------------------ */

/** Hour options 00:00–23:00 for the block time window. */
const HOUR_OPTS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, '0')}:00`,
}));

function BlockSlotsPanel({
  units,
  defaultUnitId,
  onMsg,
}: {
  units: any[];
  defaultUnitId: string;
  onMsg: (m: string) => void;
}) {
  const [unitId, setUnitId] = useState(defaultUnitId);
  const [range, setRange] = useState<DateRangeValue>({});
  const [startHour, setStartHour] = useState('6');
  const [endHour, setEndHour] = useState('22');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  // Follow the active court tab unless the owner picked another unit.
  const [tracked, setTracked] = useState(defaultUnitId);
  if (tracked !== defaultUnitId) {
    setTracked(defaultUnitId);
    setUnitId(defaultUnitId);
  }

  const unitOpts = units.map((u: any) => ({ value: u.id, label: u.name }));
  const valid =
    !!unitId && !!range.from && Number(endHour) > Number(startHour);

  const block = async () => {
    if (!valid || !range.from) return;
    onMsg('');
    setBusy(true);
    try {
      const last = range.to ?? range.from;
      let count = 0;
      for (
        let d = new Date(range.from);
        d <= last;
        d.setDate(d.getDate() + 1)
      ) {
        const start = new Date(d);
        start.setHours(Number(startHour), 0, 0, 0);
        const end = new Date(d);
        end.setHours(Number(endHour), 0, 0, 0);
        await api.blockSlots({
          unitId,
          start: start.toISOString(),
          end: end.toISOString(),
          reason: reason.trim() || undefined,
        });
        count++;
      }
      const name = units.find((u) => u.id === unitId)?.name ?? 'court';
      onMsg(
        `Blocked ${name} on ${count} ${count === 1 ? 'day' : 'days'} (${String(
          Number(startHour),
        ).padStart(2, '0')}:00–${String(Number(endHour)).padStart(2, '0')}:00).`,
      );
      setRange({});
      setReason('');
    } catch (e) {
      onMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h4 className="flex items-center gap-2 font-display text-base font-semibold">
        <Ban className="h-4 w-4 text-primary" /> Block slots
      </h4>
      <p className="mt-1 text-sm text-muted-foreground">
        Close a court for maintenance or private use. Blocked times can't be booked.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Court
          </span>
          <UISelect value={unitId} onValueChange={setUnitId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a court" />
            </SelectTrigger>
            <SelectContent>
              {unitOpts.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </UISelect>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Dates
          </span>
          <DateRangePicker
            value={range}
            onChange={setRange}
            placeholder="Pick the dates"
            numberOfMonths={1}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
            From
          </span>
          <UISelect value={startHour} onValueChange={setStartHour}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOUR_OPTS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </UISelect>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
            To
          </span>
          <UISelect value={endHour} onValueChange={setEndHour}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOUR_OPTS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </UISelect>
        </label>
      </div>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Reason (optional)
        </span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Court resurfacing"
          className="h-10 w-full rounded-xl border border-border bg-input-background px-3.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
        />
      </label>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={block} disabled={!valid || busy}>
          <Ban className="h-4 w-4" /> {busy ? 'Blocking…' : 'Block slots'}
        </Button>
        {!valid && (
          <p className="text-xs text-muted-foreground">
            Pick a court, dates and an end time after the start time.
          </p>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Add-on management — create + list + remove                          */
/* ------------------------------------------------------------------ */

const ADDON_TYPE_OPTS = Object.values(AddonType).map((t) => ({ value: t, label: t }));

function AddonManager({
  venueId,
  onMsg,
  onReload,
}: {
  venueId: string;
  onMsg: (m: string) => void;
  onReload: () => void;
}) {
  const addons = useLoad(() => api.listAddons(venueId), [venueId]);
  const [name, setName] = useState('Racket rental');
  const [type, setType] = useState<AddonType>(AddonType.RENTAL);
  const [price, setPrice] = useState('100');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    onMsg('');
    setBusy(true);
    try {
      await api.createAddon(venueId, {
        name,
        type,
        price: Math.max(0, Number(price) || 0),
      });
      onMsg('Add-on created.');
      addons.reload();
      onReload();
    } catch (e) {
      onMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: Addon) => {
    if (!window.confirm(`Remove add-on "${a.name}"?`)) return;
    onMsg('');
    try {
      await api.deleteAddon(a.id);
      onMsg(`Add-on "${a.name}" removed.`);
      addons.reload();
    } catch (e) {
      onMsg((e as Error).message);
    }
  };

  const list = addons.data ?? [];

  return (
    <div className="mt-5 rounded-2xl border border-border bg-elevated/60 p-4">
      <SectionLabel icon={Sparkles} className="mb-3">
        Add-ons
      </SectionLabel>

      {addons.loading && list.length === 0 ? (
        <Skeleton className="h-10 w-full" />
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No add-ons yet. Add rentals or extras customers can book alongside a slot.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {list.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5 text-sm"
            >
              <span className="font-medium">{a.name}</span>
              <span className="text-xs capitalize text-muted-foreground">{a.type}</span>
              <span className="font-medium text-primary">₹{a.price}</span>
              <button
                type="button"
                onClick={() => remove(a)}
                aria-label={`Remove ${a.name}`}
                className="grid h-5 w-5 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-destructive focus-visible:ring-2 focus-visible:ring-primary/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-10 w-full rounded-xl border border-border bg-input-background px-3.5 text-sm outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Type
          </span>
          <UISelect value={type} onValueChange={(x) => setType(x as AddonType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADDON_TYPE_OPTS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="capitalize">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </UISelect>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Price
          </span>
          <RateCell value={price} onChange={setPrice} ariaLabel="Add-on price" />
        </label>
        <Button onClick={add} disabled={busy || !name.trim()}>
          <PlusCircle className="h-4 w-4" /> {busy ? 'Adding…' : 'Add'}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dialogs — policies, edit ground, edit court                         */
/* ------------------------------------------------------------------ */

/** Cancellation template → (free window, penalty) mirror of the backend
 *  CANCELLATION_TEMPLATES map (bookings.service.ts), surfaced as helper text. */
const CANCELLATION_TEMPLATES: Record<
  'flexible' | 'moderate' | 'strict',
  { freeWindowHours: number; penaltyPct: number }
> = {
  flexible: { freeWindowHours: 4, penaltyPct: 50 },
  moderate: { freeWindowHours: 12, penaltyPct: 50 },
  strict: { freeWindowHours: 24, penaltyPct: 100 },
};

const CANCELLATION_OPTS = (['flexible', 'moderate', 'strict'] as const).map((t) => ({
  value: t,
  label: `${t[0].toUpperCase()}${t.slice(1)}`,
}));

const REPAYMENT_OPTS = [
  { value: OpenMatchRepaymentMode.INFO, label: 'Info only (no ledger)' },
  { value: OpenMatchRepaymentMode.LEDGER, label: 'Track repayment (ledger)' },
];

function VenueSettingsDialog({
  venue,
  onClose,
  onSaved,
}: {
  venue: any | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [cancellationTemplate, setCancellationTemplate] =
    useState<'flexible' | 'moderate' | 'strict'>('flexible');
  const [noShowFee, setNoShowFee] = useState('0');
  const [loyaltyEarnRate, setLoyaltyEarnRate] = useState('');
  const [loyaltyRedeemValue, setLoyaltyRedeemValue] = useState('');
  const [openMatchRepaymentMode, setOpenMatchRepaymentMode] =
    useState<OpenMatchRepaymentMode>(OpenMatchRepaymentMode.INFO);

  const prefill = (s: VenueSettings) => {
    setCancellationTemplate(s.cancellationTemplate);
    setNoShowFee(String(s.noShowFee ?? 0));
    setLoyaltyEarnRate(s.loyaltyEarnRate == null ? '' : String(s.loyaltyEarnRate));
    setLoyaltyRedeemValue(
      s.loyaltyRedeemValue == null ? '' : String(s.loyaltyRedeemValue),
    );
    setOpenMatchRepaymentMode(s.openMatchRepaymentMode);
  };

  // Load settings once per opened venue (no effect; mirrors EditVenueDialog).
  if (venue && loaded !== venue.id) {
    setLoaded(venue.id);
    setErr(null);
    api
      .getVenueSettings(venue.id)
      .then(prefill)
      .catch((e) => setErr((e as Error).message));
  }
  if (!venue && loaded !== null) setLoaded(null);

  const tpl = CANCELLATION_TEMPLATES[cancellationTemplate];

  const save = async () => {
    if (!venue) return;
    setBusy(true);
    setErr(null);
    try {
      const earn = loyaltyEarnRate.trim();
      const redeem = loyaltyRedeemValue.trim();
      await api.updateVenueSettings(venue.id, {
        cancellationTemplate,
        noShowFee: Math.max(0, Number(noShowFee) || 0),
        ...(earn === '' ? {} : { loyaltyEarnRate: Math.max(0, Number(earn) || 0) }),
        ...(redeem === ''
          ? {}
          : { loyaltyRedeemValue: Math.max(0, Number(redeem) || 0) }),
        openMatchRepaymentMode,
      });
      onSaved(`Settings saved for "${venue.name}".`);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!venue} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Policies & settings</DialogTitle>
          <DialogDescription>
            Cancellation, no-show fee, loyalty overrides and open-match repayment
            {venue ? ` for "${venue.name}"` : ''}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Select
            label="Cancellation template"
            value={cancellationTemplate}
            onChange={(x) =>
              setCancellationTemplate(x as 'flexible' | 'moderate' | 'strict')
            }
            options={CANCELLATION_OPTS}
          />
          <p className="-mt-2 mb-3 text-xs text-muted-foreground">
            Free cancellation up to {tpl.freeWindowHours}h before start; inside that
            window a {tpl.penaltyPct}% penalty applies.
          </p>

          <Field
            label="No-show fee (₹)"
            type="number"
            value={noShowFee}
            onChange={setNoShowFee}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              label="Loyalty earn rate (override)"
              type="number"
              value={loyaltyEarnRate}
              onChange={setLoyaltyEarnRate}
              placeholder="Blank = owner default"
            />
            <Field
              label="Loyalty redeem value ₹ (override)"
              type="number"
              value={loyaltyRedeemValue}
              onChange={setLoyaltyRedeemValue}
              placeholder="Blank = owner default"
            />
          </div>
          <p className="-mt-2 mb-3 text-xs text-muted-foreground">
            Leave loyalty fields blank to inherit your owner-level defaults.
          </p>

          <Select
            label="Open-match repayment mode"
            value={openMatchRepaymentMode}
            onChange={(x) => setOpenMatchRepaymentMode(x as OpenMatchRepaymentMode)}
            options={REPAYMENT_OPTS}
          />
        </div>

        <Msg text={err} />

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save settings'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditVenueDialog({
  venue,
  onClose,
  onSave,
}: {
  venue: any | null;
  onClose: () => void;
  onSave: (id: string, body: { name: string; city: string }) => void;
}) {
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [loaded, setLoaded] = useState<string | null>(null);

  // Sync local form state to the venue being edited (without an effect).
  if (venue && loaded !== venue.id) {
    setName(venue.name ?? '');
    setCity(venue.city ?? '');
    setLoaded(venue.id);
  }
  if (!venue && loaded !== null) setLoaded(null);

  const save = () => {
    if (!venue) return;
    onSave(venue.id, { name, city });
    onClose();
  };

  return (
    <Dialog open={!!venue} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit ground</DialogTitle>
          <DialogDescription>Update the ground name and city.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name" value={name} onChange={setName} />
          <Field label="City" value={city} onChange={setCity} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!name.trim()}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUnitDialog({
  unit,
  onClose,
  onSave,
}: {
  unit: any | null;
  onClose: () => void;
  onSave: (id: string, body: { name: string; label: UnitLabel; capacity: number }) => void;
}) {
  const [name, setName] = useState('');
  const [label, setLabel] = useState<UnitLabel>(UnitLabel.COURT);
  const [capacity, setCapacity] = useState('4');
  const [loaded, setLoaded] = useState<string | null>(null);

  if (unit && loaded !== unit.id) {
    setName(unit.name ?? '');
    setLabel((unit.label as UnitLabel) ?? UnitLabel.COURT);
    setCapacity(String(unit.capacity ?? 4));
    setLoaded(unit.id);
  }
  if (!unit && loaded !== null) setLoaded(null);

  const save = () => {
    if (!unit) return;
    onSave(unit.id, { name, label, capacity: Math.max(1, Number(capacity) || 1) });
    onClose();
  };

  return (
    <Dialog open={!!unit} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit court</DialogTitle>
          <DialogDescription>Update the court name, label and capacity.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Name" value={name} onChange={setName} />
          <Select
            label="Label"
            value={label}
            onChange={(x) => setLabel(x as UnitLabel)}
            options={UNIT_LABEL_OPTS}
          />
          <Field label="Capacity" type="number" value={capacity} onChange={setCapacity} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!name.trim()}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
