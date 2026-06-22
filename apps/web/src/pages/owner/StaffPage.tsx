import { useMemo, useState } from 'react';
import {
  Check,
  KeyRound,
  MapPin,
  Pencil,
  ShieldCheck,
  UserCog,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react';
import type { CreateStaffInput, StaffSummary, UpdateStaffInput } from '../../api/client';
import { api } from '../../api/client';
import {
  Card,
  EmptyState,
  Msg,
  PageHeader,
  SectionLabel,
  Stat,
  StatusPill,
  useLoad,
} from '../../components/common';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Switch } from '../../components/ui/switch';
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
import { Skeleton } from '../../components/ui/skeleton';
import { cn } from '../../components/ui/utils';

/** Minimal venue shape from GET /venues — only what the access picker needs. */
interface OwnerGround {
  id: string;
  name: string;
  city?: string | null;
}

const MIN_PASSWORD = 8;

function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

/**
 * Checkbox-card grid for picking which grounds a staff member can run. Used in
 * both the add and edit dialogs; this is the page's signature control — access
 * scoping made tangible rather than buried in a plain dropdown.
 */
function GroundPicker({
  grounds,
  selected,
  onToggle,
  loading,
}: {
  grounds: OwnerGround[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (grounds.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-elevated/30 px-3.5 py-3 text-sm text-muted-foreground">
        You have no grounds yet. Add a ground first, then you can assign staff to it.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {grounds.map((g) => {
        const on = selected.has(g.id);
        return (
          <button
            key={g.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => onToggle(g.id)}
            className={cn(
              'flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors outline-none',
              'focus-visible:ring-2 focus-visible:ring-primary/30',
              on
                ? 'border-primary/40 bg-primary/10'
                : 'border-border bg-input-background hover:border-foreground/20 hover:bg-muted',
            )}
          >
            <span
              className={cn(
                'grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors',
                on ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
              )}
            >
              {on && <Check className="h-3.5 w-3.5" />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">{g.name}</span>
              {g.city && (
                <span className="block truncate text-xs text-muted-foreground">{g.city}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A labelled field block for the dialogs (label + control + optional hint). */
function FormRow({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

/** Owner staff management — venue-scoped console logins (PRD-3). */
export function StaffPage() {
  const staff = useLoad(() => api.listStaff());
  const venuesLoad = useLoad(() => api.listVenues() as Promise<OwnerGround[]>);
  const grounds = useMemo<OwnerGround[]>(
    () =>
      (venuesLoad.data ?? []).map((v) => ({ id: v.id, name: v.name, city: v.city ?? null })),
    [venuesLoad.data],
  );
  const groundName = (id: string) => grounds.find((g) => g.id === id)?.name ?? 'Unknown ground';

  // ---- add dialog ----
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addVenues, setAddVenues] = useState<Set<string>>(new Set());
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const emailTouched = addEmail.trim().length > 0;
  const emailBad = emailTouched && !isValidEmail(addEmail);
  const pwTouched = addPassword.length > 0;
  const pwBad = pwTouched && addPassword.length < MIN_PASSWORD;
  const addReady =
    addName.trim().length > 0 &&
    isValidEmail(addEmail) &&
    addPassword.length >= MIN_PASSWORD &&
    addVenues.size > 0;

  // ---- edit dialog ----
  const [editing, setEditing] = useState<StaffSummary | null>(null);
  const [editName, setEditName] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editVenues, setEditVenues] = useState<Set<string>>(new Set());
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Page-level toast for row actions (deactivate).
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = staff.data ?? [];
  const activeCount = rows.filter((s) => s.active).length;
  const unassigned = rows.filter((s) => s.active && s.assignedVenueIds.length === 0).length;

  const openAdd = () => {
    setAddName('');
    setAddEmail('');
    setAddPassword('');
    setAddVenues(new Set());
    setAddError(null);
    setAddOpen(true);
  };

  const submitAdd = async () => {
    setAddError(null);
    if (!addReady) {
      setAddError('Add a name, a valid email, a password, and at least one ground.');
      return;
    }
    setAddSaving(true);
    try {
      const payload: CreateStaffInput = {
        name: addName.trim(),
        email: addEmail.trim(),
        password: addPassword,
        assignedVenueIds: [...addVenues],
      };
      const created = await api.createStaff(payload);
      setAddOpen(false);
      setMsg(`Added ${created.name}. They can sign in at the console with their email.`);
      staff.reload();
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setAddSaving(false);
    }
  };

  const openEdit = (s: StaffSummary) => {
    setEditing(s);
    setEditName(s.name);
    setEditActive(s.active);
    setEditVenues(new Set(s.assignedVenueIds));
    setEditError(null);
  };

  const submitEdit = async () => {
    if (!editing) return;
    setEditError(null);
    if (!editName.trim()) {
      setEditError('Give this person a name.');
      return;
    }
    setEditSaving(true);
    try {
      const body: UpdateStaffInput = {
        name: editName.trim(),
        assignedVenueIds: [...editVenues],
        active: editActive,
      };
      const updated = await api.updateStaff(editing.id, body);
      setEditing(null);
      setMsg(`Saved changes for ${updated.name}.`);
      staff.reload();
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setEditSaving(false);
    }
  };

  const deactivate = async (s: StaffSummary) => {
    if (
      !window.confirm(
        `Deactivate ${s.name}? They’ll lose console access immediately. You can re-activate them later from the edit dialog.`,
      )
    ) {
      return;
    }
    setMsg(null);
    setBusyId(s.id);
    try {
      await api.deactivateStaff(s.id);
      setMsg(`${s.name} can no longer sign in.`);
      staff.reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const toggleSet = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  return (
    <div className="container">
      <PageHeader
        title="Staff"
        subtitle="Give front-desk staff their own console login and choose which grounds they can run."
        badge={<StatusPill status="active">Access</StatusPill>}
        action={
          <Button onClick={openAdd}>
            <UserPlus className="h-4 w-4" />
            Add staff
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-4 mb-4">
        <Stat label="Staff" value={rows.length} accent="primary" icon={Users} />
        <Stat
          label="Active"
          value={activeCount}
          sub="can sign in"
          accent="emerald"
          icon={ShieldCheck}
        />
        <Stat
          label="No grounds"
          value={unassigned}
          sub="active, nothing assigned"
          accent={unassigned > 0 ? 'orange' : 'blue'}
          icon={MapPin}
        />
      </div>

      <Card title="Console logins" subtitle="Everyone who can sign in to run your grounds">
        <Msg text={staff.error} />
        {msg && !staff.error && <Msg text={msg} />}

        {staff.loading && rows.length === 0 ? (
          <div className="flex flex-col gap-3 py-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : staff.error ? null : rows.length === 0 ? (
          <EmptyState
            title="No staff yet"
            hint="Add a teammate to give them their own console login. You decide which grounds they can manage."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Grounds</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Manage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => {
                  const busy = busyId === s.id;
                  return (
                    <TableRow key={s.id} className={s.active ? undefined : 'opacity-60'}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {s.email ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {s.assignedVenueIds.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No grounds</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {s.assignedVenueIds.map((id) => (
                              <Badge key={id} variant="secondary">
                                <MapPin className="h-3 w-3" />
                                {groundName(id)}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {s.active ? (
                          <Badge variant="default">Active</Badge>
                        ) : (
                          <Badge variant="outline">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEdit(s)}
                            disabled={busy}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          {s.active && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deactivate(s)}
                              disabled={busy}
                              aria-label={`Deactivate ${s.name}`}
                            >
                              <UserX className="h-3.5 w-3.5" />
                              {busy ? 'Working…' : 'Deactivate'}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {!staff.error && rows.length > 0 && (
          <SectionLabel className="mt-4">
            {rows.length} {rows.length === 1 ? 'login' : 'logins'} · {activeCount} active
          </SectionLabel>
        )}
      </Card>

      {/* Add staff dialog. */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add staff</DialogTitle>
            <DialogDescription>
              Create a console login and choose which grounds this person can run.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-3">
              <SectionLabel icon={UserCog}>Login details</SectionLabel>
              <FormRow label="Name" htmlFor="staff-name">
                <Input
                  id="staff-name"
                  value={addName}
                  placeholder="e.g. Anita Rao"
                  onChange={(e) => setAddName(e.target.value)}
                />
              </FormRow>
              <FormRow
                label="Email"
                htmlFor="staff-email"
                hint={emailBad ? undefined : 'They’ll sign in to the console with this email.'}
              >
                <Input
                  id="staff-email"
                  type="email"
                  autoComplete="off"
                  value={addEmail}
                  placeholder="anita@yourvenue.com"
                  aria-invalid={emailBad}
                  onChange={(e) => setAddEmail(e.target.value)}
                  className={emailBad ? 'border-destructive/60 focus-visible:ring-destructive/20' : ''}
                />
                {emailBad && (
                  <span className="text-xs text-destructive">Enter a valid email address.</span>
                )}
              </FormRow>
              <FormRow
                label="Temporary password"
                htmlFor="staff-password"
                hint={pwBad ? undefined : `At least ${MIN_PASSWORD} characters. Share it with them to sign in.`}
              >
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="staff-password"
                    type="text"
                    autoComplete="new-password"
                    value={addPassword}
                    placeholder="Set a password"
                    aria-invalid={pwBad}
                    onChange={(e) => setAddPassword(e.target.value)}
                    className={cn(
                      'pl-9',
                      pwBad ? 'border-destructive/60 focus-visible:ring-destructive/20' : '',
                    )}
                  />
                </div>
                {pwBad && (
                  <span className="text-xs text-destructive">
                    Use at least {MIN_PASSWORD} characters.
                  </span>
                )}
              </FormRow>
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <SectionLabel icon={MapPin}>Ground access</SectionLabel>
                <span className="text-xs text-muted-foreground">
                  {addVenues.size} selected
                </span>
              </div>
              <GroundPicker
                grounds={grounds}
                selected={addVenues}
                onToggle={(id) => toggleSet(addVenues, setAddVenues, id)}
                loading={venuesLoad.loading}
              />
              <Msg text={venuesLoad.error} />
            </section>

            <Msg text={addError} />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addSaving}>
              Cancel
            </Button>
            <Button onClick={submitAdd} disabled={addSaving || !addReady}>
              <UserPlus className="h-4 w-4" />
              {addSaving ? 'Adding…' : 'Add staff'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit staff dialog. */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit staff</DialogTitle>
            <DialogDescription>
              {editing?.email
                ? `Update ${editing.email}’s name, ground access, and sign-in status.`
                : 'Update this person’s name, ground access, and sign-in status.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-3">
              <SectionLabel icon={UserCog}>Details</SectionLabel>
              <FormRow label="Name" htmlFor="edit-staff-name">
                <Input
                  id="edit-staff-name"
                  value={editName}
                  placeholder="Staff name"
                  onChange={(e) => setEditName(e.target.value)}
                />
              </FormRow>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-elevated/40 px-3.5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Can sign in</p>
                  <p className="text-xs text-muted-foreground">
                    Turn off to revoke console access without deleting the account.
                  </p>
                </div>
                <Switch
                  checked={editActive}
                  onCheckedChange={setEditActive}
                  aria-label="Can sign in"
                />
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <SectionLabel icon={MapPin}>Ground access</SectionLabel>
                <span className="text-xs text-muted-foreground">
                  {editVenues.size} selected
                </span>
              </div>
              <GroundPicker
                grounds={grounds}
                selected={editVenues}
                onToggle={(id) => toggleSet(editVenues, setEditVenues, id)}
                loading={venuesLoad.loading}
              />
              <Msg text={venuesLoad.error} />
            </section>

            <Msg text={editError} />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={editSaving}>
              Cancel
            </Button>
            <Button onClick={submitEdit} disabled={editSaving || !editName.trim()}>
              {editSaving ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
