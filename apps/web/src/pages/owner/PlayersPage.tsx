import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ListPlus,
  Megaphone,
  Phone,
  Repeat,
  Send,
  ShieldCheck,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react';
import type { BroadcastResult, BulkAddPlayerInput, BulkAddResult } from '../../api/client';
import { api } from '../../api/client';
import {
  Card,
  EmptyState,
  Msg,
  PageHeader,
  SectionLabel,
  Select,
  StatusPill,
  Stat,
  Tabs,
  useLoad,
} from '../../components/common';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
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

const SEGMENTS = [
  { id: '', label: 'All players', icon: Users },
  { id: 'regulars', label: 'Regulars (5+)', icon: Repeat },
  { id: 'lapsed', label: 'Lapsed (60+ days)', icon: Phone },
] as const;

/** Human label for a segment id, used in the campaign dialog and toasts. */
function segmentLabel(id: string): string {
  return SEGMENTS.find((s) => s.id === id)?.label ?? 'All players';
}

/** Indian mobile validation: 10 digits, optional +91 / leading 0, spaces/dashes ok. */
function isValidMobile(raw: string): boolean {
  const digits = raw.replace(/[\s-]/g, '').replace(/^\+?91/, '').replace(/^0/, '');
  return /^[6-9]\d{9}$/.test(digits);
}

const MAX_MESSAGE = 320;

/** A single parsed line from the bulk-paste textarea. */
interface ParsedRow {
  name: string;
  mobile: string;
  consent: boolean;
  /** A reason this row can't be submitted, or null if it's valid. */
  error: string | null;
}

/**
 * Parse the bulk-paste textarea — one player per line as "Name, +91mobile".
 * Tolerates blank lines and trims whitespace; flags rows missing name/mobile.
 */
function parseBulk(raw: string, defaultConsent: boolean): ParsedRow[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const comma = line.indexOf(',');
      const name = comma >= 0 ? line.slice(0, comma).trim() : '';
      const mobile = comma >= 0 ? line.slice(comma + 1).trim() : line.trim();
      let error: string | null = null;
      if (!name) error = 'Add a name (use "Name, +91mobile")';
      else if (!mobile) error = 'Add a mobile number';
      else if (!isValidMobile(mobile)) error = 'Check the mobile number';
      return { name, mobile, consent: defaultConsent, error };
    });
}

