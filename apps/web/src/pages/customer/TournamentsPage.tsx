import { useEffect, useState } from 'react';
import { Trophy, Users, Ticket, XCircle } from 'lucide-react';
import { api, DiscoverVenue } from '../../api/client';
import {
  Card,
  EmptyState,
  Field,
  ImageWithFallback,
  Msg,
  PageHeader,
  SectionLabel,
  Select,
  StatusPill,
  useLoad,
} from '../../components/common';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { EMPTY_TROPHY, FALLBACK_VENUE_PHOTO, tournamentBanner } from '../../lib/imagery';
import { openCheckout, razorpayEnabled } from '../../lib/razorpay';

/** Accept a 10-digit Indian mobile, optionally with a +91 / 0 prefix. */
function isValidMobile(raw: string): boolean {
  const digits = raw.replace(/[\s-]/g, '').replace(/^(\+91|0)/, '');
  return /^[6-9]\d{9}$/.test(digits);
}

/** Customer: browse and register for tournaments (PRD §4.7, §5.4). */
export function TournamentsPage() {
  const [venueId, setVenueId] = useState('');
  const [team, setTeam] = useState('');
  const [roster, setRoster] = useState('');
  const [name, setName] = useState('Captain');
  const [mobile, setMobile] = useState('+919800000099');
  const [msg, setMsg] = useState<string | null>(null);
  const [registering, setRegistering] = useState<string | null>(null);

  // Tournaments the player registered for in this session, keyed by tournament
  // id → participant id, so we can offer a player-side cancel. The customer
  // listing endpoint only returns aggregate counts, not the viewer's own entry.
  const [myEntries, setMyEntries] = useState<Record<string, string>>({});
  const [cancelTarget, setCancelTarget] = useState<{ id: string; name: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const venues = useLoad<DiscoverVenue[]>(() => api.discoverVenues(), []);

  // Default the venue picker to the first venue once the list arrives.
  useEffect(() => {
    if (!venueId && venues.data && venues.data[0]) setVenueId(venues.data[0].id);
  }, [venues.data, venueId]);

  const tournaments = useLoad<any[]>(
    () => (venueId ? api.listTournaments(venueId) : Promise.resolve([])),
    [venueId],
  );

  const mobileValid = isValidMobile(mobile);

  const register = async (id: string) => {
    setMsg(null);
    if (!name.trim()) {
      setMsg('Enter the captain’s name to register.');
      return;
    }
    if (!mobileValid) {
      setMsg('Enter a valid 10-digit mobile number to register.');
      return;
    }
    setRegistering(id);
    try {
      const rosterList = roster
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await api.registerTournament(id, {
        captainName: name,
        captainMobile: mobile,
        teamName: team || undefined,
        roster: rosterList.length ? rosterList : undefined,
      });
      setMyEntries((m) => ({ ...m, [id]: res.participantId }));

      // In production, if the registration returned a Razorpay order and the
      // checkout is configured, open the live modal for the fee. In dev (no key)
      // we keep the existing message-only behavior exactly.
      if (razorpayEnabled && res.razorpayOrderId) {
        await openCheckout({
          orderId: res.razorpayOrderId,
          amount: res.fee * 100, // fee is in rupees; Razorpay expects paise
          name: selectedVenue?.name ?? 'Tournament registration',
          prefill: { name, contact: mobile },
          onSuccess: () => {
            setMsg(`Registered & paid ₹${res.fee} — see you on the court!`);
            tournaments.reload();
          },
        });
        return;
      }

      setMsg(`Registered — pay ₹${res.fee} (order ${res.razorpayOrderId}).`);
      tournaments.reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setRegistering(null);
    }
  };

  const closeCancel = () => {
    if (cancelling) return;
    setCancelTarget(null);
    setCancelError(null);
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    const participantId = myEntries[cancelTarget.id];
    if (!participantId) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await api.cancelTournamentRegistration(cancelTarget.id, participantId);
      setMyEntries((m) => {
        const next = { ...m };
        delete next[cancelTarget.id];
        return next;
      });
      setMsg(
        res.refunded
          ? 'Registration cancelled. Your entry fee will be refunded per the venue’s policy.'
          : 'Registration cancelled.',
      );
      setCancelTarget(null);
      tournaments.reload();
    } catch (e) {
      setCancelError((e as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  const selectedVenue = venues.data?.find((v) => v.id === venueId);
  const sportOf = (gameId: string) =>
    selectedVenue?.games.find((g) => g.id === gameId)?.name;

  const rows = tournaments.data ?? [];

  return (
    <div className="container">
      <PageHeader title="Tournaments" subtitle="Browse & register your team" />

      <Card title="Your details" subtitle="We'll use these to register your team" topAccent="primary">
        <Select
          label="Venue"
          value={venueId}
          onChange={setVenueId}
          options={(venues.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Captain name" value={name} onChange={setName} />
          <div>
            <Field
              label="Mobile"
              type="tel"
              value={mobile}
              onChange={setMobile}
              placeholder="10-digit mobile"
            />
            {mobile && !mobileValid && (
              <p className="-mt-1.5 mb-3 text-xs text-destructive">
                Enter a valid 10-digit mobile number.
              </p>
            )}
          </div>
          <Field label="Team (optional)" value={team} onChange={setTeam} />
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">
            Team roster <span className="text-muted-foreground">(optional)</span>
          </span>
          <textarea
            value={roster}
            onChange={(e) => setRoster(e.target.value)}
            rows={3}
            placeholder={'One player per line\nAarav Sharma\nMeera Rao'}
            className="w-full rounded-xl border border-border bg-input-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            For team events — list your players, one per line.
          </span>
        </label>
      </Card>

      <SectionLabel icon={Trophy} className="mb-3">
        Available Tournaments
      </SectionLabel>

      {tournaments.error ? (
        <Card>
          <EmptyState
            image={EMPTY_TROPHY}
            title="Couldn’t load tournaments"
            hint={tournaments.error}
          />
          <div className="flex justify-center">
            <Button variant="secondary" size="sm" onClick={tournaments.reload}>
              Try again
            </Button>
          </div>
        </Card>
      ) : tournaments.loading && !tournaments.data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72 w-full rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            image={EMPTY_TROPHY}
            title="No tournaments here yet"
            hint="This venue hasn’t scheduled any tournaments. Check back soon or try another venue."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rows.map((t) => {
            const registered = t._count?.participants ?? 0;
            const full = t.capacity != null && registered >= t.capacity;
            const myParticipantId = myEntries[t.id];
            const busy = registering === t.id;
            return (
              <div
                key={t.id}
                className="flex flex-col bg-card border border-border rounded-2xl overflow-hidden"
              >
                <div className="relative h-32">
                  <ImageWithFallback
                    src={tournamentBanner(sportOf(t.gameId))}
                    fallback={FALLBACK_VENUE_PHOTO}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-card via-card/75 to-card/10" />
                  <div className="absolute top-3 right-3">
                    <StatusPill status={full ? 'full' : 'open'}>
                      {full ? 'Full' : 'Open'}
                    </StatusPill>
                  </div>
                  <div className="absolute inset-x-0 bottom-0 p-4">
                    <p className="font-display font-semibold text-lg leading-tight text-foreground">
                      {t.name}
                    </p>
                    <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mt-0.5">
                      {t.format} · {t.regType}
                    </p>
                  </div>
                </div>

                <div className="flex flex-1 flex-col gap-4 p-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Ticket className="h-4 w-4 text-primary" />
                      <span className="font-medium text-foreground">₹{t.fee}</span>
                      <span className="text-xs">({t.feeBasis})</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="h-4 w-4 text-rail-blue" />
                      {registered}/{t.capacity} registered
                    </span>
                  </div>

                  {myParticipantId ? (
                    <div className="mt-auto flex flex-col gap-2">
                      <p className="text-sm font-medium text-primary">
                        You’re registered for this tournament.
                      </p>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          setMsg(null);
                          setCancelError(null);
                          setCancelTarget({ id: t.id, name: t.name });
                        }}
                      >
                        <XCircle className="h-4 w-4" />
                        Cancel registration
                      </Button>
                    </div>
                  ) : (
                    <Button
                      onClick={() => register(t.id)}
                      disabled={full || busy}
                      className="mt-auto w-full"
                    >
                      {full ? 'Tournament full' : busy ? 'Registering…' : 'Register'}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Msg text={msg} />

      <Dialog open={cancelTarget != null} onOpenChange={(open) => !open && closeCancel()}>
        <DialogContent showCloseButton={!cancelling}>
          <DialogHeader>
            <DialogTitle>Cancel this registration?</DialogTitle>
            <DialogDescription>
              {cancelTarget
                ? `Your team will be withdrawn from ${cancelTarget.name}. Any eligible entry fee will be refunded per the venue’s policy.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <Msg text={cancelError} />
          <DialogFooter>
            <Button variant="outline" onClick={closeCancel} disabled={cancelling}>
              Keep registration
            </Button>
            <Button variant="destructive" onClick={confirmCancel} disabled={cancelling}>
              {cancelling ? 'Cancelling…' : 'Cancel registration'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
