import { PackExpiryMode, PackPricingMode } from '@sportsbooking/shared';
import { ReactNode, useState } from 'react';
import {
  CalendarClock,
  Layers,
  MoreVertical,
  Pencil,
  Plus,
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
  expiryMode: PackExpiryMode;
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

/** Owner: membership session packs (PRD §4.4). */
export function PacksPage() {
  const packs = useLoad(() => api.listPacks());
  const [draft, setDraft] = useState<PackDraft>({
    name: '',
    sessions: 10,
    price: 5000,
    pricingMode: PackPricingMode.FLAT,
    discountPct: 20,
    expiryMode: PackExpiryMode.NONE,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Pack | null>(null);

  const set = <K extends keyof PackDraft>(key: K, value: PackDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const create = async () => {
    setMsg(null);
    if (!draft.name.trim()) {
      setMsg('Give the pack a name so members can recognise it.');
      return;
    }
    setBusy(true);
    try {
      await api.createPack({
        name: draft.name.trim(),
        sessions: draft.sessions,
        price: draft.price,
        pricingMode: draft.pricingMode,
        discountPct:
          draft.pricingMode === PackPricingMode.DISCOUNT ? draft.discountPct : undefined,
        expiryMode: draft.expiryMode,
      });
      setMsg('Pack created.');
      setDraft((d) => ({ ...d, name: '' }));
      packs.reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

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

  const list = packs.data ?? [];
  const avgPerSession =
    list.length > 0
      ? list.reduce((sum, p) => {
          const s = Number(p.sessions);
          return s > 0 ? sum + Number(p.price) / s : sum;
        }, 0) / list.length
      : 0;

  const discount = draft.pricingMode === PackPricingMode.DISCOUNT;

  return (
    <div className="container">
      <PageHeader
        title="Packs"
        subtitle="Bundle sessions into prepaid memberships your members buy up front."
        badge={
          list.length > 0 ? (
            <StatusPill status="active">{`${list.length} live`}</StatusPill>
          ) : undefined
        }
      />

      {/* Create form — grouped into Basics / Pricing / Validity for clear hierarchy. */}
      <Card
        title="New pack"
        subtitle="Set how many sessions members get and what they pay."
        topAccent="primary"
      >
        <div className="space-y-6">
          <section className="space-y-3">
            <SectionLabel icon={Ticket}>Basics</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Pack name
                </span>
                <input
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
            </div>
          </section>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-border-faint pt-4">
          <Msg text={msg} />
          <Button onClick={create} disabled={busy}>
            <Plus className="h-4 w-4" />
            {busy ? 'Creating…' : 'Create pack'}
          </Button>
        </div>
      </Card>

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
            hint="Create your first pack above to start selling prepaid session bundles."
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="text-muted-foreground">
              <span className="font-display font-semibold text-foreground tabular-nums">
                {list.length}
              </span>{' '}
              live {list.length === 1 ? 'pack' : 'packs'}
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
              />
            ))}
          </div>
        </>
      )}

      <EditPackDialog
        pack={editing}
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
}: {
  pack: Pack;
  onEdit: () => void;
  onDeactivate: () => void;
}) {
  const price = Number(pack.price);
  const sessions = Number(pack.sessions);
  const isDiscount = pack.pricingMode === PackPricingMode.DISCOUNT;
  const pct = pack.discountPct == null ? null : Number(pack.discountPct);
  const regular = isDiscount && pct ? price / (1 - pct / 100) : null;

  return (
    <section className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-shadow hover:shadow-lg hover:shadow-black/[0.04]">
      <span className="absolute inset-x-0 top-0 h-1 bg-primary" />

      {/* Header: name + actions */}
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Ticket className="h-[18px] w-[18px]" />
          </span>
          <h3 className="font-display font-semibold text-base leading-tight truncate">
            {pack.name}
          </h3>
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
            <DropdownMenuItem variant="destructive" onSelect={onDeactivate}>
              <Trash2 className="h-4 w-4" />
              Deactivate
            </DropdownMenuItem>
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
  onClose,
  onSaved,
}: {
  pack: Pack | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  if (!pack) return null;
  return <EditPackForm key={pack.id} pack={pack} onClose={onClose} onSaved={onSaved} />;
}

function EditPackForm({
  pack,
  onClose,
  onSaved,
}: {
  pack: Pack;
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
  const [expiryMode, setExpiryMode] = useState<PackExpiryMode>(asExpiryMode(pack.expiryMode));
  // Pack is live while listed; toggling off deactivates it (the only API path).
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const discount = pricingMode === PackPricingMode.DISCOUNT;

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      if (!active) {
        if (
          !window.confirm(
            `Deactivate "${pack.name}"? It will no longer be available for purchase.`,
          )
        ) {
          setBusy(false);
          return;
        }
        await api.deactivatePack(pack.id);
        onSaved('Pack deactivated.');
        return;
      }
      await api.updatePack(pack.id, {
        name: name.trim(),
        sessions,
        price,
        pricingMode,
        discountPct: discount ? discountPct : undefined,
        expiryMode,
      });
      onSaved('Pack updated.');
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
            <Select
              label="When sessions expire"
              value={expiryMode}
              onChange={(x) => setExpiryMode(asExpiryMode(x))}
              options={Object.values(PackExpiryMode).map((m) => ({
                value: m,
                label: EXPIRY_LABEL[m],
              }))}
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
