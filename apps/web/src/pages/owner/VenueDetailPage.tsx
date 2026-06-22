import {
  AddonType,
  DayType,
  OpenMatchRepaymentMode,
  TimeBand,
  UnitLabel,
} from '@sportsbooking/shared';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Building2,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Grid3x3,
  IndianRupee,
  Layers,
  LayoutGrid,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  PlusCircle,
  Search,
  Settings2,
  Sparkles,
  Timer,
  Trash2,
} from 'lucide-react';
import {
  api,
  Addon,
  VenueDetail,
  VenueDetailUnit,
  VenueOverview,
  VenueSchedule,
  VenueScheduleSlot,
  VenueSettings,
} from '../../api/client';
import {
  Card,
  EmptyState,
  Field,
  KeyVal,
  Msg,
  PageHeader,
  SectionLabel,
  Select,
  Stat,
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
import { SearchableSelect } from '../../components/ui/combobox';
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
const COURTS_PER_PAGE = 8;

/**
 * Owner: a single ground's detail workspace (PRD §4.1–4.3, §4.6). Tabs split
 * the heavy court/pricing/availability/add-on/settings work out of the grounds
 * list so each job has room to breathe.
 */
export function VenueDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const venue = useLoad<VenueDetail>(() => api.getVenue(id), [id]);
  const overview = useLoad(() => api.venueOverview(id), [id]);
  const [msg, setMsg] = useState<string | null>(null);

  const reloadAll = () => {
    venue.reload();
    overview.reload();
  };

  // Mutations route their result message through one banner; refresh on success.
  const wrap = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      reloadAll();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const v = venue.data;

  if (venue.loading && !v) {
    return (
      <div className="container">
        <Card>
          <div className="space-y-3">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        </Card>
      </div>
    );
  }

  if (venue.error || !v) {
    return (
      <div className="container">
        <PageHeader
          title="Ground"
          breadcrumb={<Breadcrumb name={null} />}
        />
        <Card>
          {venue.error ? (
            <Msg text={venue.error} />
          ) : (
            <EmptyState
              title="Ground not found"
              hint="This ground may have been removed, or you don't have access to it."
            />
          )}
          <div className="mt-4">
            <Button asChild variant="outline">
              <Link to="/owner/venues">
                <ChevronLeft className="h-4 w-4" /> Back to grounds
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="container">
      <PageHeader
        title={v.name}
        subtitle="Courts, pricing, availability, add-ons and policies for this ground"
        breadcrumb={<Breadcrumb name={v.name} />}
        badge={
          <StatusPill status={v.active === false ? 'inactive' : 'active'}>
            {v.active === false ? 'Inactive' : 'Active'}
          </StatusPill>
        }
      />

      <Msg text={msg} />

      <Tabs defaultValue="overview" className="mt-2">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 overflow-x-auto">
          <TabsTrigger value="overview" className="flex-none">
            <Building2 /> Overview
          </TabsTrigger>
          <TabsTrigger value="courts" className="flex-none">
            <LayoutGrid /> Courts
          </TabsTrigger>
          <TabsTrigger value="pricing" className="flex-none">
            <IndianRupee /> Pricing
          </TabsTrigger>
          <TabsTrigger value="availability" className="flex-none">
            <CalendarDays /> Availability
          </TabsTrigger>
          <TabsTrigger value="addons" className="flex-none">
            <Sparkles /> Add-ons
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex-none">
            <Settings2 /> Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-5">
          <OverviewTab
            venue={v}
            overview={overview}
            onSave={(body) => wrap(() => api.updateVenue(v.id, body), 'Ground updated.')}
          />
        </TabsContent>

        <TabsContent value="courts" className="mt-5">
          <CourtsTab venue={v} onMsg={setMsg} wrap={wrap} />
        </TabsContent>

        <TabsContent value="pricing" className="mt-5">
          <PricingTab venue={v} onMsg={setMsg} />
        </TabsContent>

        <TabsContent value="availability" className="mt-5">
          <AvailabilityTab venueId={v.id} onMsg={setMsg} />
        </TabsContent>

        <TabsContent value="addons" className="mt-5">
          <AddonsTab venueId={v.id} onMsg={setMsg} />
        </TabsContent>

        <TabsContent value="settings" className="mt-5">
          <SettingsTab venue={v} onMsg={setMsg} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Breadcrumb({ name }: { name: string | null }) {
  return (
    <span className="flex items-center gap-1.5">
      <Link to="/owner/venues" className="hover:text-foreground transition-colors">
        Grounds
      </Link>
      <ChevronRight className="h-3 w-3 opacity-60" />
      <span className="text-foreground font-medium">{name ?? '…'}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Overview — ground info, headline stats, edit ground                 */
/* ------------------------------------------------------------------ */

function OverviewTab({
  venue: v,
  overview,
  onSave,
}: {
  venue: VenueDetail;
  overview: ReturnType<typeof useLoad<VenueOverview>>;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [edit, setEdit] = useState(false);
  const o = overview.data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {overview.loading && !o ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))
        ) : overview.error ? (
          <Card className="col-span-2 lg:col-span-4">
            <Msg text={overview.error} />
          </Card>
        ) : (
          <>
            <Stat label="Courts" value={o?.courtCount ?? v.units.length} icon={LayoutGrid} />
            <Stat
              label="Bookings this week"
              value={o?.bookingsThisWeek ?? 0}
              icon={CalendarDays}
              accent="blue"
            />
            <Stat
              label="Revenue this week"
              value={`₹${(o?.revenueThisWeek ?? 0).toLocaleString('en-IN')}`}
              icon={IndianRupee}
              accent="emerald"
            />
            <Stat
              label="Occupancy"
              value={`${o?.occupancyPct ?? 0}%`}
              sub="Next 7 days"
              icon={Timer}
              accent="orange"
            />
          </>
        )}
      </div>

      <Card
        title="Ground details"
        action={
          <Button variant="outline" size="sm" onClick={() => setEdit(true)}>
            <Pencil className="h-4 w-4" /> Edit ground
          </Button>
        }
        topAccent="primary"
      >
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          <KeyVal label="Name" value={v.name} />
          <KeyVal label="City" value={v.city || '—'} />
          <KeyVal
            label="Address"
            value={
              v.address ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" /> {v.address}
                </span>
              ) : (
                '—'
              )
            }
          />
          <KeyVal
            label="Hours"
            value={
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                {v.openTime}–{v.closeTime}
              </span>
            }
          />
          <KeyVal label="Contact" value={v.contactPhone || '—'} />
          <KeyVal label="Photos" value={`${v.photos?.length ?? 0} uploaded`} />
        </div>

        {v.photos && v.photos.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-3">
            {v.photos.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`${v.name} photo ${i + 1}`}
                className="h-24 w-32 rounded-xl border border-border object-cover"
              />
            ))}
          </div>
        )}
      </Card>

      <EditVenueDialog
        venue={edit ? v : null}
        onClose={() => setEdit(false)}
        onSave={(body) => {
          onSave(body);
          setEdit(false);
        }}
      />
    </div>
  );
}

