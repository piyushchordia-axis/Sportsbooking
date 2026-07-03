import { OfferType } from '@sportsbooking/shared';
import { useMemo, useState } from 'react';
import {
  CalendarRange,
  Check,
  ChevronDown,
  MapPin,
  MoreVertical,
  Pencil,
  Percent,
  Plus,
  Power,
  Search,
  ShieldCheck,
  Tag,
  Target,
  Ticket,
  Trash2,
  Users,
} from 'lucide-react';
import { format } from 'date-fns';
import { api } from '../../api/client';
import {
  Card,
  EmptyState,
  Field,
  KeyVal,
  Msg,
  PageHeader,
  SectionLabel,
  Select,
  StatusPill,
  useLoad,
} from '../../components/common';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../components/ui/popover';
import { Separator } from '../../components/ui/separator';
import { Switch } from '../../components/ui/switch';
import { cn } from '../../components/ui/utils';

interface Offer {
  id: string;
  name: string;
  type: OfferType;
  value: string | number;
  code: string | null;
  autoApply: boolean;
  active: boolean;
  validFrom?: string | null;
  validTo?: string | null;
  venueIds?: string[] | null;
  gameIds?: string[] | null;
  segment?: string | null;
  minOrderValue?: string | number | null;
  maxDiscount?: string | number | null;
  usageLimit?: number | null;
  perUserLimit?: number | null;
}

interface NamedRef {
  id: string;
  name: string;
}

/** CRM audiences an offer can target (PRD §4.8). '' = everyone. */
const SEGMENT_OPTIONS = [
  { value: '', label: 'Everyone' },
  { value: 'new', label: 'New players' },
  { value: 'lapsed', label: 'Lapsed players' },
  { value: 'regulars', label: 'Regulars (5+ bookings)' },
  { value: 'members', label: 'Members (pack holders)' },
];

function segmentLabel(value?: string | null): string {
  const hit = SEGMENT_OPTIONS.find((s) => s.value === (value ?? ''));
  return hit?.label ?? value ?? 'Everyone';
}

function toDate(iso?: string | null): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function rangeSummary(from?: string | null, to?: string | null): string {
  const f = toDate(from);
  const t = toDate(to);
  if (!f && !t) return 'Always on';
  if (f && t) return `${format(f, 'LLL d, yyyy')} – ${format(t, 'LLL d, yyyy')}`;
  if (f) return `From ${format(f, 'LLL d, yyyy')}`;
  return `Until ${format(t!, 'LLL d, yyyy')}`;
}

/** Small labelled wrapper so grouped controls share one type rhythm. */
function Labelled({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3', className)}>
      <span className="block text-xs font-medium text-muted-foreground mb-1.5">
        {label}
      </span>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

/** Checkbox-list popover for picking a set of venues or games (multi-select). */
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
  options: NamedRef[];
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
    <Labelled label={label} hint={hint}>
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
    </Labelled>
  );
}

