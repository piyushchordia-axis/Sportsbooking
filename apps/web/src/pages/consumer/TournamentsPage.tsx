import { useEffect, useState } from 'react';
import { api, DiscoverVenue } from '../../api/client';
import { useLoad } from '../../components/common';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { openCheckout, razorpayEnabled } from '../../lib/razorpay';
import { useFloodlitToast, flMoney } from '../../floodlit/toast';
import { label } from '../../lib/labels';
import { useAuth } from '../../auth/AuthContext';
import { Skeleton } from '../../components/ui/skeleton';

/** Accept a 10-digit Indian mobile, optionally with a +91 / 0 prefix. */
function isValidMobile(raw: string): boolean {
  const digits = raw.replace(/[\s-]/g, '').replace(/^(\+91|0)/, '');
  return /^[6-9]\d{9}$/.test(digits);
}

/** Format an ISO reg-close timestamp for the chalk reg-close line. */
function fmtCloses(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ── Floodlit primitives (inline, local to this page) ─────────────────── */

const fieldStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-2)',
  border: '1px solid var(--line)',
  borderRadius: 11,
  padding: '11px 13px',
  fontSize: 14,
  color: 'var(--chalk)',
  outline: 'none',
};

function FlField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span
        className="fl-mono mb-1.5 block"
        style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--muted)', textTransform: 'uppercase' }}
      >
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={fieldStyle}
      />
      {hint && (
        <span className="mt-1 block" style={{ fontSize: 11, color: 'var(--danger)' }}>
          {hint}
        </span>
      )}
    </label>
  );
}

function Chip({ children, accent }: { children: React.ReactNode; accent?: 'amber' }) {
  return (
    <span
      className="fl-mono"
      style={{
        fontSize: 11,
        padding: '5px 9px',
        borderRadius: 7,
        background: 'var(--surface-2)',
        color: accent === 'amber' ? 'var(--amber)' : 'var(--muted)',
      }}
    >
      {children}
    </span>
  );
}

