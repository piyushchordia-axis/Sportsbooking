import { UnitLabel } from '@sportsbooking/shared';
import { useEffect, useMemo, useState } from 'react';
import {
  LayoutGrid,
  Minus,
  MoreVertical,
  Pencil,
  Plus,
  Ruler,
  Timer,
  Trash2,
  Users,
} from 'lucide-react';
import { api } from '../../api/client';
import {
  Card,
  EmptyState,
  Msg,
  PageHeader,
  SectionLabel,
  SportIcon,
  StatusPill,
  useLoad,
} from '../../components/common';
import { Badge } from '../../components/ui/badge';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Skeleton } from '../../components/ui/skeleton';
import { Switch } from '../../components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';

interface Game {
  id: string;
  name: string;
  iconUrl?: string | null;
  unitLabel: UnitLabel;
  slotGranularityMin: number;
  minPlayers: number;
  maxPlayers: number;
  active?: boolean;
}

/** Form values shared by the create and edit flows. */
interface GameDraft {
  name: string;
  unitLabel: UnitLabel;
  slotGranularityMin: number;
  minPlayers: number;
  maxPlayers: number;
  active: boolean;
}

const SLOT_OPTIONS = [30, 45, 60, 90, 120];

const UNIT_HINT: Record<UnitLabel, string> = {
  [UnitLabel.COURT]: 'Indoor or marked playing court',
  [UnitLabel.TURF]: 'Open turf or pitch',
  [UnitLabel.LANE]: 'Single lane, e.g. swimming or bowling',
  [UnitLabel.NET]: 'Net-based pitch, e.g. cricket nets',
};

const EMPTY_DRAFT: GameDraft = {
  name: '',
  unitLabel: UnitLabel.COURT,
  slotGranularityMin: 60,
  minPlayers: 2,
  maxPlayers: 4,
  active: true,
};

function toDraft(g: Game): GameDraft {
  return {
    name: g.name,
    unitLabel: g.unitLabel,
    slotGranularityMin: g.slotGranularityMin,
    minPlayers: g.minPlayers,
    maxPlayers: g.maxPlayers,
    active: g.active ?? true,
  };
}