/** Owner CRM directory with segment filter + direct add-customer (PRD §4.9). */
export function PlayersPage() {
  const [segment, setSegment] = useState('');
  const players = useLoad(() => api.listPlayers(segment || undefined), [segment]);

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const mobileTouched = mobile.trim().length > 0;
  const mobileBad = mobileTouched && !isValidMobile(mobile);

  // Bulk-add dialog state.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkConsent, setBulkConsent] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkAddResult | null>(null);

  // Per-row consent overrides (keyed by line index) layered onto the parse.
  const [rowConsent, setRowConsent] = useState<Record<number, boolean>>({});

  // Which directory rows have an in-flight consent write.
  const [consentBusy, setConsentBusy] = useState<Record<string, boolean>>({});

  // Campaign (broadcast) dialog state — PRD-7.
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [campaignSegment, setCampaignSegment] = useState('');
  const [campaignMessage, setCampaignMessage] = useState('');
  const [campaignSending, setCampaignSending] = useState(false);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [campaignResult, setCampaignResult] = useState<BroadcastResult | null>(null);

  const parsed = useMemo(() => {
    const base = parseBulk(bulkText, bulkConsent);
    return base.map((row, i) => ({
      ...row,
      consent: rowConsent[i] ?? row.consent,
    }));
  }, [bulkText, bulkConsent, rowConsent]);

  const validRows = parsed.filter((r) => !r.error);

  const add = async () => {
    setMsg(null);
    if (!name.trim() || !mobile.trim()) {
      setMsg('Add a name and mobile number to continue');
      return;
    }
    if (!isValidMobile(mobile)) {
      setMsg('That mobile number does not look right — use a 10-digit number');
      return;
    }
    setSaving(true);
    try {
      const created = await api.addCustomer({ name: name.trim(), mobile: mobile.trim(), consent });
      setName('');
      setMobile('');
      setConsent(false);
      players.reload();
      setMsg(`Added ${created.name} (${created.mobile}) to your CRM`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const openBulk = () => {
    setBulkText('');
    setBulkConsent(false);
    setRowConsent({});
    setBulkResult(null);
    setBulkError(null);
    setBulkOpen(true);
  };

  const submitBulk = async () => {
    setBulkError(null);
    setBulkResult(null);
    if (validRows.length === 0) {
      setBulkError('Add at least one valid row (format: "Name, +91mobile")');
      return;
    }
    setBulkSaving(true);
    try {
      const payload: BulkAddPlayerInput[] = validRows.map((r) => ({
        name: r.name,
        mobile: r.mobile,
        consent: r.consent,
      }));
      const result = await api.bulkAddPlayers(payload);
      setBulkResult(result);
      players.reload();
    } catch (e) {
      setBulkError((e as Error).message);
    } finally {
      setBulkSaving(false);
    }
  };

  const openCampaign = () => {
    setCampaignSegment(segment);
    setCampaignMessage('');
    setCampaignResult(null);
    setCampaignError(null);
    setCampaignOpen(true);
  };

  const sendCampaign = async () => {
    setCampaignError(null);
    setCampaignResult(null);
    const message = campaignMessage.trim();
    if (message.length < 4) {
      setCampaignError('Write a message of at least a few characters');
      return;
    }
    setCampaignSending(true);
    try {
      const result = await api.broadcastPlayers(campaignSegment || undefined, message);
      setCampaignResult(result);
    } catch (e) {
      setCampaignError((e as Error).message);
    } finally {
      setCampaignSending(false);
    }
  };

  const toggleOptOut = async (customerId: string, nextOptedOut: boolean) => {
    setConsentBusy((b) => ({ ...b, [customerId]: true }));
    try {
      await api.setPlayerConsent(customerId, { optedOut: nextOptedOut });
      players.reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setConsentBusy((b) => {
        const next = { ...b };
        delete next[customerId];
        return next;
      });
    }
  };

  const rows = players.data ?? [];
  const totalBookings = rows.reduce((sum, p) => sum + p.bookingCount, 0);
  const regulars = rows.filter((p) => p.bookingCount >= 5).length;
  const consented = rows.filter((p) => p.consent && !p.optedOut).length;

  return (
    <div className="container">
      <PageHeader
        title="Players"
        subtitle="Your customer directory, segments, and marketing reach"
        badge={<StatusPill status="active">CRM</StatusPill>}
        action={
          <Button onClick={openCampaign} disabled={rows.length === 0}>
            <Megaphone className="h-4 w-4" />
            Send campaign
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Players" value={rows.length} accent="primary" icon={Users} />
        <Stat label="Regulars" value={regulars} sub="5+ bookings" accent="emerald" icon={Repeat} />
        <Stat label="Total bookings" value={totalBookings} accent="blue" icon={CheckCircle2} />
        <Stat
          label="Reachable"
          value={consented}
          sub="opted-in contacts"
          accent="purple"
          icon={Megaphone}
        />
      </div>

      <Card
        title="Add a customer"
        subtitle="Add a walk-in or phone customer to your CRM. They’ll appear below even before their first booking."
        topAccent="primary"
        action={
          <Button variant="outline" onClick={openBulk}>
            <ListPlus className="h-4 w-4" />
            Bulk add
          </Button>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
          <label className="block mb-1">
            <span className="block text-xs font-medium text-muted-foreground mb-1.5">Name</span>
            <input
              type="text"
              value={name}
              placeholder="e.g. Priya Sharma"
              onChange={(e) => setName(e.target.value)}
              className="flex h-10 w-full min-w-0 rounded-xl border border-border bg-input-background px-3.5 py-1 text-sm text-foreground transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
            />
          </label>
          <label className="block mb-1">
            <span className="block text-xs font-medium text-muted-foreground mb-1.5">Mobile</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={mobile}
              placeholder="e.g. 9876543210"
              aria-invalid={mobileBad}
              onChange={(e) => setMobile(e.target.value)}
              className={`flex h-10 w-full min-w-0 rounded-xl border bg-input-background px-3.5 py-1 text-sm text-foreground transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:ring-2 ${
                mobileBad
                  ? 'border-destructive/60 focus-visible:border-destructive/60 focus-visible:ring-destructive/20'
                  : 'border-border focus-visible:border-primary/50 focus-visible:ring-primary/20'
              }`}
            />
            <span className="block h-4 mt-1 text-xs text-destructive">
              {mobileBad ? 'Enter a valid 10-digit Indian mobile number' : ''}
            </span>
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-elevated/40 px-3.5 py-3 mb-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Marketing consent</p>
            <p className="text-xs text-muted-foreground">
              Customer agrees to receive offers and updates (DPDP)
            </p>
          </div>
          <Switch checked={consent} onCheckedChange={setConsent} aria-label="Marketing consent" />
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={add} disabled={saving}>
            <UserPlus className="h-4 w-4" />
            {saving ? 'Adding…' : 'Add customer'}
          </Button>
          <Msg text={msg} />
        </div>
      </Card>

      <Card
        title="Directory"
        subtitle="Filter your players by segment"
        action={
          <Tabs
            tabs={SEGMENTS.map((s) => ({ id: s.id, label: s.label, icon: s.icon }))}
            active={segment}
            onChange={setSegment}
          />
        }
      >
        <Msg text={players.error} />
        {players.loading && rows.length === 0 ? (
          <div className="flex flex-col gap-3 py-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !players.error && rows.length === 0 ? (
          <EmptyState
            title="No players in this segment"
            hint="Add a customer above, or as customers book and opt in, they’ll show up in your CRM here."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Bookings</TableHead>
                  <TableHead>Last visit</TableHead>
                  <TableHead>Consent</TableHead>
                  <TableHead className="text-right">Marketing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => {
                  const busy = !!consentBusy[p.customerId];
                  const optedIn = !p.optedOut;
                  return (
                    <TableRow key={p.customerId}>
                      <TableCell className="font-medium">
                        {p.name ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="font-mono whitespace-nowrap text-muted-foreground">
                        {p.mobile ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {p.bookingCount >= 5 ? (
                          <Badge variant="default">{p.bookingCount}</Badge>
                        ) : (
                          <span className="font-mono">{p.bookingCount}</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {new Date(p.lastVisitAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {p.optedOut ? (
                          <Badge variant="destructive">Opted out</Badge>
                        ) : p.consent ? (
                          <Badge variant="default">Opted in</Badge>
                        ) : (
                          <Badge variant="outline">No consent</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2.5">
                          <span
                            className={`text-xs ${optedIn ? 'text-foreground' : 'text-muted-foreground'}`}
                          >
                            {busy ? 'Saving…' : optedIn ? 'Included' : 'Excluded'}
                          </span>
                          <Switch
                            checked={optedIn}
                            disabled={busy}
                            onCheckedChange={(next) => toggleOptOut(p.customerId, !next)}
                            aria-label={
                              optedIn
                                ? `Stop marketing to ${p.name ?? p.mobile ?? 'this contact'}`
                                : `Include ${p.name ?? p.mobile ?? 'this contact'} in marketing`
                            }
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {!players.error && rows.length > 0 && (
          <SectionLabel className="mt-4">
            {rows.length} {rows.length === 1 ? 'player' : 'players'} shown
          </SectionLabel>
        )}
      </Card>

      {/* Campaign / broadcast dialog — PRD-7. */}
      <Dialog open={campaignOpen} onOpenChange={setCampaignOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send a campaign</DialogTitle>
            <DialogDescription>
              Send a one-off message to a segment. Opted-out contacts are always skipped.
            </DialogDescription>
          </DialogHeader>

          {campaignResult ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2.5 rounded-xl border border-border bg-elevated/40 px-3.5 py-3">
                <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
                <p className="text-sm text-foreground">
                  Campaign sent to{' '}
                  <span className="font-medium">{segmentLabel(campaignSegment).toLowerCase()}</span>.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <SectionLabel>Sent</SectionLabel>
                  </div>
                  <p className="font-display font-bold text-2xl mt-1.5">{campaignResult.sent}</p>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                    <SectionLabel className="text-muted-foreground">Skipped</SectionLabel>
                  </div>
                  <p className="font-display font-bold text-2xl mt-1.5">{campaignResult.skipped}</p>
                  <p className="text-xs text-muted-foreground mt-1">opted out or unreachable</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Select
                label="Audience"
                value={campaignSegment}
                onChange={setCampaignSegment}
                options={SEGMENTS.map((s) => ({ value: s.id, label: s.label }))}
              />
              <label className="block">
                <span className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Message
                </span>
                <textarea
                  value={campaignMessage}
                  onChange={(e) => setCampaignMessage(e.target.value.slice(0, MAX_MESSAGE))}
                  rows={4}
                  placeholder="e.g. Courts free this Friday evening — reply to grab a 50% off slot."
                  className="w-full rounded-xl border border-border bg-input-background px-3.5 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
                />
                <span className="mt-1 flex justify-end text-xs text-muted-foreground">
                  {campaignMessage.length}/{MAX_MESSAGE}
                </span>
              </label>
              <Msg text={campaignError} />
            </div>
          )}

          <DialogFooter>
            {campaignResult ? (
              <>
                <Button variant="outline" onClick={openCampaign}>
                  Send another
                </Button>
                <Button onClick={() => setCampaignOpen(false)}>Done</Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => setCampaignOpen(false)}
                  disabled={campaignSending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={sendCampaign}
                  disabled={campaignSending || campaignMessage.trim().length < 4}
                >
                  <Send className="h-4 w-4" />
                  {campaignSending ? 'Sending…' : 'Send campaign'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk-add dialog. */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bulk add players</DialogTitle>
            <DialogDescription>
              Paste one player per line as <span className="font-mono">Name, +91mobile</span>. Review
              the parsed rows, set consent, then import. One bad row won’t abort the batch.
            </DialogDescription>
          </DialogHeader>

          {bulkResult ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="default">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {bulkResult.added} added
                </Badge>
                {bulkResult.failed > 0 && (
                  <Badge variant="destructive">
                    <XCircle className="h-3.5 w-3.5" />
                    {bulkResult.failed} failed
                  </Badge>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mobile</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bulkResult.results.map((r, i) => (
                      <TableRow key={`${r.mobile}-${i}`}>
                        <TableCell className="font-mono whitespace-nowrap">{r.mobile}</TableCell>
                        <TableCell>
                          {r.ok ? (
                            <Badge variant="default">Added</Badge>
                          ) : (
                            <span className="inline-flex items-center gap-2">
                              <Badge variant="destructive">Failed</Badge>
                              <span className="text-xs text-muted-foreground">{r.error}</span>
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <textarea
                value={bulkText}
                onChange={(e) => {
                  setBulkText(e.target.value);
                  setRowConsent({});
                }}
                rows={6}
                placeholder={'Priya Sharma, +919876543210\nRahul Verma, +919812345678'}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring/50"
              />
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-elevated/40 px-3.5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Default marketing consent</p>
                  <p className="text-xs text-muted-foreground">
                    Applied to every new row — toggle individual rows below
                  </p>
                </div>
                <Switch
                  checked={bulkConsent}
                  onCheckedChange={(v) => {
                    setBulkConsent(v);
                    setRowConsent({});
                  }}
                  aria-label="Default marketing consent"
                />
              </div>

              {parsed.length > 0 && (
                <div className="flex flex-col gap-2">
                  <SectionLabel>
                    Preview — {validRows.length} of {parsed.length} ready
                  </SectionLabel>
                  <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Mobile</TableHead>
                          <TableHead className="text-center">Consent</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parsed.map((r, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium">
                              {r.name || <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="font-mono whitespace-nowrap text-muted-foreground">
                              {r.mobile || <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-center">
                                <Switch
                                  checked={r.consent}
                                  disabled={!!r.error}
                                  onCheckedChange={(v) =>
                                    setRowConsent((c) => ({ ...c, [i]: v }))
                                  }
                                  aria-label={`Consent for ${r.name || r.mobile || `row ${i + 1}`}`}
                                />
                              </div>
                            </TableCell>
                            <TableCell>
                              {r.error ? (
                                <span className="inline-flex items-center gap-2">
                                  <Badge variant="destructive">Skip</Badge>
                                  <span className="text-xs text-muted-foreground">{r.error}</span>
                                </span>
                              ) : (
                                <Badge variant="default">Ready</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              <Msg text={bulkError} />
            </div>
          )}

          <DialogFooter>
            {bulkResult ? (
              <>
                <Button variant="outline" onClick={openBulk}>
                  Import more
                </Button>
                <Button onClick={() => setBulkOpen(false)}>Done</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={bulkSaving}>
                  Cancel
                </Button>
                <Button onClick={submitBulk} disabled={bulkSaving || validRows.length === 0}>
                  <ListPlus className="h-4 w-4" />
                  {bulkSaving ? 'Importing…' : `Import ${validRows.length || ''}`.trim()}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
