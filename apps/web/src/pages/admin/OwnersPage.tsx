import { FeatureFlag } from '@sportsbooking/shared';
import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  Award,
  Building2,
  CalendarClock,
  CalendarIcon,
  Gamepad2,
  Mail,
  Minus,
  Palette,
  Plus,
  Receipt,
  RefreshCw,
  SlidersHorizontal,
  UserPlus,
  Users,
} from 'lucide-react';
import { api, type UpdateOwnerInput } from '../../api/client';
import {
  Card,
  EmptyState,
  Field,
  Msg,
  OwnerLogo,
  PageHeader,
  SectionLabel,
  Stat,
  StatusPill,
  useLoad,
} from '../../components/common';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Calendar } from '../../components/ui/calendar';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { Switch } from '../../components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';

/* ----------------------------------------------------------------------------
 * Shared shapes & helpers
 * ------------------------------------------------------------------------- */

/** Owner row as returned by GET /super-admin/owners. */
interface OwnerRow {
  id: string;
  name: string;
  status: string;
  contactEmail: string | null;
  logoUrl: string | null;
  venueQuota: number;
  venueCount: number;
  allowedGameIds: string[];
  featureFlags: string[];
  amcRenewalDate: string | null;
  amcOverdue: boolean;
}

interface GameOption {
  id: string;
  name: string;
}

/** Human label for each feature flag, end-user vocabulary. */
const FEATURE_LABELS: Record<FeatureFlag, { title: string; hint: string }> = {
  [FeatureFlag.TOURNAMENTS]: { title: 'Tournaments', hint: 'Run paid bracket events.' },
  [FeatureFlag.MEMBERSHIPS]: { title: 'Memberships', hint: 'Sell session packs.' },
  [FeatureFlag.LOYALTY]: { title: 'Loyalty', hint: 'Earn and redeem points.' },
  [FeatureFlag.OPEN_MATCHES]: { title: 'Open matches', hint: 'Let players fill empty spots.' },
  [FeatureFlag.ADDONS]: { title: 'Add-ons', hint: 'Sell gear and refreshments.' },
};

const ALL_FLAGS = Object.values(FeatureFlag);