function EditVenueDialog({
  venue,
  onClose,
  onSave,
}: {
  venue: VenueDetail | null;
  onClose: () => void;
  onSave: (body: {
    name: string;
    city: string;
    address: string;
    contactPhone: string;
    openTime: string;
    closeTime: string;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [openTime, setOpenTime] = useState('06:00');
  const [closeTime, setCloseTime] = useState('22:00');
  const [loaded, setLoaded] = useState<string | null>(null);

  if (venue && loaded !== venue.id) {
    setName(venue.name ?? '');
    setCity(venue.city ?? '');
    setAddress(venue.address ?? '');
    setContactPhone(venue.contactPhone ?? '');
    setOpenTime(venue.openTime ?? '06:00');
    setCloseTime(venue.closeTime ?? '22:00');
    setLoaded(venue.id);
  }
  if (!venue && loaded !== null) setLoaded(null);

  const save = () => {
    if (!venue) return;
    onSave({ name, city, address, contactPhone, openTime, closeTime });
  };

  return (
    <Dialog open={!!venue} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit ground</DialogTitle>
          <DialogDescription>
            Update this ground's name, location and opening hours.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" value={name} onChange={setName} />
          <Field label="City" value={city} onChange={setCity} />
        </div>
        <Field label="Address" value={address} onChange={setAddress} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Contact phone" value={contactPhone} onChange={setContactPhone} />
          <Field label="Opens" type="time" value={openTime} onChange={setOpenTime} />
          <Field label="Closes" type="time" value={closeTime} onChange={setCloseTime} />
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

/* ------------------------------------------------------------------ */
/* Courts — searchable, paginated roster + court CRUD + bulk pricing    */
/* ------------------------------------------------------------------ */

function CourtsTab({
  venue: v,
  onMsg,
  wrap,
}: {
  venue: VenueDetail;
  onMsg: (m: string) => void;
  wrap: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [editUnit, setEditUnit] = useState<VenueDetailUnit | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return v.units;
    return v.units.filter(
      (u) =>
        u.name.toLowerCase().includes(q) || (u.label ?? '').toLowerCase().includes(q),
    );
  }, [v.units, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / COURTS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice(
    (safePage - 1) * COURTS_PER_PAGE,
    safePage * COURTS_PER_PAGE,
  );

  const removeUnit = (u: VenueDetailUnit) => {
    if (
      !window.confirm(
        `Delete or deactivate court "${u.name}"? Courts with booking history are deactivated, not removed.`,
      )
    )
      return;
    wrap(() => api.deleteUnit(u.id), `Court "${u.name}" removed.`);
  };

  return (
    <Card
      title="Courts"
      subtitle="Each court is bookable on its own schedule and pricing grid."
      topAccent="primary"
      action={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBulkOpen(true)}
            disabled={v.units.length === 0}
          >
            <Layers className="h-4 w-4" /> Bulk pricing
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Add court
          </Button>
        </div>
      }
    >
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search courts by name or label"
          aria-label="Search courts"
          className="h-10 w-full rounded-xl border border-border bg-input-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
        />
      </div>

      {v.units.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No courts yet"
            hint="Add your first court to set its pricing grid and start taking bookings."
          />
        </div>
      ) : filtered.length === 0 ? (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          No courts match “{query}”.
        </p>
      ) : (
        <>
          <div className="mt-4 overflow-hidden rounded-xl border border-border">
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
                {pageRows.map((u) => (
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
                          <DropdownMenuItem onSelect={() => setEditUnit(u)}>
                            <Pencil className="h-4 w-4" /> Edit court
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => removeUnit(u)}
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

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {(safePage - 1) * COURTS_PER_PAGE + 1}–
                {Math.min(safePage * COURTS_PER_PAGE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Previous page"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm tabular-nums">
                  {safePage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Next page"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <AddCourtDialog
        open={addOpen}
        venue={v}
        onClose={() => setAddOpen(false)}
        onSave={(body) => {
          wrap(() => api.addUnit(v.id, body), 'Court added.');
          setAddOpen(false);
        }}
      />
      <EditUnitDialog
        unit={editUnit}
        onClose={() => setEditUnit(null)}
        onSave={(uid, body) => {
          wrap(() => api.updateUnit(uid, body), 'Court updated.');
          setEditUnit(null);
        }}
      />
      <BulkPricingDialog
        open={bulkOpen}
        venue={v}
        onClose={() => setBulkOpen(false)}
        onMsg={onMsg}
      />
    </Card>
  );
}

function AddCourtDialog({
  open,
  venue: v,
  onClose,
  onSave,
}: {
  open: boolean;
  venue: VenueDetail;
  onClose: () => void;
  onSave: (body: {
    name: string;
    label: UnitLabel;
    gameId: string;
    capacity: number;
  }) => void;
}) {
  const [name, setName] = useState('Court 1');
  const [label, setLabel] = useState<UnitLabel>(UnitLabel.COURT);
  const [capacity, setCapacity] = useState('4');

  const gameId = v.games[0]?.gameId ?? '';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a court</DialogTitle>
          <DialogDescription>
            Add a bookable court to {v.name}. Set its pricing in the Pricing tab.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSave({
                name,
                label,
                gameId,
                capacity: Math.max(1, Number(capacity) || 1),
              })
            }
            disabled={!name.trim()}
          >
            <Plus className="h-4 w-4" /> Add court
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
  unit: VenueDetailUnit | null;
  onClose: () => void;
  onSave: (
    id: string,
    body: { name: string; label: UnitLabel; capacity: number },
  ) => void;
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

  return (
    <Dialog open={!!unit} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit court</DialogTitle>
          <DialogDescription>Update the court name, label and capacity.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
          <Button
            onClick={() =>
              unit &&
              onSave(unit.id, {
                name,
                label,
                capacity: Math.max(1, Number(capacity) || 1),
              })
            }
            disabled={!name.trim()}
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Pricing grid — weekday × time-band matrix + tiers + overrides        */
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

type GridState = Record<string, string>;
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

/** One pricing-grid cell input. */
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

/** Build pricing rules from the grid/base/tiers/overrides editor state. */
function buildRules(
  grid: GridState,
  base: string,
  tiers: Tier[],
  overrides: Override[],
) {
  const rules: {
    dayType?: DayType;
    timeBand?: TimeBand;
    dateOverride?: string;
    minDuration?: number;
    price: number;
  }[] = [];

  rules.push({ price: Math.max(0, Number(base) || 0) });

  for (const { day } of DAY_ROWS) {
    for (const { band } of BAND_COLS) {
      const raw = grid[cellKey(day, band)];
      if (raw == null || raw === '') continue;
      rules.push({ dayType: day, timeBand: band, price: Math.max(0, Number(raw) || 0) });
    }
  }

  for (const t of tiers) {
    const mins = Number(t.minDuration);
    const price = Number(t.price);
    if (!mins || mins <= 0 || !price) continue;
    rules.push({ minDuration: Math.round(mins), price: Math.max(0, price) });
  }

  for (const o of overrides) {
    const price = Number(o.price);
    if (!o.range.from || !price) continue;
    const last = o.range.to ?? o.range.from;
    for (let d = new Date(o.range.from); d <= last; d.setDate(d.getDate() + 1)) {
      rules.push({ dateOverride: new Date(d).toISOString(), price: Math.max(0, price) });
    }
  }

  return rules;
}

function PricingTab({
  venue: v,
  onMsg,
}: {
  venue: VenueDetail;
  onMsg: (m: string) => void;
}) {
  const [unitId, setUnitId] = useState(v.units[0]?.id ?? '');
  const [grid, setGrid] = useState<GridState>(DEFAULT_GRID);
  const [base, setBase] = useState('600');
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useState(() => ({ n: 1 }))[0];
  const nextId = () => seq.n++;

  // Keep the active court valid as the roster changes.
  if (v.units.length > 0 && !v.units.some((u) => u.id === unitId)) {
    setUnitId(v.units[0].id);
  }

  const unitOpts = v.units.map((u) => ({ value: u.id, label: u.name }));
  const activeName = v.units.find((u) => u.id === unitId)?.name ?? 'this court';

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
    if (!unitId) return;
    onMsg('');
    setBusy(true);
    try {
      await api.setPricing(unitId, buildRules(grid, base, tiers, overrides));
      onMsg(`Pricing saved for ${activeName}.`);
    } catch (e) {
      onMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const applyBulk = async () => {
    if (bulkIds.length === 0) return;
    onMsg('');
    setBusy(true);
    try {
      await api.bulkPricing(v.id, {
        unitIds: bulkIds,
        rules: buildRules(grid, base, tiers, overrides),
      });
      onMsg(
        `Applied this grid to ${bulkIds.length} ${
          bulkIds.length === 1 ? 'court' : 'courts'
        }.`,
      );
      setBulkIds([]);
    } catch (e) {
      onMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (v.units.length === 0) {
    return (
      <Card topAccent="primary">
        <EmptyState
          title="Add a court first"
          hint="Pricing grids are set per court. Create a court in the Courts tab to begin."
        />
      </Card>
    );
  }

  return (
    <Card
      title="Pricing grid"
      subtitle="Set the hourly rate per day type and time of day. Empty cells fall back to the base rate."
      topAccent="primary"
    >
      <div className="max-w-sm">
        <SearchableSelect
          label="Court"
          value={unitId}
          onChange={setUnitId}
          options={unitOpts}
          placeholder="Pick a court"
          searchPlaceholder="Search courts…"
        />
      </div>

      {/* Grid matrix */}
      <div className="mt-2 overflow-x-auto">
        <div className="min-w-[34rem]">
          <div
            className="grid items-center gap-2"
            style={{ gridTemplateColumns: '7.5rem repeat(3, 1fr)' }}
          >
            <div />
            {BAND_COLS.map((c) => (
              <div key={c.band} className="px-1 text-center">
                <p className="text-xs font-semibold text-foreground">{c.label}</p>
                <p className="text-[11px] text-muted-foreground">{c.hint}</p>
              </div>
            ))}

            {DAY_ROWS.map(({ day, label }) => (
              <PricingRow
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
      <div className="mt-4 sm:max-w-xs">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
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
                    onChange={(val) =>
                      setTiers((all) =>
                        all.map((x) => (x.id === t.id ? { ...x, price: val } : x)),
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
            onClick={() => setOverrides((o) => [...o, { id: nextId(), range: {}, price: '' }])}
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
                    onChange={(val) =>
                      setOverrides((all) =>
                        all.map((x) => (x.id === o.id ? { ...x, price: val } : x)),
                      )
                    }
                    ariaLabel="Override rate"
                  />
                </label>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove override"
                  onClick={() => setOverrides((all) => all.filter((x) => x.id !== o.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : `Save grid for ${activeName}`}
        </Button>
        <p className="text-xs text-muted-foreground">
          Saving replaces this court's full pricing grid.
        </p>
      </div>

      {/* Bulk apply this grid to many courts */}
      {v.units.length > 1 && (
        <div className="mt-5 rounded-2xl border border-border bg-elevated/60 p-4">
          <SectionLabel icon={Layers} className="mb-1">
            Apply this grid to more courts
          </SectionLabel>
          <p className="mb-3 text-xs text-muted-foreground">
            Copy the grid above onto other courts at once. Each selected court's grid is replaced.
          </p>
          <div className="flex flex-wrap gap-2">
            {v.units.map((u) => {
              const on = bulkIds.includes(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() =>
                    setBulkIds((ids) =>
                      on ? ids.filter((x) => x !== u.id) : [...ids, u.id],
                    )
                  }
                  aria-pressed={on}
                  className={
                    on
                      ? 'rounded-xl border border-primary bg-primary/12 px-3 py-1.5 text-sm font-medium text-foreground transition-colors'
                      : 'rounded-xl border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground'
                  }
                >
                  {u.name}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={applyBulk} disabled={busy || bulkIds.length === 0}>
              <Layers className="h-4 w-4" />
              {busy
                ? 'Applying…'
                : `Apply to ${bulkIds.length || 'selected'} ${
                    bulkIds.length === 1 ? 'court' : 'courts'
                  }`}
            </Button>
            {bulkIds.length > 0 && (
              <button
                type="button"
                onClick={() => setBulkIds([])}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear selection
              </button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function PricingRow({
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
          onChange={(val) => onCell(day, c.band, val)}
          ariaLabel={`${label} ${c.label} rate`}
        />
      ))}
    </>
  );
}

/** Bulk-pricing dialog launched from the Courts tab — base rate to many courts. */
function BulkPricingDialog({
  open,
  venue: v,
  onClose,
  onMsg,
}: {
  open: boolean;
  venue: VenueDetail;
  onClose: () => void;
  onMsg: (m: string) => void;
}) {
  const [price, setPrice] = useState('600');
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState(false);

  if (open && !seeded) {
    setSeeded(true);
    setIds(v.units.map((u) => u.id));
    setPrice('600');
  }
  if (!open && seeded) setSeeded(false);

  const apply = async () => {
    if (ids.length === 0) return;
    onMsg('');
    setBusy(true);
    try {
      await api.bulkPricing(v.id, {
        unitIds: ids,
        rules: [{ price: Math.max(0, Number(price) || 0) }],
      });
      onMsg(
        `Applied a ₹${Math.max(0, Number(price) || 0)} base rate to ${ids.length} ${
          ids.length === 1 ? 'court' : 'courts'
        }.`,
      );
      onClose();
    } catch (e) {
      onMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk pricing</DialogTitle>
          <DialogDescription>
            Set a flat base rate across several courts at once. For day/time grids, use the
            Pricing tab.
          </DialogDescription>
        </DialogHeader>

        <label className="block sm:max-w-xs">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Base rate (per hour)
          </span>
          <RateCell value={price} onChange={setPrice} ariaLabel="Bulk base rate" />
        </label>

        <div className="mt-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Courts</span>
            <button
              type="button"
              onClick={() =>
                setIds(ids.length === v.units.length ? [] : v.units.map((u) => u.id))
              }
              className="text-xs text-primary hover:underline"
            >
              {ids.length === v.units.length ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {v.units.map((u) => {
              const on = ids.includes(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() =>
                    setIds((cur) => (on ? cur.filter((x) => x !== u.id) : [...cur, u.id]))
                  }
                  aria-pressed={on}
                  className={
                    on
                      ? 'rounded-xl border border-primary bg-primary/12 px-3 py-1.5 text-sm font-medium text-foreground'
                      : 'rounded-xl border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:border-foreground/25 hover:text-foreground'
                  }
                >
                  {u.name}
                </button>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={busy || ids.length === 0}>
            {busy ? 'Applying…' : `Apply to ${ids.length} ${ids.length === 1 ? 'court' : 'courts'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Availability — schedule day-grid (signature element)                */
/* ------------------------------------------------------------------ */

const todayISO = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
};

const hourLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

function AvailabilityTab({
  venueId,
  onMsg,
}: {
  venueId: string;
  onMsg: (m: string) => void;
}) {
  const [date, setDate] = useState(todayISO());
  const schedule = useLoad<VenueSchedule>(() => api.venueSchedule(venueId, date), [
    venueId,
    date,
  ]);
  const [busyCell, setBusyCell] = useState<string | null>(null);

  const data = schedule.data;

  const shiftDay = (delta: number) => {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + delta);
    setDate(d.toISOString().slice(0, 10));
  };

  // Column headers come from the first court's slot row (all courts align).
  const columns = data?.courts[0]?.slots ?? [];

  const act = async (
    courtId: string,
    slot: VenueScheduleSlot,
    action: 'block' | 'unblock',
  ) => {
    const cellId = `${courtId}|${slot.start}`;
    setBusyCell(cellId);
    onMsg('');
    try {
      if (action === 'block') {
        await api.blockSlots({ unitId: courtId, start: slot.start, end: slot.end });
        onMsg(`Blocked ${hourLabel(slot.start)} slot.`);
      } else {
        await api.unblockSlots({ unitId: courtId, start: slot.start, end: slot.end });
        onMsg(`Unblocked ${hourLabel(slot.start)} slot.`);
      }
      schedule.reload();
    } catch (e) {
      onMsg((e as Error).message);
    } finally {
      setBusyCell(null);
    }
  };

  return (
    <Card
      title="Availability"
      subtitle="One day at a glance — green is open, teal is booked, red is blocked. Click a cell to block or free it."
      topAccent="primary"
      action={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous day"
            onClick={() => shiftDay(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || todayISO())}
            aria-label="Schedule date"
            className="h-9 rounded-xl border border-border bg-input-background px-3 text-sm outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="Next day"
            onClick={() => shiftDay(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      {/* Legend */}
      <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <LegendDot className="bg-muted border border-border" label="Free — click to block" />
        <LegendDot className="bg-primary" label="Booked" />
        <LegendDot className="bg-destructive" label="Blocked — click to free" />
      </div>

      {schedule.loading && !data ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : schedule.error ? (
        <Msg text={schedule.error} />
      ) : !data || data.courts.length === 0 ? (
        <EmptyState
          title="No courts to schedule"
          hint="Add courts in the Courts tab to see their day schedule here."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                  Court
                </th>
                {columns.map((c) => (
                  <th
                    key={c.start}
                    className="min-w-[3.5rem] px-1 py-2 text-center text-[11px] font-medium text-muted-foreground"
                  >
                    {hourLabel(c.start)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.courts.map((court) => (
                <tr key={court.id} className="border-t border-border">
                  <td className="sticky left-0 z-10 bg-card px-3 py-2 font-medium text-foreground">
                    {court.name}
                  </td>
                  {court.slots.map((slot) => {
                    const cellId = `${court.id}|${slot.start}`;
                    const busy = busyCell === cellId;
                    return (
                      <td key={slot.start} className="p-0.5">
                        <ScheduleCell
                          slot={slot}
                          busy={busy}
                          label={`${court.name} ${hourLabel(slot.start)}`}
                          onClick={() => {
                            if (slot.status === 'free') act(court.id, slot, 'block');
                            else if (slot.status === 'blocked')
                              act(court.id, slot, 'unblock');
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded-[4px] ${className}`} />
      {label}
    </span>
  );
}

function ScheduleCell({
  slot,
  busy,
  label,
  onClick,
}: {
  slot: VenueScheduleSlot;
  busy: boolean;
  label: string;
  onClick: () => void;
}) {
  const base =
    'h-9 w-full rounded-md text-[11px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60';
  const byStatus: Record<VenueScheduleSlot['status'], string> = {
    free: 'bg-muted text-muted-foreground hover:bg-primary/15 hover:text-foreground cursor-pointer',
    booked: 'bg-primary text-primary-foreground cursor-default',
    blocked:
      'bg-destructive/90 text-white hover:bg-destructive cursor-pointer',
  };
  const interactive = slot.status !== 'booked';

  const cell = (
    <button
      type="button"
      aria-label={`${label} — ${slot.status}`}
      disabled={busy || !interactive}
      onClick={onClick}
      className={`${base} ${byStatus[slot.status]}`}
    >
      {busy ? '…' : slot.status === 'booked' ? '●' : slot.status === 'blocked' ? '×' : ''}
    </button>
  );

  if (!interactive) return cell;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{cell}</TooltipTrigger>
      <TooltipContent>
        {slot.status === 'free' ? 'Block this slot' : 'Unblock this slot'}
      </TooltipContent>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */
/* Add-ons — create + list + remove                                    */
/* ------------------------------------------------------------------ */

const ADDON_TYPE_OPTS = Object.values(AddonType).map((t) => ({ value: t, label: t }));

function AddonsTab({
  venueId,
  onMsg,
}: {
  venueId: string;
  onMsg: (m: string) => void;
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
    <Card
      title="Add-ons"
      subtitle="Rentals and extras customers can book alongside a slot."
      topAccent="primary"
    >
      {addons.loading && list.length === 0 ? (
        <Skeleton className="h-10 w-full" />
      ) : addons.error ? (
        <Msg text={addons.error} />
      ) : list.length === 0 ? (
        <EmptyState
          title="No add-ons yet"
          hint="Add rentals or extras, like racket hire or a coaching session, customers can book with a slot."
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {list.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5 text-sm shadow-card"
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

      <div className="mt-5 grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-10 w-full rounded-xl border border-border bg-input-background px-3.5 text-sm outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Type</span>
          <UISelect value={type} onValueChange={(x) => setType(x as AddonType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADDON_TYPE_OPTS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="capitalize">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </UISelect>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Price</span>
          <RateCell value={price} onChange={setPrice} ariaLabel="Add-on price" />
        </label>
        <Button onClick={add} disabled={busy || !name.trim()}>
          <PlusCircle className="h-4 w-4" /> {busy ? 'Adding…' : 'Add'}
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Settings — cancellation, no-show, loyalty, repayment                */
/* ------------------------------------------------------------------ */

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

function SettingsTab({
  venue: v,
  onMsg,
}: {
  venue: VenueDetail;
  onMsg: (m: string) => void;
}) {
  const settings = useLoad<VenueSettings>(() => api.getVenueSettings(v.id), [v.id]);

  const [cancellationTemplate, setCancellationTemplate] =
    useState<'flexible' | 'moderate' | 'strict'>('flexible');
  const [noShowFee, setNoShowFee] = useState('0');
  const [loyaltyEarnRate, setLoyaltyEarnRate] = useState('');
  const [loyaltyRedeemValue, setLoyaltyRedeemValue] = useState('');
  const [openMatchRepaymentMode, setOpenMatchRepaymentMode] =
    useState<OpenMatchRepaymentMode>(OpenMatchRepaymentMode.INFO);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  // Seed the form once settings land (mirrors useLoad's one-shot pattern).
  const s = settings.data;
  if (s && !loaded) {
    setLoaded(true);
    setCancellationTemplate(s.cancellationTemplate);
    setNoShowFee(String(s.noShowFee ?? 0));
    setLoyaltyEarnRate(s.loyaltyEarnRate == null ? '' : String(s.loyaltyEarnRate));
    setLoyaltyRedeemValue(s.loyaltyRedeemValue == null ? '' : String(s.loyaltyRedeemValue));
    setOpenMatchRepaymentMode(s.openMatchRepaymentMode);
  }

  const tpl = CANCELLATION_TEMPLATES[cancellationTemplate];

  const save = async () => {
    onMsg('');
    setBusy(true);
    try {
      const earn = loyaltyEarnRate.trim();
      const redeem = loyaltyRedeemValue.trim();
      await api.updateVenueSettings(v.id, {
        cancellationTemplate,
        noShowFee: Math.max(0, Number(noShowFee) || 0),
        ...(earn === '' ? {} : { loyaltyEarnRate: Math.max(0, Number(earn) || 0) }),
        ...(redeem === '' ? {} : { loyaltyRedeemValue: Math.max(0, Number(redeem) || 0) }),
        openMatchRepaymentMode,
      });
      onMsg(`Settings saved for "${v.name}".`);
    } catch (e) {
      onMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (settings.loading && !s) {
    return (
      <Card topAccent="primary">
        <Skeleton className="h-48 w-full" />
      </Card>
    );
  }

  if (settings.error) {
    return (
      <Card topAccent="primary">
        <Msg text={settings.error} />
      </Card>
    );
  }

  return (
    <Card
      title="Policies & settings"
      subtitle="Cancellation, no-show fee, loyalty overrides and open-match repayment for this ground."
      topAccent="primary"
    >
      <div className="max-w-xl space-y-1">
        <Select
          label="Cancellation template"
          value={cancellationTemplate}
          onChange={(x) => setCancellationTemplate(x as 'flexible' | 'moderate' | 'strict')}
          options={CANCELLATION_OPTS}
        />
        <p className="-mt-2 mb-3 text-xs text-muted-foreground">
          Free cancellation up to {tpl.freeWindowHours}h before start; inside that window a{' '}
          {tpl.penaltyPct}% penalty applies.
        </p>

        <Field
          label="No-show fee (₹)"
          type="number"
          value={noShowFee}
          onChange={setNoShowFee}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

      <div className="mt-4 border-t border-border pt-4">
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </Card>
  );
}