/** Customer: browse and register for tournaments (PRD §4.7, §5.4). */
export function TournamentsPage() {
  const { flash } = useFloodlitToast();
  const { user } = useAuth();
  const [venueId, setVenueId] = useState('');
  const [team, setTeam] = useState('');
  const [roster, setRoster] = useState('');
  const [name, setName] = useState(user?.name ?? '');
  const [mobile, setMobile] = useState(user?.mobile ?? '');
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
            setMsg(`Registered & paid ${flMoney(res.fee)} — see you on the court!`);
            flash('Registration confirmed');
            tournaments.reload();
          },
        });
        return;
      }

      setMsg(`Registered — pay ${flMoney(res.fee)} (order ${res.razorpayOrderId}).`);
      flash('Registration confirmed');
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
  const sportOf = (gameId: string) => selectedVenue?.games.find((g) => g.id === gameId)?.name;

  const rows = tournaments.data ?? [];

  return (
    <div style={{ padding: '20px 0', animation: 'rise .3s ease' }}>
      <h1 className="fl-display" style={{ fontSize: 30, lineHeight: 1, color: 'var(--chalk)' }}>
        Tournaments
      </h1>
      <p className="mt-1" style={{ fontSize: 13, color: 'var(--muted)' }}>
        Browse &amp; register your team
      </p>

      {/* ── Your details ─────────────────────────────────────────── */}
      <div
        className="mt-5"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 16 }}
      >
        <div
          className="fl-mono mb-4"
          style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}
        >
          Your details
        </div>

        <label className="block">
          <span
            className="fl-mono mb-1.5 block"
            style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--muted)', textTransform: 'uppercase' }}
          >
            Venue
          </span>
          <select value={venueId} onChange={(e) => setVenueId(e.target.value)} style={fieldStyle}>
            {(venues.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FlField label="Captain name" value={name} onChange={setName} />
          <FlField
            label="Mobile"
            type="tel"
            value={mobile}
            onChange={setMobile}
            placeholder="10-digit mobile"
            hint={mobile && !mobileValid ? 'Enter a valid 10-digit mobile number.' : undefined}
          />
          <FlField label="Team (optional)" value={team} onChange={setTeam} />
        </div>

        <label className="mt-3 block">
          <span
            className="fl-mono mb-1.5 block"
            style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--muted)', textTransform: 'uppercase' }}
          >
            Team roster (optional)
          </span>
          <textarea
            value={roster}
            onChange={(e) => setRoster(e.target.value)}
            rows={3}
            placeholder={'One player per line\nAarav Sharma\nMeera Rao'}
            style={{ ...fieldStyle, resize: 'vertical' }}
          />
          <span className="mt-1 block" style={{ fontSize: 11, color: 'var(--faint)' }}>
            For team events — list your players, one per line.
          </span>
        </label>
      </div>

      <div
        className="fl-mono mt-6 mb-3"
        style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}
      >
        Available Tournaments
      </div>

      {tournaments.error ? (
        <div
          style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 24 }}
          className="text-center"
        >
          <p className="fl-display" style={{ fontSize: 18, color: 'var(--chalk)' }}>
            Couldn’t load tournaments
          </p>
          <p className="mt-1" style={{ fontSize: 13, color: 'var(--muted)' }}>
            {tournaments.error}
          </p>
          <button
            onClick={tournaments.reload}
            className="mt-4"
            style={{
              cursor: 'pointer',
              padding: '10px 18px',
              borderRadius: 11,
              fontWeight: 700,
              fontSize: 14,
              border: '1px solid var(--line-strong)',
              background: 'var(--surface-2)',
              color: 'var(--chalk)',
            }}
          >
            Load availability
          </button>
        </div>
      ) : tournaments.loading && !tournaments.data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[220px] w-full rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div
          style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 24 }}
          className="text-center"
        >
          <p className="fl-display" style={{ fontSize: 18, color: 'var(--chalk)' }}>
            No tournaments here yet
          </p>
          <p className="mt-1" style={{ fontSize: 13, color: 'var(--muted)' }}>
            This venue hasn’t scheduled any tournaments. Check back soon or try another venue.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rows.map((t) => {
            const registered = t._count?.participants ?? 0;
            const full = t.capacity != null && registered >= t.capacity;
            const myParticipantId = myEntries[t.id];
            const busy = registering === t.id;
            const closes = fmtCloses(t.regCloseAt);
            return (
              <div
                key={t.id}
                className="flex flex-col"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: 16,
                  overflow: 'hidden',
                }}
              >
                {/* brand-tinted header */}
                <div
                  style={{
                    padding: '14px 16px',
                    background:
                      'linear-gradient(150deg, color-mix(in oklab,var(--brand) 22%, var(--surface)), var(--surface))',
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className="fl-display"
                      style={{ fontSize: 20, lineHeight: 1, color: 'var(--chalk)' }}
                    >
                      {t.name}
                    </div>
                    <span
                      className="fl-mono"
                      style={{ fontSize: 12, fontWeight: 600, color: 'var(--brand)', whiteSpace: 'nowrap' }}
                    >
                      {flMoney(t.fee)}
                    </span>
                  </div>
                  <div className="mt-1.5" style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                    {sportOf(t.gameId) ?? t.gameId} · {selectedVenue?.name ?? ''}
                  </div>
                </div>

                {/* body */}
                <div className="flex flex-1 flex-col" style={{ padding: '14px 16px' }}>
                  <div className="flex flex-wrap" style={{ gap: 7 }}>
                    <Chip>{label(t.format)}</Chip>
                    <Chip>{label(t.regType)}</Chip>
                    <Chip accent="amber">
                      {registered}/{t.capacity}
                    </Chip>
                    <Chip>{label(t.feeBasis)}</Chip>
                  </div>

                  {closes && (
                    <div className="fl-mono mt-2.5" style={{ fontSize: 11.5, color: 'var(--faint)' }}>
                      Registration closes {closes}
                    </div>
                  )}

                  {myParticipantId ? (
                    <div className="mt-auto pt-3 flex flex-col gap-2">
                      <button
                        disabled
                        style={{
                          width: '100%',
                          padding: 13,
                          borderRadius: 11,
                          fontWeight: 700,
                          fontSize: 14,
                          border: '1px solid var(--green)',
                          background: 'color-mix(in oklab, var(--green) 18%, var(--surface))',
                          color: 'var(--green)',
                        }}
                      >
                        Registered ✓
                      </button>
                      <button
                        onClick={() => {
                          setMsg(null);
                          setCancelError(null);
                          setCancelTarget({ id: t.id, name: t.name });
                        }}
                        style={{
                          cursor: 'pointer',
                          width: '100%',
                          padding: 11,
                          borderRadius: 11,
                          fontWeight: 600,
                          fontSize: 13,
                          border: '1px solid var(--line)',
                          background: 'transparent',
                          color: 'var(--muted)',
                        }}
                      >
                        Cancel registration
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => register(t.id)}
                      disabled={full || busy}
                      className="mt-auto"
                      style={{
                        cursor: full || busy ? 'default' : 'pointer',
                        marginTop: 'auto',
                        width: '100%',
                        padding: 13,
                        borderRadius: 11,
                        fontWeight: 700,
                        fontSize: 14,
                        marginBlockStart: 12,
                        border: '1px solid var(--brand)',
                        background: full ? 'var(--surface-2)' : 'var(--brand)',
                        color: full ? 'var(--faint)' : 'var(--on-brand)',
                        opacity: busy ? 0.7 : 1,
                      }}
                    >
                      {full ? 'Tournament full' : busy ? 'Registering…' : 'Register'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {msg && (
        <div
          className="mt-4"
          style={{
            fontSize: 13,
            color: 'var(--muted)',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 11,
            padding: '11px 13px',
          }}
        >
          {msg}
        </div>
      )}

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
          {cancelError && (
            <p style={{ fontSize: 13, color: 'var(--danger)' }}>{cancelError}</p>
          )}
          <DialogFooter>
            <button
              onClick={closeCancel}
              disabled={cancelling}
              style={{
                cursor: 'pointer',
                padding: '10px 16px',
                borderRadius: 11,
                fontWeight: 600,
                fontSize: 14,
                border: '1px solid var(--line)',
                background: 'transparent',
                color: 'var(--chalk)',
              }}
            >
              Keep registration
            </button>
            <button
              onClick={confirmCancel}
              disabled={cancelling}
              style={{
                cursor: 'pointer',
                padding: '10px 16px',
                borderRadius: 11,
                fontWeight: 700,
                fontSize: 14,
                border: '1px solid var(--danger)',
                background: 'var(--danger)',
                color: 'var(--on-brand)',
                opacity: cancelling ? 0.7 : 1,
              }}
            >
              {cancelling ? 'Cancelling…' : 'Cancel registration'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