/** Format an ISO/date string to a short readable date; falls back to the raw value. */
function fmtDate(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Parse a number input safely; empty → undefined so we can omit it from a patch. */
function numOrUndef(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/* ----------------------------------------------------------------------------
 * Controls
 * ------------------------------------------------------------------------- */

/** Number input with stepper buttons — for counts and currency amounts. */
function NumberField({
  label,
  value,
  onChange,
  min = 0,
  step = 1,
  prefix,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  step?: number;
  prefix?: string;
  hint?: string;
}) {
  const bump = (dir: 1 | -1) => {
    const n = Number(value) || 0;
    const next = Math.max(min, n + dir * step);
    onChange(String(next));
  };
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</span>
      <span className="flex h-10 items-stretch overflow-hidden rounded-xl border border-border bg-input-background focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
        <button
          type="button"
          onClick={() => bump(-1)}
          aria-label={`Decrease ${label.toLowerCase()}`}
          className="grid w-9 shrink-0 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-none"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="flex min-w-0 flex-1 items-center border-x border-border px-2.5">
          {prefix && <span className="mr-1 text-sm text-muted-foreground">{prefix}</span>}
          <input
            type="number"
            inputMode="numeric"
            min={min}
            step={step}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full min-w-0 bg-transparent text-sm tabular-nums text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </span>
        <button
          type="button"
          onClick={() => bump(1)}
          aria-label={`Increase ${label.toLowerCase()}`}
          className="grid w-9 shrink-0 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-none"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </span>
      {hint && <span className="mt-1.5 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Single-date picker (Popover + Calendar) for the AMC renewal date. */
function DateField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value?: Date;
  onChange: (d: Date | undefined) => void;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={`h-10 w-full justify-start rounded-xl px-3.5 font-normal ${
              value ? '' : 'text-muted-foreground'
            }`}
          >
            <CalendarIcon className="size-4 opacity-60" />
            <span className="truncate">{value ? format(value, 'LLL d, yyyy') : 'Pick a date'}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <Calendar
            mode="single"
            defaultMonth={value}
            selected={value}
            onSelect={(d) => {
              onChange(d ?? undefined);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {hint && <span className="mt-1.5 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Brand-colour input: a native colour swatch paired with its hex value. */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</span>
      <span className="flex h-10 items-center gap-2 rounded-xl border border-border bg-input-background px-2.5">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
          aria-label={`${label} colour`}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full min-w-0 bg-transparent text-sm text-foreground outline-none"
        />
      </span>
    </label>
  );
}

/** A single feature flag as a labelled Switch row. */
function FeatureToggle({
  flag,
  enabled,
  onToggle,
}: {
  flag: FeatureFlag;
  enabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  const meta = FEATURE_LABELS[flag];
  const id = `flag-${flag}`;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-elevated px-3.5 py-2.5">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium text-foreground">{meta.title}</span>
        <span className="block text-[11px] text-muted-foreground">{meta.hint}</span>
      </label>
      <Switch id={id} checked={enabled} onCheckedChange={onToggle} />
    </div>
  );
}

/** Game multi-select: a scrollable list of checkable chips. */
function GamePicker({
  games,
  selected,
  onToggle,
}: {
  games: GameOption[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (games.length === 0) {
    return <p className="text-xs text-muted-foreground">No games in the catalogue yet.</p>;
  }
  return (
    <div className="grid max-h-44 grid-cols-1 gap-1 overflow-auto rounded-xl border border-border bg-elevated p-2 sm:grid-cols-2">
      {games.map((g) => {
        const checked = selected.includes(g.id);
        return (
          <label
            key={g.id}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(g.id)}
              className="h-4 w-4 shrink-0 rounded border-border accent-[var(--primary)]"
            />
            <span className="truncate">{g.name}</span>
          </label>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Edit owner dialog (FE-2)
 * ------------------------------------------------------------------------- */

function EditOwnerDialog({
  owner,
  games,
  onClose,
  onSaved,
}: {
  owner: OwnerRow;
  games: GameOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [quota, setQuota] = useState(String(owner.venueQuota));
  const [gameIds, setGameIds] = useState<string[]>(owner.allowedGameIds);
  const [flags, setFlags] = useState<string[]>(owner.featureFlags);
  const [setupFee, setSetupFee] = useState('');
  const [amcAmount, setAmcAmount] = useState('');
  const [renewal, setRenewal] = useState<Date | undefined>(
    owner.amcRenewalDate ? new Date(owner.amcRenewalDate) : undefined,
  );
  const [logoUrl, setLogoUrl] = useState(owner.logoUrl ?? '');
  const [primaryColor, setPrimaryColor] = useState('#16a34a');
  const [secondaryColor, setSecondaryColor] = useState('#0f172a');
  const [accentColor, setAccentColor] = useState('#f59e0b');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const toggleGame = (id: string) =>
    setGameIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  const toggleFlag = (flag: FeatureFlag, next: boolean) =>
    setFlags((prev) => (next ? [...new Set([...prev, flag])] : prev.filter((f) => f !== flag)));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const patch: UpdateOwnerInput = {
        venueQuota: Number(quota),
        allowedGameIds: gameIds,
        featureFlags: flags,
        branding: {
          logoUrl: logoUrl || undefined,
          primaryColor,
          secondaryColor,
          accentColor,
        },
      };
      const fee = numOrUndef(setupFee);
      const amc = numOrUndef(amcAmount);
      if (fee !== undefined) patch.setupFee = fee;
      if (amc !== undefined) patch.amcAmount = amc;
      // Always send the renewal date (null clears it) since the dialog prefills it.
      patch.amcRenewalDate = renewal ? renewal.toISOString() : null;

      await api.updateOwner(owner.id, patch);
      onSaved();
      onClose();
    } catch (e) {
      setMsg((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit {owner.name}</DialogTitle>
          <DialogDescription>
            Update entitlements and billing. Leave a commercial field blank to keep its current
            value.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Entitlements */}
          <section>
            <SectionLabel icon={SlidersHorizontal} className="mb-3">
              Entitlements
            </SectionLabel>
            <NumberField
              label="Venue quota"
              value={quota}
              onChange={setQuota}
              min={1}
              hint={`Currently using ${owner.venueCount} of ${owner.venueQuota}.`}
            />
            <p className="mb-2 mt-4 text-xs font-medium text-muted-foreground">Allowed games</p>
            <GamePicker games={games} selected={gameIds} onToggle={toggleGame} />
          </section>

          {/* Feature flags */}
          <section>
            <SectionLabel icon={Award} className="mb-3">
              Features
            </SectionLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              {ALL_FLAGS.map((flag) => (
                <FeatureToggle
                  key={flag}
                  flag={flag}
                  enabled={flags.includes(flag)}
                  onToggle={(next) => toggleFlag(flag, next)}
                />
              ))}
            </div>
          </section>

          {/* Commercial terms */}
          <section>
            <SectionLabel icon={Receipt} className="mb-3">
              AMC &amp; commercial terms
            </SectionLabel>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label="Setup fee"
                value={setupFee}
                onChange={setSetupFee}
                step={500}
                prefix="₹"
                hint="One-time onboarding charge."
              />
              <NumberField
                label="AMC amount"
                value={amcAmount}
                onChange={setAmcAmount}
                step={500}
                prefix="₹"
                hint="Annual maintenance charge."
              />
            </div>
            <div className="mt-3">
              <DateField
                label="AMC renewal date"
                value={renewal}
                onChange={setRenewal}
                hint="When the next AMC payment falls due."
              />
            </div>
          </section>

          {/* Branding */}
          <section>
            <SectionLabel icon={Palette} className="mb-3">
              Branding
            </SectionLabel>
            <Field
              label="Logo URL"
              value={logoUrl}
              onChange={setLogoUrl}
              placeholder="https://…/logo.png"
            />
            <div className="grid grid-cols-3 gap-3">
              <ColorField label="Primary" value={primaryColor} onChange={setPrimaryColor} />
              <ColorField label="Secondary" value={secondaryColor} onChange={setSecondaryColor} />
              <ColorField label="Accent" value={accentColor} onChange={setAccentColor} />
            </div>
          </section>
        </div>

        <Msg text={msg} />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------------------------------------------------------
 * Onboard owner dialog (FE-1)
 * ------------------------------------------------------------------------- */

/** Default onboarding form values — reused to reset the dialog on each open. */
const ONBOARD_DEFAULTS = {
  name: 'New Turf Co',
  email: 'owner2@example.com',
  password: 'owner12345',
  quota: '3',
  setupFee: '',
  amcAmount: '',
  logoUrl: '',
  primaryColor: '#16a34a',
  secondaryColor: '#0f172a',
  accentColor: '#f59e0b',
};

function OnboardOwnerDialog({
  open,
  games,
  onClose,
  onCreated,
}: {
  open: boolean;
  games: GameOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState(ONBOARD_DEFAULTS.name);
  const [email, setEmail] = useState(ONBOARD_DEFAULTS.email);
  const [password, setPassword] = useState(ONBOARD_DEFAULTS.password);
  const [quota, setQuota] = useState(ONBOARD_DEFAULTS.quota);
  const [setupFee, setSetupFee] = useState(ONBOARD_DEFAULTS.setupFee);
  const [amcAmount, setAmcAmount] = useState(ONBOARD_DEFAULTS.amcAmount);
  const [renewal, setRenewal] = useState<Date | undefined>(undefined);
  const [logoUrl, setLogoUrl] = useState(ONBOARD_DEFAULTS.logoUrl);
  const [primaryColor, setPrimaryColor] = useState(ONBOARD_DEFAULTS.primaryColor);
  const [secondaryColor, setSecondaryColor] = useState(ONBOARD_DEFAULTS.secondaryColor);
  const [accentColor, setAccentColor] = useState(ONBOARD_DEFAULTS.accentColor);
  const [selectedGameIds, setSelectedGameIds] = useState<string[]>([]);
  const [flags, setFlags] = useState<string[]>(ALL_FLAGS);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fresh form every time the dialog opens.
  const reset = () => {
    setName(ONBOARD_DEFAULTS.name);
    setEmail(ONBOARD_DEFAULTS.email);
    setPassword(ONBOARD_DEFAULTS.password);
    setQuota(ONBOARD_DEFAULTS.quota);
    setSetupFee(ONBOARD_DEFAULTS.setupFee);
    setAmcAmount(ONBOARD_DEFAULTS.amcAmount);
    setRenewal(undefined);
    setLogoUrl(ONBOARD_DEFAULTS.logoUrl);
    setPrimaryColor(ONBOARD_DEFAULTS.primaryColor);
    setSecondaryColor(ONBOARD_DEFAULTS.secondaryColor);
    setAccentColor(ONBOARD_DEFAULTS.accentColor);
    setSelectedGameIds([]);
    setFlags(ALL_FLAGS);
    setMsg(null);
    setBusy(false);
  };

  useEffect(() => {
    if (open) reset();
  }, [open]);

  const toggleGame = (id: string) =>
    setSelectedGameIds((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id],
    );
  const toggleFlag = (flag: FeatureFlag, next: boolean) =>
    setFlags((prev) => (next ? [...new Set([...prev, flag])] : prev.filter((f) => f !== flag)));

  const create = async () => {
    setMsg(null);
    setBusy(true);
    try {
      await api.createOwner({
        name,
        contactEmail: email,
        adminPassword: password,
        venueQuota: Number(quota),
        // Empty selection = grant all catalogue games.
        allowedGameIds: selectedGameIds.length ? selectedGameIds : games.map((g) => g.id),
        featureFlags: flags,
        branding: {
          logoUrl: logoUrl || undefined,
          primaryColor,
          secondaryColor,
          accentColor,
        },
        ...(numOrUndef(setupFee) !== undefined ? { setupFee: numOrUndef(setupFee) } : {}),
        ...(numOrUndef(amcAmount) !== undefined ? { amcAmount: numOrUndef(amcAmount) } : {}),
        ...(renewal ? { amcRenewalDate: renewal.toISOString() } : {}),
      });
      // Success — refresh the directory, reset the form and close.
      onCreated();
      onClose();
    } catch (e) {
      setMsg((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Onboard owner</DialogTitle>
          <DialogDescription>
            Set up an operator, their commercial terms and entitlements. They can sign in the moment
            you finish.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Identity */}
          <section>
            <SectionLabel icon={UserPlus} className="mb-4">
              Operator
            </SectionLabel>
            <Field label="Business name" value={name} onChange={setName} />
            <Field label="Contact email" value={email} onChange={setEmail} type="email" />
            <Field label="Admin password" value={password} onChange={setPassword} />
          </section>

          {/* Commercial terms */}
          <section>
            <SectionLabel icon={Receipt} className="mb-3">
              AMC &amp; commercial terms
            </SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Setup fee"
                value={setupFee}
                onChange={setSetupFee}
                step={500}
                prefix="₹"
              />
              <NumberField
                label="AMC amount"
                value={amcAmount}
                onChange={setAmcAmount}
                step={500}
                prefix="₹"
              />
            </div>
            <div className="mt-3">
              <DateField
                label="AMC renewal date"
                value={renewal}
                onChange={setRenewal}
                hint="When the next AMC payment falls due."
              />
            </div>
          </section>

          {/* Entitlements */}
          <section>
            <SectionLabel icon={SlidersHorizontal} className="mb-3">
              Entitlements
            </SectionLabel>
            <NumberField
              label="Venue quota"
              value={quota}
              onChange={setQuota}
              min={1}
              hint="Maximum venues this owner may create."
            />
            <p className="mb-2 mt-4 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Gamepad2 className="h-3.5 w-3.5" />
              Allowed games
            </p>
            <p className="mb-2 text-[11px] text-muted-foreground">
              Pick the games this owner may use. Leave all unchecked to grant the full catalogue.
            </p>
            <GamePicker games={games} selected={selectedGameIds} onToggle={toggleGame} />
          </section>

          {/* Feature flags */}
          <section>
            <SectionLabel icon={Award} className="mb-3">
              Features
            </SectionLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              {ALL_FLAGS.map((flag) => (
                <FeatureToggle
                  key={flag}
                  flag={flag}
                  enabled={flags.includes(flag)}
                  onToggle={(next) => toggleFlag(flag, next)}
                />
              ))}
            </div>
          </section>

          {/* Branding */}
          <section>
            <SectionLabel icon={Palette} className="mb-3">
              Branding
            </SectionLabel>
            <Field
              label="Logo URL"
              value={logoUrl}
              onChange={setLogoUrl}
              placeholder="https://…/logo.png"
            />
            <div className="grid grid-cols-3 gap-3">
              <ColorField label="Primary" value={primaryColor} onChange={setPrimaryColor} />
              <ColorField label="Secondary" value={secondaryColor} onChange={setSecondaryColor} />
              <ColorField label="Accent" value={accentColor} onChange={setAccentColor} />
            </div>
          </section>
        </div>

        <Msg text={msg} />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={create} disabled={busy}>
            <Plus className="h-4 w-4" />
            {busy ? 'Onboarding…' : 'Onboard owner'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------------------------------------------------------
 * Page
 * ------------------------------------------------------------------------- */

/** Super Admin: owner onboarding & oversight (PRD §3.2, §3.3). */
export function OwnersPage() {
  const games = useLoad(() => api.listGames());
  const owners = useLoad(() => api.listOwners());

  // Onboarding dialog (FE-1)
  const [onboardOpen, setOnboardOpen] = useState(false);

  // Directory / AMC
  const [amcMsg, setAmcMsg] = useState<string | null>(null);
  const [amcBusy, setAmcBusy] = useState(false);
  const [editing, setEditing] = useState<OwnerRow | null>(null);

  const gameList: GameOption[] = games.data ?? [];
  const list: OwnerRow[] = owners.data ?? [];

  const runAmc = async () => {
    setAmcMsg(null);
    setAmcBusy(true);
    try {
      const r = await api.runAmc();
      setAmcMsg(
        `AMC check complete — reminded ${r.reminded.length}, suspended ${r.suspended.length}, would suspend ${r.wouldSuspend.length}`,
      );
      owners.reload();
    } catch (e) {
      setAmcMsg((e as Error).message);
    } finally {
      setAmcBusy(false);
    }
  };

  const totalVenues = useMemo(
    () => list.reduce((sum, o) => sum + (o.venueCount ?? 0), 0),
    [list],
  );
  const activeCount = useMemo(
    () => list.filter((o) => /active|approv/i.test(o.status)).length,
    [list],
  );
  const overdueCount = useMemo(() => list.filter((o) => o.amcOverdue).length, [list]);

  return (
    <div className="container">
      <PageHeader
        title="Owners"
        subtitle="Onboard and oversee your turf operators"
        action={
          <Button onClick={() => setOnboardOpen(true)}>
            <Plus className="h-4 w-4" />
            Onboard owner
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Owners" value={list.length} icon={Building2} accent="primary" />
        <Stat label="Active" value={activeCount} icon={Users} accent="emerald" />
        <Stat label="Total grounds" value={totalVenues} icon={Building2} accent="blue" />
        <Stat
          label="AMC overdue"
          value={overdueCount}
          icon={CalendarClock}
          accent={overdueCount > 0 ? 'destructive' : 'emerald'}
        />
      </div>

      {/* Owner directory */}
      <Card
        title="Owner directory"
        subtitle="Status, capacity and AMC at a glance"
        topAccent="blue"
        action={
          <Button variant="outline" onClick={runAmc} disabled={amcBusy}>
            <RefreshCw className={`h-4 w-4 ${amcBusy ? 'animate-spin' : ''}`} />
            {amcBusy ? 'Running…' : 'Run AMC check'}
          </Button>
        }
      >
        <Msg text={amcMsg} />
        {owners.error ? (
          <EmptyState
            title="Couldn’t load owners"
            hint="Something went wrong fetching the directory. Try the AMC check or refresh the page."
          />
        ) : list.length === 0 ? (
          <EmptyState
            title="No owners yet"
            hint="Use “Onboard owner” to set up your first operator and start managing venues."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Venues</TableHead>
                <TableHead>AMC</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((o) => (
                <TableRow key={o.id}>
                  {/* Owner identity */}
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <OwnerLogo name={o.name} logoUrl={o.logoUrl} className="h-9 w-9" />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{o.name}</p>
                        {o.contactEmail && (
                          <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                            <Mail className="h-3 w-3 shrink-0" />
                            {o.contactEmail}
                          </p>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  {/* Capacity */}
                  <TableCell className="text-right">
                    <span className="font-display font-semibold tabular-nums text-foreground">
                      {o.venueCount}
                      <span className="font-normal text-muted-foreground"> / {o.venueQuota}</span>
                    </span>
                  </TableCell>

                  {/* AMC */}
                  <TableCell>
                    {o.amcRenewalDate ? (
                      o.amcOverdue ? (
                        <Badge variant="destructive">Overdue {fmtDate(o.amcRenewalDate)}</Badge>
                      ) : (
                        <Badge variant="outline">Due {fmtDate(o.amcRenewalDate)}</Badge>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground">Not set</span>
                    )}
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    <StatusPill status={o.status} />
                  </TableCell>

                  {/* Edit (FE-2) */}
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(o)}
                      aria-label={`Edit ${o.name}`}
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <OnboardOwnerDialog
        open={onboardOpen}
        games={gameList}
        onClose={() => setOnboardOpen(false)}
        onCreated={() => owners.reload()}
      />

      {editing && (
        <EditOwnerDialog
          owner={editing}
          games={gameList}
          onClose={() => setEditing(null)}
          onSaved={() => owners.reload()}
        />
      )}
    </div>
  );
}