/** Super Admin: global game catalogue (PRD §3.1). */
export function GamesPage() {
  const games = useLoad(() => api.listGames());

  // Single dialog drives both create and edit. `editing` null => create mode.
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Game | null>(null);

  // Delete confirm state.
  const [deleting, setDeleting] = useState<Game | null>(null);
  const [dMsg, setDMsg] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const list = (games.data ?? []) as Game[];

  const stats = useMemo(() => {
    const units = new Set(list.map((g) => g.unitLabel));
    const active = list.filter((g) => g.active ?? true).length;
    return { total: list.length, units: units.size, active };
  }, [list]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (g: Game) => {
    setEditing(g);
    setFormOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDMsg(null);
    setRemoving(true);
    try {
      await api.deleteGame(deleting.id);
      setDeleting(null);
      games.reload();
    } catch (e) {
      setDMsg((e as Error).message);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="container">
      <PageHeader
        title="Games"
        subtitle="The master catalogue every venue draws on. Define how each sport is booked and sized."
        badge={<StatusPill status="active">{stats.total} in catalogue</StatusPill>}
        action={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add game
          </Button>
        }
      />

      {/* Overview strip — quick read on the shape of the catalogue. */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <OverviewTile icon={LayoutGrid} label="Games" value={stats.total} accent="primary" />
        <OverviewTile icon={Ruler} label="Unit types" value={stats.units} accent="blue" />
        <OverviewTile icon={Users} label="Available" value={stats.active} accent="emerald" />
      </div>

      <Card
        title="Catalogue"
        subtitle="Every game venues can offer, with its booking unit and party size."
        className="mb-0"
      >
        {games.loading && list.length === 0 ? (
          <LoadingRows />
        ) : games.error ? (
          <div className="py-4">
            <Msg text={`Couldn't load games. ${games.error}`} />
            <Button variant="outline" className="mt-3" onClick={() => games.reload()}>
              Try again
            </Button>
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            title="No games yet"
            hint="Add your first game to start the catalogue — venues can offer it the moment it's here."
          />
        ) : (
          <>
            {/* Desktop: dense, scannable table. */}
            <div className="hidden md:block -mx-2">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-3">Game</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Slot</TableHead>
                    <TableHead>Players</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10 text-right pr-3" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell className="pl-3">
                        <div className="flex items-center gap-3">
                          <GameGlyph g={g} />
                          <span className="font-display font-semibold leading-tight">
                            {g.name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="capitalize text-sm text-foreground">{g.unitLabel}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{g.slotGranularityMin} min</Badge>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                          <Users className="h-3.5 w-3.5 text-muted-foreground" />
                          {g.minPlayers}–{g.maxPlayers}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusPill status={(g.active ?? true) ? 'active' : 'suspended'}>
                          {(g.active ?? true) ? 'Available' : 'Hidden'}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="text-right pr-3">
                        <RowMenu
                          g={g}
                          onEdit={() => openEdit(g)}
                          onDelete={() => {
                            setDMsg(null);
                            setDeleting(g);
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: stacked cards. */}
            <div className="grid gap-3 md:hidden">
              {list.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-elevated p-3.5"
                >
                  <GameGlyph g={g} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-display font-semibold leading-tight truncate">
                        {g.name}
                      </p>
                      <StatusPill status={(g.active ?? true) ? 'active' : 'suspended'}>
                        {(g.active ?? true) ? 'Available' : 'Hidden'}
                      </StatusPill>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="outline" className="capitalize">
                        {g.unitLabel}
                      </Badge>
                      <Badge variant="outline">{g.slotGranularityMin} min</Badge>
                      <Badge variant="outline">
                        <Users className="h-3 w-3" />
                        {g.minPlayers}–{g.maxPlayers}
                      </Badge>
                    </div>
                  </div>
                  <RowMenu
                    g={g}
                    onEdit={() => openEdit(g)}
                    onDelete={() => {
                      setDMsg(null);
                      setDeleting(g);
                    }}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <GameFormDialog
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          games.reload();
        }}
      />

      {/* Delete confirm dialog */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete game</DialogTitle>
            <DialogDescription>
              {deleting
                ? `Remove “${deleting.name}” from the catalogue? This can't be undone. A game still used by venues can't be deleted.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <Msg text={dMsg} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={removing}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={removing}>
              {removing ? 'Deleting…' : 'Delete game'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function OverviewTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof LayoutGrid;
  label: string;
  value: number;
  accent: 'primary' | 'blue' | 'emerald';
}) {
  const color =
    accent === 'primary'
      ? 'var(--primary)'
      : accent === 'blue'
        ? 'var(--rail-blue)'
        : 'var(--rail-emerald)';
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
          style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <p className="font-display font-bold text-2xl leading-none mt-2.5 text-foreground">
        {value}
      </p>
    </div>
  );
}

function GameGlyph({ g }: { g: Game }) {
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
      <SportIcon name={g.name} src={g.iconUrl} className="h-5 w-5" />
    </span>
  );
}

function RowMenu({
  g,
  onEdit,
  onDelete,
}: {
  g: Game;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="shrink-0" aria-label={`Actions for ${g.name}`}>
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil className="h-4 w-4" /> Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 className="h-4 w-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-border p-3.5">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ml-auto h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

/* ── Form dialog (create + edit) ────────────────────────────────────────── */

function GameFormDialog({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: Game | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<GameDraft>(EMPTY_DRAFT);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset the draft whenever the dialog opens (fresh for create, prefilled for edit).
  useEffect(() => {
    if (open) {
      setDraft(editing ? toDraft(editing) : EMPTY_DRAFT);
      setMsg(null);
    }
  }, [open, editing]);

  const set = <K extends keyof GameDraft>(key: K, value: GameDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const nameError = draft.name.trim() === '';
  const playersError = draft.minPlayers < 1 || draft.maxPlayers < draft.minPlayers;
  const canSave = !nameError && !playersError && !saving;

  const save = async () => {
    if (!canSave) return;
    setMsg(null);
    setSaving(true);
    const body = {
      name: draft.name.trim(),
      unitLabel: draft.unitLabel,
      slotGranularityMin: draft.slotGranularityMin,
      minPlayers: draft.minPlayers,
      maxPlayers: draft.maxPlayers,
      active: draft.active,
    };
    try {
      if (editing) await api.updateGame(editing.id, body);
      else await api.createGame(body);
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit game' : 'Add game'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update how this game is booked and sized across all venues.'
              : 'Define a new sport for the catalogue. Venues can offer it right away.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Identity */}
          <section className="space-y-2.5">
            <SectionLabel>Identity</SectionLabel>
            <label className="block">
              <span className="block text-xs font-medium text-muted-foreground mb-1.5">Name</span>
              <input
                autoFocus
                value={draft.name}
                placeholder="e.g. Badminton"
                onChange={(e) => set('name', e.target.value)}
                className="flex h-10 w-full min-w-0 rounded-xl border border-border bg-input-background px-3.5 py-1 text-sm text-foreground transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
              />
            </label>
          </section>

          <div className="h-px bg-[var(--border-faint)]" />

          {/* Booking model */}
          <section className="space-y-3">
            <SectionLabel icon={Ruler}>Booking model</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Bookable unit
                </span>
                <Select
                  value={draft.unitLabel}
                  onValueChange={(v) => set('unitLabel', v as UnitLabel)}
                >
                  <SelectTrigger className="capitalize">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(UnitLabel).map((u) => (
                      <SelectItem key={u} value={u} className="capitalize">
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                  {UNIT_HINT[draft.unitLabel]}
                </p>
              </div>
              <div>
                <span className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Slot length
                </span>
                <Select
                  value={String(draft.slotGranularityMin)}
                  onValueChange={(v) => set('slotGranularityMin', Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SLOT_OPTIONS.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {m} minutes
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] leading-snug text-muted-foreground">
                  <Timer className="h-3 w-3" /> Default booking length
                </p>
              </div>
            </div>
          </section>

          <div className="h-px bg-[var(--border-faint)]" />

          {/* Party size */}
          <section className="space-y-2.5">
            <SectionLabel icon={Users}>Party size</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <Stepper
                label="Minimum players"
                value={draft.minPlayers}
                min={1}
                onChange={(n) => set('minPlayers', n)}
              />
              <Stepper
                label="Maximum players"
                value={draft.maxPlayers}
                min={1}
                onChange={(n) => set('maxPlayers', n)}
              />
            </div>
            {playersError && (
              <p className="text-xs font-medium text-destructive">
                Maximum players must be at least the minimum.
              </p>
            )}
          </section>

          <div className="h-px bg-[var(--border-faint)]" />

          {/* Availability */}
          <section>
            <label className="flex items-center justify-between gap-4 rounded-xl border border-border bg-elevated px-3.5 py-3">
              <span>
                <span className="block text-sm font-medium text-foreground">
                  Available to venues
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  When off, venues can't add or offer this game.
                </span>
              </span>
              <Switch
                checked={draft.active}
                onCheckedChange={(v) => set('active', v)}
                aria-label="Available to venues"
              />
            </label>
          </section>
        </div>

        <Msg text={msg} />

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add game'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Number stepper with -/+ controls and a typable centre field. */
function Stepper({
  label,
  value,
  min = 0,
  max = 99,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div>
      <span className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</span>
      <div className="flex h-10 items-center rounded-xl border border-border bg-input-background">
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          onClick={() => onChange(clamp(value - 1))}
          disabled={value <= min}
          className="grid h-full w-10 place-items-center rounded-l-xl text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-primary/30 outline-none"
        >
          <Minus className="h-4 w-4" />
        </button>
        <input
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(clamp(Number(e.target.value) || min))}
          className="h-full w-full min-w-0 bg-transparent text-center text-sm font-medium text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          onClick={() => onChange(clamp(value + 1))}
          disabled={value >= max}
          className="grid h-full w-10 place-items-center rounded-r-xl text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-primary/30 outline-none"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