/** Owner: offers & promo codes (PRD §4.8). */
export function OffersPage() {
  const offers = useLoad(() => api.listOffers() as Promise<Offer[]>);
  const venues = useLoad(() => api.listVenues() as Promise<NamedRef[]>);
  const games = useLoad(() => api.listGames() as Promise<NamedRef[]>);

  const venueOpts = venues.data ?? [];
  const gameOpts = games.data ?? [];
  const venueName = useMemo(
    () => new Map(venueOpts.map((v) => [v.id, v.name])),
    [venueOpts],
  );
  const gameName = useMemo(
    () => new Map(gameOpts.map((g) => [g.id, g.name])),
    [gameOpts],
  );

  // Create dialog + form state.
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('Weekend 10% off');
  const [type, setType] = useState<OfferType>(OfferType.PERCENT);
  const [value, setValue] = useState('10');
  const [code, setCode] = useState('WEEKEND10');
  const [autoApply, setAutoApply] = useState(false);
  const [range, setRange] = useState<DateRangeValue>({});
  const [venueIds, setVenueIds] = useState<string[]>([]);
  const [gameIds, setGameIds] = useState<string[]>([]);
  const [segment, setSegment] = useState('');
  const [minOrder, setMinOrder] = useState('');
  const [maxDisc, setMaxDisc] = useState('');
  const [totalLimit, setTotalLimit] = useState('');
  const [userLimit, setUserLimit] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Edit dialog state.
  const [editing, setEditing] = useState<Offer | null>(null);
  const [eName, setEName] = useState('');
  const [eType, setEType] = useState<OfferType>(OfferType.PERCENT);
  const [eValue, setEValue] = useState('');
  const [eCode, setECode] = useState('');
  const [eAutoApply, setEAutoApply] = useState(false);
  const [eRange, setERange] = useState<DateRangeValue>({});
  const [eVenueIds, setEVenueIds] = useState<string[]>([]);
  const [eGameIds, setEGameIds] = useState<string[]>([]);
  const [eSegment, setESegment] = useState('');
  const [eMinOrder, setEMinOrder] = useState('');
  const [eMaxDisc, setEMaxDisc] = useState('');
  const [eTotalLimit, setETotalLimit] = useState('');
  const [eUserLimit, setEUserLimit] = useState('');
  const [editMsg, setEditMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete/deactivate confirm state.
  const [removing, setRemoving] = useState<Offer | null>(null);
  const [removeMsg, setRemoveMsg] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  /**
   * Shared validation: name required, percent clamped to 1–100, flat amount
   * positive, NaN rejected, validity ordered. Returns a clean payload or an
   * error message.
   */
  const validate = (
    n: string,
    t: OfferType,
    v: string,
    r: DateRangeValue,
  ): { ok: true; value: number } | { ok: false; error: string } => {
    if (!n.trim()) return { ok: false, error: 'Enter a name for this offer.' };
    const num = Number(v);
    if (v.trim() === '' || Number.isNaN(num))
      return { ok: false, error: 'Enter a valid discount amount.' };
    if (t === OfferType.PERCENT) {
      if (num < 1 || num > 100)
        return { ok: false, error: 'Percent must be between 1 and 100.' };
    } else if (num <= 0) {
      return { ok: false, error: 'Amount must be greater than zero.' };
    }
    if (r.from && r.to && r.from > r.to)
      return { ok: false, error: 'The end date must come after the start date.' };
    // Clamp percent to a whole, in-range number defensively.
    const clamped =
      t === OfferType.PERCENT ? Math.min(100, Math.max(1, num)) : num;
    return { ok: true, value: clamped };
  };

  // Optional guardrail fields: '' → null (no limit), else a valid value.
  const moneyOrNull = (s: string): number | null => {
    const n = Number(s.trim());
    return s.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
  };
  const limitOrNull = (s: string): number | null => {
    const n = Math.floor(Number(s.trim()));
    return s.trim() !== '' && Number.isFinite(n) && n >= 1 ? n : null;
  };
  // The guardrail slice of the create/update payload. maxDiscount only applies
  // to percentage offers (a flat amount is already its own cap).
  const guardrails = (
    t: OfferType,
    minO: string,
    maxD: string,
    total: string,
    perUser: string,
  ) => ({
    minOrderValue: moneyOrNull(minO),
    maxDiscount: t === OfferType.PERCENT ? moneyOrNull(maxD) : null,
    usageLimit: limitOrNull(total),
    perUserLimit: limitOrNull(perUser),
  });

  // Return the create form to its defaults after a successful create.
  const resetCreate = () => {
    setName('Weekend 10% off');
    setType(OfferType.PERCENT);
    setValue('10');
    setCode('WEEKEND10');
    setAutoApply(false);
    setRange({});
    setVenueIds([]);
    setGameIds([]);
    setSegment('');
    setMinOrder('');
    setMaxDisc('');
    setTotalLimit('');
    setUserLimit('');
    setMsg(null);
  };

  const openCreate = () => {
    resetCreate();
    setCreateOpen(true);
  };

  const create = async () => {
    setMsg(null);
    const v = validate(name, type, value, range);
    if (!v.ok) {
      setMsg(v.error);
      return;
    }
    setCreating(true);
    try {
      await api.createOffer({
        name: name.trim(),
        type,
        value: v.value,
        code: code.trim() || undefined,
        autoApply,
        validFrom: range.from?.toISOString(),
        validTo: range.to?.toISOString(),
        venueIds: venueIds.length ? venueIds : undefined,
        gameIds: gameIds.length ? gameIds : undefined,
        segment: segment || undefined,
        ...guardrails(type, minOrder, maxDisc, totalLimit, userLimit),
      });
      setCreateOpen(false);
      resetCreate();
      offers.reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (o: Offer) => {
    setEditing(o);
    setEName(o.name);
    setEType(o.type);
    setEValue(String(o.value));
    setECode(o.code ?? '');
    setEAutoApply(o.autoApply);
    setERange({ from: toDate(o.validFrom), to: toDate(o.validTo) });
    setEVenueIds(o.venueIds ?? []);
    setEGameIds(o.gameIds ?? []);
    setESegment(o.segment ?? '');
    setEMinOrder(o.minOrderValue != null ? String(o.minOrderValue) : '');
    setEMaxDisc(o.maxDiscount != null ? String(o.maxDiscount) : '');
    setETotalLimit(o.usageLimit != null ? String(o.usageLimit) : '');
    setEUserLimit(o.perUserLimit != null ? String(o.perUserLimit) : '');
    setEditMsg(null);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setEditMsg(null);
    const v = validate(eName, eType, eValue, eRange);
    if (!v.ok) {
      setEditMsg(v.error);
      return;
    }
    setSaving(true);
    try {
      await api.updateOffer(editing.id, {
        name: eName.trim(),
        type: eType,
        value: v.value,
        code: eCode.trim() || undefined,
        autoApply: eAutoApply,
        validFrom: eRange.from?.toISOString(),
        validTo: eRange.to?.toISOString(),
        venueIds: eVenueIds,
        gameIds: eGameIds,
        segment: eSegment || undefined,
        ...guardrails(eType, eMinOrder, eMaxDisc, eTotalLimit, eUserLimit),
      });
      setEditing(null);
      offers.reload();
    } catch (e) {
      setEditMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (o: Offer) => {
    setMsg(null);
    try {
      await api.updateOffer(o.id, { active: !o.active });
      offers.reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  // Hard-delete via confirm dialog; falls back to deactivate if the offer is
  // referenced (backend returns a 400 for that case).
  const confirmRemove = async () => {
    if (!removing) return;
    setRemoveMsg(null);
    setWorking(true);
    try {
      await api.deleteOffer(removing.id, true);
      setRemoving(null);
      offers.reload();
    } catch (e) {
      setRemoveMsg((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const list = offers.data ?? [];
  const activeCount = list.filter((o) => o.active).length;

  const scopeSummary = (o: Offer): string => {
    const vCount = o.venueIds?.length ?? 0;
    const gCount = o.gameIds?.length ?? 0;
    if (!vCount && !gCount) return 'All venues & games';
    const parts: string[] = [];
    if (vCount)
      parts.push(
        vCount === 1
          ? (venueName.get(o.venueIds![0]) ?? '1 venue')
          : `${vCount} venues`,
      );
    if (gCount)
      parts.push(
        gCount === 1
          ? (gameName.get(o.gameIds![0]) ?? '1 game')
          : `${gCount} games`,
      );
    return parts.join(' · ');
  };

  return (
    <div className="container">
      <PageHeader
        title="Offers"
        subtitle="Run promotions and discount codes across your venues."
        badge={<StatusPill status="active">{`${activeCount} active`}</StatusPill>}
        action={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New offer
          </Button>
        }
      />

      {/* Create dialog — same sectioned form, now off the main list. */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            resetCreate();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create an offer</DialogTitle>
            <DialogDescription>
              Set the discount, when it runs, and who can use it.
            </DialogDescription>
          </DialogHeader>

          {/* Section 1 — the deal itself. */}
          <SectionLabel icon={Tag} className="mb-3">
            The deal
          </SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
            <Field label="Name" value={name} onChange={setName} />
            <Select
              label="Discount type"
              value={type}
              onChange={(x) => setType(x as OfferType)}
              options={[
                { value: OfferType.PERCENT, label: 'Percentage off' },
                { value: OfferType.FLAT, label: 'Flat amount off' },
              ]}
            />
            <Field
              label={type === OfferType.PERCENT ? 'Percent (1–100)' : 'Amount ₹'}
              type="number"
              value={value}
              onChange={setValue}
            />
            <Field
              label="Promo code"
              value={code}
              onChange={setCode}
              placeholder="Optional"
            />
          </div>
          <Labelled
            label="Apply automatically"
            hint="On: discount applies at checkout. Off: players must enter the code."
          >
            <label className="flex h-10 w-full items-center gap-3 rounded-xl border border-border bg-input-background px-3.5">
              <Switch checked={autoApply} onCheckedChange={setAutoApply} />
              <span className="text-sm text-foreground">
                {autoApply ? 'Auto-applied at checkout' : 'Players enter the code'}
              </span>
            </label>
          </Labelled>

          <Separator className="my-4" />

          {/* Section 2 — when & where it applies. */}
          <SectionLabel icon={CalendarRange} className="mb-3">
            When &amp; where
          </SectionLabel>
          <Labelled
            label="Validity window"
            hint="Leave empty to keep the offer always on."
          >
            <DateRangePicker
              value={range}
              onChange={setRange}
              placeholder="Always on"
            />
          </Labelled>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
            <MultiSelect
              label="Venues"
              hint="Limit to specific grounds, or leave empty for all."
              placeholder="All venues"
              icon={MapPin}
              options={venueOpts}
              selected={venueIds}
              onChange={setVenueIds}
              loading={venues.loading}
            />
            <MultiSelect
              label="Games"
              hint="Limit to specific sports, or leave empty for all."
              placeholder="All games"
              icon={Tag}
              options={gameOpts}
              selected={gameIds}
              onChange={setGameIds}
              loading={games.loading}
            />
          </div>

          <Separator className="my-4" />

          {/* Section 3 — audience. */}
          <SectionLabel icon={Target} className="mb-3">
            Audience
          </SectionLabel>
          <Select
            label="Who can use it"
            value={segment}
            onChange={setSegment}
            options={SEGMENT_OPTIONS}
          />

          <Separator className="my-4" />

          {/* Section 4 — guardrails. Blank = no limit. */}
          <SectionLabel icon={ShieldCheck} className="mb-3">
            Limits
          </SectionLabel>
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Field
              label="Min order ₹"
              type="number"
              value={minOrder}
              onChange={setMinOrder}
              placeholder="No minimum"
            />
            {type === OfferType.PERCENT && (
              <Field
                label="Max discount ₹"
                type="number"
                value={maxDisc}
                onChange={setMaxDisc}
                placeholder="No cap"
              />
            )}
            <Field
              label="Total uses"
              type="number"
              value={totalLimit}
              onChange={setTotalLimit}
              placeholder="Unlimited"
            />
            <Field
              label="Per player"
              type="number"
              value={userLimit}
              onChange={setUserLimit}
              placeholder="Unlimited · 1 = one-time"
            />
          </div>

          <Msg text={msg} />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false);
                resetCreate();
              }}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button onClick={create} disabled={creating}>
              <Plus className="h-4 w-4" /> {creating ? 'Creating…' : 'Create offer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mb-3 flex items-center justify-between">
        <SectionLabel icon={Tag}>All offers</SectionLabel>
      </div>

      {offers.error ? (
        <Card>
          <Msg text={offers.error} />
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            title="No offers yet"
            hint="Create your first promotion to start offering discounts to players."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((o) => (
            <Card
              key={o.id}
              topAccent={!o.active ? 'destructive' : o.autoApply ? 'emerald' : 'blue'}
              className={o.active ? undefined : 'opacity-75'}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
                    {o.type === OfferType.PERCENT ? (
                      <Percent className="h-[18px] w-[18px]" />
                    ) : (
                      <Ticket className="h-[18px] w-[18px]" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-display font-semibold text-base leading-tight truncate">
                      {o.name}
                    </h3>
                    <p className="font-display font-bold text-lg leading-tight text-primary">
                      {o.type === OfferType.PERCENT ? `${o.value}% off` : `₹${o.value} off`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <StatusPill status={!o.active ? 'inactive' : o.autoApply ? 'active' : 'open'}>
                    {!o.active ? 'Inactive' : o.autoApply ? 'Auto' : 'Code'}
                  </StatusPill>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Offer actions">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => openEdit(o)}>
                        <Pencil className="h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => toggleActive(o)}>
                        <Power className="h-4 w-4" /> {o.active ? 'Deactivate' : 'Reactivate'}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(o)}>
                        <Trash2 className="h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="mb-3 flex flex-wrap gap-1.5">
                {o.code && <Badge variant="secondary">{o.code}</Badge>}
                <Badge variant="outline">
                  <CalendarRange className="size-3" />
                  {rangeSummary(o.validFrom, o.validTo)}
                </Badge>
                {o.segment ? (
                  <Badge variant="accent">
                    <Users className="size-3" />
                    {segmentLabel(o.segment)}
                  </Badge>
                ) : null}
              </div>

              <div className="rounded-xl border border-border bg-elevated/40 px-3.5 py-1">
                <KeyVal label="Apply" value={o.autoApply ? 'Automatic' : 'On code entry'} />
                <KeyVal label="Scope" value={scopeSummary(o)} />
                <KeyVal label="Audience" value={segmentLabel(o.segment)} />
              </div>

              {o.active && (
                <Button
                  variant="outline"
                  className="mt-3 w-full"
                  onClick={() => toggleActive(o)}
                >
                  <Power className="h-4 w-4" /> Deactivate
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Edit dialog (pre-filled). */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit offer</DialogTitle>
            <DialogDescription>
              Update the discount, validity window, scope, and audience.
            </DialogDescription>
          </DialogHeader>

          <SectionLabel icon={Tag} className="mb-3">
            The deal
          </SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
            <Field label="Name" value={eName} onChange={setEName} />
            <Select
              label="Discount type"
              value={eType}
              onChange={(x) => setEType(x as OfferType)}
              options={[
                { value: OfferType.PERCENT, label: 'Percentage off' },
                { value: OfferType.FLAT, label: 'Flat amount off' },
              ]}
            />
            <Field
              label={eType === OfferType.PERCENT ? 'Percent (1–100)' : 'Amount ₹'}
              type="number"
              value={eValue}
              onChange={setEValue}
            />
            <Field
              label="Promo code"
              value={eCode}
              onChange={setECode}
              placeholder="Optional"
            />
          </div>
          <Labelled label="Apply automatically">
            <label className="flex h-10 w-full items-center gap-3 rounded-xl border border-border bg-input-background px-3.5">
              <Switch checked={eAutoApply} onCheckedChange={setEAutoApply} />
              <span className="text-sm text-foreground">
                {eAutoApply ? 'Auto-applied at checkout' : 'Players enter the code'}
              </span>
            </label>
          </Labelled>

          <Separator className="my-4" />

          <SectionLabel icon={CalendarRange} className="mb-3">
            When &amp; where
          </SectionLabel>
          <Labelled label="Validity window" hint="Leave empty to keep it always on.">
            <DateRangePicker
              value={eRange}
              onChange={setERange}
              placeholder="Always on"
            />
          </Labelled>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
            <MultiSelect
              label="Venues"
              placeholder="All venues"
              icon={MapPin}
              options={venueOpts}
              selected={eVenueIds}
              onChange={setEVenueIds}
              loading={venues.loading}
            />
            <MultiSelect
              label="Games"
              placeholder="All games"
              icon={Tag}
              options={gameOpts}
              selected={eGameIds}
              onChange={setEGameIds}
              loading={games.loading}
            />
          </div>

          <Separator className="my-4" />

          <SectionLabel icon={Target} className="mb-3">
            Audience
          </SectionLabel>
          <Select
            label="Who can use it"
            value={eSegment}
            onChange={setESegment}
            options={SEGMENT_OPTIONS}
          />

          <Separator className="my-4" />

          <SectionLabel icon={ShieldCheck} className="mb-3">
            Limits
          </SectionLabel>
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Field
              label="Min order ₹"
              type="number"
              value={eMinOrder}
              onChange={setEMinOrder}
              placeholder="No minimum"
            />
            {eType === OfferType.PERCENT && (
              <Field
                label="Max discount ₹"
                type="number"
                value={eMaxDisc}
                onChange={setEMaxDisc}
                placeholder="No cap"
              />
            )}
            <Field
              label="Total uses"
              type="number"
              value={eTotalLimit}
              onChange={setETotalLimit}
              placeholder="Unlimited"
            />
            <Field
              label="Per player"
              type="number"
              value={eUserLimit}
              onChange={setEUserLimit}
              placeholder="Unlimited · 1 = one-time"
            />
          </div>

          <Msg text={editMsg} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog. */}
      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete offer</DialogTitle>
            <DialogDescription>
              {removing
                ? `Permanently delete "${removing.name}"? If it has already been used on a booking it will be deactivated instead to keep history intact.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <Msg text={removeMsg} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmRemove} disabled={working}>
              {working ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
