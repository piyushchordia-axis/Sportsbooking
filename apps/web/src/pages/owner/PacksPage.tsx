import { PackExpiryMode, PackPricingMode } from '@sportsbooking/shared';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Check,
  ChevronDown,
  Layers,
  MapPin,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Tag,
  Ticket,
  Trash2,
} from 'lucide-react';
import { api, type Pack } from '../../api/client';
import {
  Card,
  EmptyState,
  Msg,
  PageHeader,
  SectionLabel,
  Select,
  StatusPill,
  useLoad,
} from '../../components/common';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Switch } from '../../components/ui/switch';
import { Skeleton } from '../../components/ui/skeleton';
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../components/ui/popover';
import { cn } from '../../components/ui/utils';

/** Owner venue (with its courts) as returned by GET /venues, for pack scoping. */
interface ScopeVenue {
  id: string;
  name: string;
  units?: { id: string; name: string; label: string }[];
}

/** A pick-list option for the scope multi-selects. */
interface ScopeOption {
  id: string;
  name: string;
}

/** Checkbox-list popover for picking a set of venues or courts (multi-select). */
function MultiSelect({
  label,
  hint,
  placeholder,
  icon: Icon,
  options,
  selected,
  onChange,
  loading,
}: {
  label: string;
  hint?: string;
  placeholder: string;
  icon: typeof MapPin;
  options: ScopeOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const shown = query.trim()
    ? options.filter((o) =>
        o.name.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : options;
  const toggle = (id: string) =>
    onChange(
      selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id],
    );

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === options.length && options.length > 0
        ? `All ${label.toLowerCase()}`
        : `${selected.length} selected`;

  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted-foreground mb-1.5">
        {label}
      </span>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery('');
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            className={cn(
              'h-10 w-full justify-between rounded-xl px-3.5 font-normal',
              selected.length === 0 && 'text-muted-foreground',
            )}
          >
            <span className="flex items-center gap-2 truncate">
              <Icon className="size-4 opacity-60" />
              <span className="truncate">{loading ? 'Loading…' : summary}</span>
            </span>
            <ChevronDown className="size-4 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1.5">
          {options.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              Nothing to choose yet.
            </p>
          ) : (
            <>
              <div className="relative mb-1">
                <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${label.toLowerCase()}…`}
                  className="h-9 w-full rounded-lg border border-border bg-input-background pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-primary/50"
                />
              </div>
              <div className="max-h-60 overflow-y-auto">
                <button
                  type="button"
                  onClick={() =>
                    onChange(
                      selected.length === options.length
                        ? []
                        : options.map((o) => o.id),
                    )
                  }
                  className="mb-1 w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-primary hover:bg-muted"
                >
                  {selected.length === options.length ? 'Clear all' : 'Select all'}
                </button>
                {shown.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-muted-foreground">
                    No matches.
                  </p>
                ) : (
                  shown.map((o) => {
                    const on = selected.includes(o.id);
                    return (
                      <button
                        type="button"
                        key={o.id}
                        onClick={() => toggle(o.id)}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
                      >
                        <span
                          className={cn(
                            'grid size-4 shrink-0 place-items-center rounded border',
                            on
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border',
                          )}
                        >
                          {on && <Check className="size-3" />}
                        </span>
                        <span className="truncate">{o.name}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </label>
  );
}

const asPricingMode = (v: string): PackPricingMode =>
  Object.values(PackPricingMode).includes(v as PackPricingMode)
    ? (v as PackPricingMode)
    : PackPricingMode.FLAT;

const asExpiryMode = (v: string): PackExpiryMode =>
  Object.values(PackExpiryMode).includes(v as PackExpiryMode)
    ? (v as PackExpiryMode)
    : PackExpiryMode.NONE;

/** End-user labels for the pricing/expiry enums (PRD §4.4). */
const PRICING_LABEL: Record<string, string> = {
  [PackPricingMode.FLAT]: 'Flat price',
  [PackPricingMode.DISCOUNT]: 'Discounted bundle',
};
const EXPIRY_LABEL: Record<string, string> = {
  [PackExpiryMode.NONE]: 'Never expires',
  [PackExpiryMode.ROLLOVER]: 'Rolls over',
  [PackExpiryMode.FORFEIT]: 'Forfeit on expiry',
};

const inr = (n: number) =>
  '₹' + Math.round(n).toLocaleString('en-IN');

/** Per-session value — the number owners actually reason about when pricing. */
function perSession(price: number, sessions: number): string {
  if (!sessions || sessions <= 0) return '—';
  return inr(price / sessions);
}

/** Form shape shared by the create form and the edit dialog. */
interface PackDraft {
  name: string;
  sessions: number;
  price: number;
  pricingMode: PackPricingMode;
  discountPct: number;
  /** Per-session rate/cap, used when pricingMode = flat. */
  flatRate: number;
  expiryMode: PackExpiryMode;
  /** Days from purchase before sessions expire (0 = no window). */
  validityDays: number;
  /** Venue scope; empty = all venues. */
  venueIds: string[];
  /** Court scope; empty = all courts. */
  unitIds: string[];
  /** Available for purchase. */
  active: boolean;
}

/** Number field with a unit affix + stepper, replacing free-text numeric inputs. */
function NumberField({
  label,
  value,
  onChange,
  min = 0,
  step = 1,
  prefix,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  hint?: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</span>
      <div className="relative flex items-center">
        {prefix && (
          <span className="pointer-events-none absolute left-3.5 text-sm text-muted-foreground">
            {prefix}
          </span>
        )}
        <input
          type="number"
          inputMode="numeric"
          min={min}
          step={step}
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          className={`flex h-10 w-full min-w-0 rounded-xl border border-border bg-input-background py-1 text-sm text-foreground tabular-nums transition-[color,box-shadow] outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 ${
            prefix ? 'pl-8' : 'pl-3.5'
          } ${suffix ? 'pr-12' : 'pr-3.5'}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3.5 text-xs font-medium text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </label>
  );
}

/**
 * FORFEIT packs need a positive validity window or expiry never fires
 * (isPackExpired() short-circuits when validityDays is null). Returns an error
 * string, or null when the validity is acceptable for the chosen expiry mode.
 */
function validateValidity(
  expiryMode: PackExpiryMode,
  validityDays: number,
): string | null {
  if (
    expiryMode === PackExpiryMode.FORFEIT &&
    (!Number.isInteger(validityDays) || validityDays <= 0)
  ) {
    return 'Forfeit packs need a validity of at least 1 day before sessions expire.';
  }
  return null;
}

const EMPTY_DRAFT: PackDraft = {
  name: '',
  sessions: 10,
  price: 5000,
  pricingMode: PackPricingMode.FLAT,
  discountPct: 20,
  flatRate: 0,
  expiryMode: PackExpiryMode.NONE,
  validityDays: 0,
  venueIds: [],
  unitIds: [],
  active: true,
};

/** Owner: membership session packs (PRD §4.4). */
export function PacksPage() {
  const packs = useLoad(() => api.listPacks());
  const venues = useLoad(() => api.listVenues() as Promise<ScopeVenue[]>);
  const [msg, setMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Pack | null>(null);

  const venueList = useMemo(() => venues.data ?? [], [venues.data]);
  // Venue options for the scope picker.
  const venueOpts = useMemo<ScopeOption[]>(
    () => venueList.map((v) => ({ id: v.id, name: v.name })),
    [venueList],
  );
  // Court options, labelled with their venue so duplicate court names stay clear.
  const unitOpts = useMemo<ScopeOption[]>(
    () =>
      venueList.flatMap((v) =>
        (v.units ?? []).map((u) => ({
          id: u.id,
          name: `${v.name} · ${u.name}`,
        })),
      ),
    [venueList],
  );

  const deactivate = async (p: Pack) => {
    if (!window.confirm(`Deactivate "${p.name}"? It will no longer be available for purchase.`)) {
      return;
    }
    setMsg(null);
    try {
      await api.deactivatePack(p.id);
      setMsg('Pack deactivated.');
      packs.reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const reactivate = async (p: Pack) => {
    setMsg(null);
    try {
      await api.updatePack(p.id, { active: true });
      setMsg('Pack reactivated.');
      packs.reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const list = packs.data ?? [];
  const activeCount = list.filter((p) => p.active ?? true).length;
  const avgPerSession =
    list.length > 0
      ? list.reduce((sum, p) => {
          const s = Number(p.sessions);
          return s > 0 ? sum + Number(p.price) / s : sum;
        }, 0) / list.length
      : 0;

  return (
    <div className="container">
      <PageHeader
        title="Packs"
        subtitle="Bundle sessions into prepaid memberships your members buy up front."
        badge={
          list.length > 0 ? (
            <StatusPill status="active">
              {`${activeCount} live${
                list.length > activeCount ? ` · ${list.length - activeCount} inactive` : ''
              }`}
            </StatusPill>
          ) : undefined
        }
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New pack
          </Button>
        }
      />

      {msg && (
        <div className="mb-4">
          <Msg text={msg} />
        </div>
      )}

      {/* Live packs */}
      {packs.loading && list.length === 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-52 rounded-2xl" />
          ))}
        </div>
      ) : packs.error ? (
        <Card>
          <Msg text={packs.error} />
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            title="No packs yet"
            hint="Use “New pack” above to start selling prepaid session bundles."
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="text-muted-foreground">
              <span className="font-display font-semibold text-foreground tabular-nums">
                {list.length}
              </span>{' '}
              {list.length === 1 ? 'pack' : 'packs'} total
            </span>
            <span className="text-muted-foreground">
              avg{' '}
              <span className="font-medium text-foreground tabular-nums">
                {inr(avgPerSession)}
              </span>{' '}
              / session
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((p) => (
              <PackTicket
                key={p.id}
                pack={p}
                onEdit={() => setEditing(p)}
                onDeactivate={() => deactivate(p)}
                onReactivate={() => reactivate(p)}
              />
            ))}
          </div>
        </>
      )}

      <CreatePackDialog
        open={creating}
        venueOpts={venueOpts}
        unitOpts={unitOpts}
        scopeLoading={venues.loading}
        onClose={() => setCreating(false)}
        onSaved={(text) => {
          setCreating(false);
          setMsg(text);
          packs.reload();
        }}
      />

      <EditPackDialog
        pack={editing}
        venueOpts={venueOpts}
        unitOpts={unitOpts}
        scopeLoading={venues.loading}
        onClose={() => setEditing(null)}
        onSaved={(text) => {
          setEditing(null);
          setMsg(text);
          packs.reload();
        }}
      />
    </div>
  );
}

/** Create dialog — mirrors the edit dialog, with the form reset each time it opens. */
function CreatePackDialog({
  open,
  venueOpts,
  unitOpts,
  scopeLoading,
  onClose,
  onSaved,
}: {
  open: boolean;
  venueOpts: ScopeOption[];
  unitOpts: ScopeOption[];
  scopeLoading: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [draft, setDraft] = useState<PackDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fresh form every time the dialog opens.
  useEffect(() => {
    if (open) {
      setDraft(EMPTY_DRAFT);
      setError(null);
    }
  }, [open]);

  const set = <K extends keyof PackDraft>(key: K, value: PackDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const discount = draft.pricingMode === PackPricingMode.DISCOUNT;
  const flat = draft.pricingMode === PackPricingMode.FLAT;
  const forfeit = draft.expiryMode === PackExpiryMode.FORFEIT;

  const create = async () => {
    setError(null);
    if (!draft.name.trim()) {
      setError('Give the pack a name so members can recognise it.');
      return;
    }
    const validityErr = validateValidity(draft.expiryMode, draft.validityDays);
    if (validityErr) {
      setError(validityErr);
      return;
    }
    setBusy(true);
    try {
      await api.createPack({
        name: draft.name.trim(),
        sessions: draft.sessions,
        price: draft.price,
        pricingMode: draft.pricingMode,
        discountPct: discount ? draft.discountPct : undefined,
        flatRate: flat ? draft.flatRate : undefined,
        expiryMode: draft.expiryMode,
        validityDays: draft.validityDays > 0 ? draft.validityDays : undefined,
        venueIds: draft.venueIds,
        unitIds: draft.unitIds,
        active: draft.active,
      });
      onSaved('Pack created.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New pack</DialogTitle>
          <DialogDescription>
            Set how many sessions members get and what they pay.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <section className="space-y-3">
            <SectionLabel icon={Ticket}>Basics</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Pack name
                </span>
                <input
                  autoFocus
                  value={draft.name}
                  placeholder="e.g. 10-Session Saver"
                  onChange={(e) => set('name', e.target.value)}
                  className="flex h-10 w-full min-w-0 rounded-xl border border-border bg-input-background px-3.5 py-1 text-sm text-foreground transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
                />
              </label>
              <NumberField
                label="Sessions included"
                value={draft.sessions}
                onChange={(v) => set('sessions', v)}
                min={1}
                suffix="plays"
              />
            </div>
          </section>

          <section className="space-y-3">
            <SectionLabel icon={Tag}>Pricing</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <NumberField
                label="Price"
                value={draft.price}
                onChange={(v) => set('price', v)}
                min={0}
                step={100}
                prefix="₹"
              />
              <Select
                label="Pricing model"
                value={draft.pricingMode}
                onChange={(x) => set('pricingMode', asPricingMode(x))}
                options={Object.values(PackPricingMode).map((m) => ({
                  value: m,
                  label: PRICING_LABEL[m],
                }))}
              />
              {discount && (
                <NumberField
                  label="Discount off regular"
                  value={draft.discountPct}
                  onChange={(v) => set('discountPct', v)}
                  min={0}
                  step={5}
                  suffix="%"
                />
              )}
              {flat && (
                <NumberField
                  label="Per-session rate"
                  value={draft.flatRate}
                  onChange={(v) => set('flatRate', v)}
                  min={0}
                  step={50}
                  prefix="₹"
                  hint="Caps how much each session covers. Leave 0 for no cap."
                />
              )}
            </div>
            <PricePreview
              price={draft.price}
              sessions={draft.sessions}
              discount={discount ? draft.discountPct : null}
            />
          </section>

          <section className="space-y-3">
            <SectionLabel icon={CalendarClock}>Validity</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Select
                label="When sessions expire"
                value={draft.expiryMode}
                onChange={(x) => set('expiryMode', asExpiryMode(x))}
                options={Object.values(PackExpiryMode).map((m) => ({
                  value: m,
                  label: EXPIRY_LABEL[m],
                }))}
              />
              {draft.expiryMode !== PackExpiryMode.NONE && (
                <NumberField
                  label="Validity"
                  value={draft.validityDays}
                  onChange={(v) => set('validityDays', v)}
                  min={forfeit ? 1 : 0}
                  suffix="days"
                  hint={
                    forfeit
                      ? 'Sessions are forfeited this many days after purchase.'
                      : 'Each purchase resets the clock by this many days.'
                  }
                />
              )}
            </div>
          </section>

          <section className="space-y-3">
            <SectionLabel icon={MapPin}>Where it applies</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <MultiSelect
                label="Venues"
                hint="Limit to specific grounds, or leave empty for all."
                placeholder="All venues"
                icon={MapPin}
                options={venueOpts}
                selected={draft.venueIds}
                onChange={(ids) => set('venueIds', ids)}
                loading={scopeLoading}
              />
              <MultiSelect
                label="Courts"
                hint="Limit to specific courts, or leave empty for all."
                placeholder="All courts"
                icon={Layers}
                options={unitOpts}
                selected={draft.unitIds}
                onChange={(ids) => set('unitIds', ids)}
                loading={scopeLoading}
              />
            </div>
          </section>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-elevated px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Available for purchase</p>
              <p className="text-xs text-muted-foreground">
                Turn off to create the pack without listing it for members yet.
              </p>
            </div>
            <Switch
              checked={draft.active}
              onCheckedChange={(v) => set('active', v)}
              aria-label="Available for purchase"
            />
          </div>
        </div>

        <Msg text={error} />

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy}>
            <Plus className="h-4 w-4" />
            {busy ? 'Creating…' : 'Create pack'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Inline preview: turns the entered numbers into the value owners care about. */
function PricePreview({
  price,
  sessions,
  discount,
}: {
  price: number;
  sessions: number;
  discount: number | null;
}) {
  const regular =
    discount != null && discount > 0 && discount < 100 ? price / (1 - discount / 100) : null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl bg-elevated border border-border-faint px-4 py-3">
      <span className="text-xs text-muted-foreground">Members pay</span>
      <span className="font-display font-bold text-lg text-foreground tabular-nums">
        {inr(price)}
      </span>
      {regular != null && (
        <span className="text-xs text-muted-foreground line-through tabular-nums">
          {inr(regular)}
        </span>
      )}
      <span className="text-xs text-muted-foreground">
        · {perSession(price, sessions)} per session
      </span>
    </div>
  );
}

/** A single pack as a tear-off "ticket" card with clear pricing hierarchy. */
function PackTicket({
  pack,
  onEdit,
  onDeactivate,
  onReactivate,
}: {
  pack: Pack;
  onEdit: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
}) {
  const price = Number(pack.price);
  const sessions = Number(pack.sessions);
  const isDiscount = pack.pricingMode === PackPricingMode.DISCOUNT;
  const pct = pack.discountPct == null ? null : Number(pack.discountPct);
  const regular = isDiscount && pct ? price / (1 - pct / 100) : null;
  const isActive = pack.active ?? true;

  return (
    <section
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-shadow hover:shadow-lg hover:shadow-black/[0.04] ${
        isActive ? '' : 'opacity-70'
      }`}
    >
      <span
        className={`absolute inset-x-0 top-0 h-1 ${isActive ? 'bg-primary' : 'bg-muted-foreground/40'}`}
      />

      {/* Header: name + actions */}
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
              isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
            }`}
          >
            <Ticket className="h-[18px] w-[18px]" />
          </span>
          <h3 className="font-display font-semibold text-base leading-tight truncate">
            {pack.name}
          </h3>
          {!isActive && (
            <Badge variant="outline" className="shrink-0">
              Inactive
            </Badge>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${pack.name}`}>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {isActive ? (
              <DropdownMenuItem variant="destructive" onSelect={onDeactivate}>
                <Trash2 className="h-4 w-4" />
                Deactivate
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={onReactivate}>
                <RotateCcw className="h-4 w-4" />
                Reactivate
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Price hero */}
      <div className="px-5 pt-4">
        <div className="flex items-end gap-2">
          <span className="font-display font-bold text-3xl leading-none text-foreground tabular-nums">
            {inr(price)}
          </span>
          {regular != null && (
            <span className="pb-0.5 text-sm text-muted-foreground line-through tabular-nums">
              {inr(regular)}
            </span>
          )}
          {isDiscount && pct ? (
            <Badge variant="accent" className="mb-0.5 ml-auto">
              -{pct}%
            </Badge>
          ) : null}
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">
            {perSession(price, sessions)}
          </span>{' '}
          per session
        </p>
      </div>

      {/* Perforation */}
      <div className="relative my-4">
        <div className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-background" />
        <div className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-background" />
        <div className="mx-5 border-t border-dashed border-border" />
      </div>

      {/* Footer: terms */}
      <div className="flex items-center gap-4 px-5 pb-5">
        <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium tabular-nums">{sessions}</span>
          <span className="text-muted-foreground">sessions</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarClock className="h-4 w-4" />
          {EXPIRY_LABEL[pack.expiryMode] ?? pack.expiryMode}
        </span>
      </div>
    </section>
  );
}

function EditPackDialog({
  pack,
  venueOpts,
  unitOpts,
  scopeLoading,
  onClose,
  onSaved,
}: {
  pack: Pack | null;
  venueOpts: ScopeOption[];
  unitOpts: ScopeOption[];
  scopeLoading: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  if (!pack) return null;
  return (
    <EditPackForm
      key={pack.id}
      pack={pack}
      venueOpts={venueOpts}
      unitOpts={unitOpts}
      scopeLoading={scopeLoading}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function EditPackForm({
  pack,
  venueOpts,
  unitOpts,
  scopeLoading,
  onClose,
  onSaved,
}: {
  pack: Pack;
  venueOpts: ScopeOption[];
  unitOpts: ScopeOption[];
  scopeLoading: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [name, setName] = useState(pack.name);
  const [sessions, setSessions] = useState(Number(pack.sessions));
  const [price, setPrice] = useState(Number(pack.price));
  const [pricingMode, setPricingMode] = useState<PackPricingMode>(asPricingMode(pack.pricingMode));
  const [discountPct, setDiscountPct] = useState(
    pack.discountPct == null ? 20 : Number(pack.discountPct),
  );
  const [flatRate, setFlatRate] = useState(
    pack.flatRate == null ? 0 : Number(pack.flatRate),
  );
  const [expiryMode, setExpiryMode] = useState<PackExpiryMode>(asExpiryMode(pack.expiryMode));
  const [validityDays, setValidityDays] = useState(
    pack.validityDays == null ? 0 : Number(pack.validityDays),
  );
  const [venueIds, setVenueIds] = useState<string[]>(pack.venueIds ?? []);
  const [unitIds, setUnitIds] = useState<string[]>(pack.unitIds ?? []);
  // Reflects the stored state; toggling persists via updatePack (active flag),
  // so an owner can both deactivate AND re-activate.
  const [active, setActive] = useState(pack.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const discount = pricingMode === PackPricingMode.DISCOUNT;
  const flat = pricingMode === PackPricingMode.FLAT;
  const forfeit = expiryMode === PackExpiryMode.FORFEIT;
  // Deactivating a previously-active pack — confirm before hiding it.
  const deactivating = (pack.active ?? true) && !active;

  const save = async () => {
    setError(null);
    const validityErr = validateValidity(expiryMode, validityDays);
    if (validityErr) {
      setError(validityErr);
      return;
    }
    setBusy(true);
    try {
      if (deactivating) {
        if (
          !window.confirm(
            `Deactivate "${pack.name}"? It will no longer be available for purchase.`,
          )
        ) {
          setBusy(false);
          return;
        }
      }
      await api.updatePack(pack.id, {
        name: name.trim(),
        sessions,
        price,
        pricingMode,
        discountPct: discount ? discountPct : undefined,
        flatRate: flat ? flatRate : undefined,
        expiryMode,
        validityDays: validityDays > 0 ? validityDays : undefined,
        venueIds,
        unitIds,
        active,
      });
      onSaved(active ? 'Pack updated.' : 'Pack deactivated.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit pack</DialogTitle>
          <DialogDescription>Update this pack's sessions, price, and terms.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block sm:col-span-2">
              <span className="block text-xs font-medium text-muted-foreground mb-1.5">
                Pack name
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex h-10 w-full min-w-0 rounded-xl border border-border bg-input-background px-3.5 py-1 text-sm text-foreground transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
              />
            </label>
            <NumberField
              label="Sessions included"
              value={sessions}
              onChange={setSessions}
              min={1}
              suffix="plays"
            />
            <NumberField
              label="Price"
              value={price}
              onChange={setPrice}
              min={0}
              step={100}
              prefix="₹"
            />
            <Select
              label="Pricing model"
              value={pricingMode}
              onChange={(x) => setPricingMode(asPricingMode(x))}
              options={Object.values(PackPricingMode).map((m) => ({
                value: m,
                label: PRICING_LABEL[m],
              }))}
            />
            {discount && (
              <NumberField
                label="Discount off regular"
                value={discountPct}
                onChange={setDiscountPct}
                min={0}
                step={5}
                suffix="%"
              />
            )}
            {flat && (
              <NumberField
                label="Per-session rate"
                value={flatRate}
                onChange={setFlatRate}
                min={0}
                step={50}
                prefix="₹"
                hint="Caps how much each session covers. Leave 0 for no cap."
              />
            )}
            <Select
              label="When sessions expire"
              value={expiryMode}
              onChange={(x) => setExpiryMode(asExpiryMode(x))}
              options={Object.values(PackExpiryMode).map((m) => ({
                value: m,
                label: EXPIRY_LABEL[m],
              }))}
            />
            {expiryMode !== PackExpiryMode.NONE && (
              <NumberField
                label="Validity"
                value={validityDays}
                onChange={setValidityDays}
                min={forfeit ? 1 : 0}
                suffix="days"
                hint={
                  forfeit
                    ? 'Sessions are forfeited this many days after purchase.'
                    : 'Each purchase resets the clock by this many days.'
                }
              />
            )}
            <MultiSelect
              label="Venues"
              hint="Empty = all venues."
              placeholder="All venues"
              icon={MapPin}
              options={venueOpts}
              selected={venueIds}
              onChange={setVenueIds}
              loading={scopeLoading}
            />
            <MultiSelect
              label="Courts"
              hint="Empty = all courts."
              placeholder="All courts"
              icon={Layers}
              options={unitOpts}
              selected={unitIds}
              onChange={setUnitIds}
              loading={scopeLoading}
            />
          </div>

          <PricePreview
            price={price}
            sessions={sessions}
            discount={discount ? discountPct : null}
          />

          <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-elevated px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Available for purchase</p>
              <p className="text-xs text-muted-foreground">
                Turn off to deactivate this pack for new members.
              </p>
            </div>
            <Switch
              checked={active}
              onCheckedChange={setActive}
              aria-label="Available for purchase"
            />
          </div>
        </div>

        <Msg text={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : active ? 'Save changes' : 'Deactivate pack'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
