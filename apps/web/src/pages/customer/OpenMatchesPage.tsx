import { useState } from 'react';
import { Check, MapPin, Swords, User, Users, X } from 'lucide-react';
import { api, JoinRequest, OpenMatch } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { EmptyState, Msg, useLoad } from '../../components/common';
import { Skeleton } from '../../components/ui/skeleton';
import { flMoney, useFloodlitToast } from '../../floodlit/toast';
import { label, skillRange } from '../../lib/labels';

type TabId = 'browse' | 'mine';

/** Format an open-match time window into a friendly "Sat, 21 Jun · 6:00–7:00 PM". */
function formatWindow(time: OpenMatch['time']): string {
  if (!time) return 'Time TBD';
  const start = new Date(time.startsAt);
  const end = new Date(time.endsAt);
  const day = start.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const t = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${t(start)}–${t(end)}`;
}

/** Pretty-print the perPlayer fee (string|number) as a ₹ amount. */
function perPlayerLabel(fee: OpenMatch['fee']): string {
  const n = typeof fee.perPlayer === 'number' ? fee.perPlayer : Number(fee.perPlayer);
  return Number.isFinite(n) ? flMoney(n) : `₹${fee.perPlayer}`;
}

/** Skill range as a single compact, friendly label. */
function skillLabel(m: OpenMatch): string {
  return skillRange(m.skillMin, m.skillMax);
}

/* --------------------------------------------------------------- primitives */

/** Floodlit mono chip used for spots / skill / settle-mode metadata. */
function Chip({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className="fl-mono"
      style={{
        fontSize: 11,
        padding: '5px 9px',
        borderRadius: 7,
        background: 'var(--surface-2)',
        color: accent ? 'var(--amber)' : 'var(--muted)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

/** Compact meta line (icon + text). */
function Meta({ icon: Icon, children }: { icon: typeof MapPin; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{ fontSize: 12.5, color: 'var(--muted)' }}
    >
      <Icon className="h-4 w-4 shrink-0" style={{ color: 'var(--brand)' }} />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Small uppercase mono section label, matching the design's eyebrow rows. */
function Eyebrow({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      className="fl-mono"
      style={{
        fontSize: 11,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--faint)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Player Open Matches: discover games with open spots and request to join, plus
 * manage matches you host (approve/reject requests, cancel) and track ones
 * you've requested to join. Consumer shell, customer-authed.
 */
export function OpenMatchesPage() {
  const [tab, setTab] = useState<TabId>('browse');
  const [msg, setMsg] = useState<string | null>(null);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const { flash } = useFloodlitToast();
  const { user } = useAuth();

  const browse = useLoad(() => api.listOpenMatches(), []);
  const mine = useLoad(() => api.myOpenMatches(), []);

  // Matches the current user has already requested to join: optimistic local
  // state merged with anything the server already reports under "joined".
  const requestedIds = new Set(requested);
  for (const j of mine.data?.joined ?? []) requestedIds.add(j.match.id);

  const reloadAll = () => {
    browse.reload();
    mine.reload();
  };

  const join = async (id: string) => {
    setMsg(null);
    try {
      await api.joinOpenMatch(id);
      setRequested((prev) => new Set(prev).add(id));
      flash('Request sent · pending');
      setMsg('Request sent — the host will review it shortly.');
      reloadAll();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const approve = async (matchId: string, requestId: string) => {
    setMsg(null);
    try {
      await api.approveJoinRequest(matchId, requestId);
      flash('Player approved');
      setMsg('Player approved.');
      reloadAll();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const reject = async (matchId: string, requestId: string) => {
    setMsg(null);
    try {
      await api.rejectJoinRequest(matchId, requestId);
      flash('Request rejected');
      setMsg('Request rejected.');
      reloadAll();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const cancel = async (id: string) => {
    setMsg(null);
    try {
      await api.cancelOpenMatch(id);
      flash('Match cancelled');
      setMsg('Match cancelled.');
      reloadAll();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="fl-display" style={{ fontWeight: 800, fontSize: 28, lineHeight: 1 }}>
            Open matches
          </h1>
          <p style={{ fontSize: 12.5, color: 'var(--faint)', marginTop: 4 }}>
            Join a game near you, or open spare spots from your booking.
          </p>
        </div>

        <div
          className="inline-flex shrink-0"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 11,
            padding: 3,
          }}
        >
          {([
            { id: 'browse', label: 'Browse', icon: Swords },
            { id: 'mine', label: 'My matches', icon: Users },
          ] as { id: TabId; label: string; icon: typeof Swords }[]).map((t) => {
            const active = tab === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className="fl-mono inline-flex items-center gap-1.5"
                style={{
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: active ? 'var(--brand)' : 'transparent',
                  color: active ? 'var(--on-brand)' : 'var(--muted)',
                }}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <Msg text={msg} />
      </div>

      <div className="mt-5">
        {tab === 'browse' ? (
          <BrowseTab
            matches={browse.data}
            loading={browse.loading}
            error={browse.error}
            currentUserId={user?.id ?? null}
            requestedIds={requestedIds}
            onJoin={join}
          />
        ) : (
          <MineTab
            data={mine.data}
            loading={mine.loading}
            error={mine.error}
            onApprove={approve}
            onReject={reject}
            onCancel={cancel}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Browse */

function BrowseTab({
  matches,
  loading,
  error,
  currentUserId,
  requestedIds,
  onJoin,
}: {
  matches: OpenMatch[] | null;
  loading: boolean;
  error: string | null;
  currentUserId: string | null;
  requestedIds: Set<string>;
  onJoin: (id: string) => void;
}) {
  if (loading && !matches) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-52 w-full rounded-2xl" />
        ))}
      </div>
    );
  }
  if (error) return <Msg text={error} />;
  if (!matches || matches.length === 0) {
    return (
      <EmptyCard
        title="No open matches right now"
        hint="When players open up spots in their bookings, they’ll show up here to join."
      />
    );
  }

  return (
    <div>
      <Eyebrow style={{ letterSpacing: '0.1em', margin: '0 0 12px' }}>Games near you</Eyebrow>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {matches.map((m) => {
          const full = m.spots.remaining <= 0;
          const own = currentUserId != null && m.host.id === currentUserId;
          const requested = requestedIds.has(m.id);
          return (
            <MatchCard
              key={m.id}
              match={m}
              footer={
                own ? (
                  <OwnMatchTag />
                ) : (
                  <JoinButton
                    full={full}
                    requested={requested}
                    label={
                      requested
                        ? 'Request sent · pending'
                        : full
                          ? 'Match full'
                          : 'Request to join'
                    }
                    onClick={() => onJoin(m.id)}
                  />
                )
              }
            />
          );
        })}
      </div>
    </div>
  );
}

/** The full-width join CTA with Floodlit border/fill states. */
function JoinButton({
  full,
  requested = false,
  label,
  onClick,
}: {
  full: boolean;
  requested?: boolean;
  label: string;
  onClick: () => void;
}) {
  const disabled = full || requested;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        width: '100%',
        padding: 12,
        borderRadius: 11,
        fontWeight: 700,
        fontSize: 14,
        border: disabled ? '1px solid var(--line-strong)' : '1px solid var(--amber)',
        background: disabled ? 'var(--surface-2)' : 'var(--amber)',
        color: disabled ? (requested ? 'var(--amber)' : 'var(--faint)') : 'var(--on-amber)',
        opacity: full ? 0.7 : 1,
      }}
    >
      {label}
    </button>
  );
}

/** Non-interactive footer shown on a match the current user hosts. */
function OwnMatchTag() {
  return (
    <div
      className="fl-mono"
      style={{
        width: '100%',
        textAlign: 'center',
        padding: 12,
        borderRadius: 11,
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        border: '1px solid var(--brand)',
        background: 'color-mix(in oklab, var(--brand) 14%, var(--surface))',
        color: 'var(--brand)',
      }}
    >
      Your match · manage in My matches
    </div>
  );
}

/* -------------------------------------------------------------------- Mine */

type MineData = {
  hosting: (OpenMatch & { pendingRequests: JoinRequest[] })[];
  joined: {
    requestId: string;
    status: JoinRequest['status'];
    requestedAt: string;
    match: OpenMatch;
  }[];
};

const STATUS_LABEL: Record<JoinRequest['status'], string> = {
  REQUESTED: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

function MineTab({
  data,
  loading,
  error,
  onApprove,
  onReject,
  onCancel,
}: {
  data: MineData | null;
  loading: boolean;
  error: string | null;
  onApprove: (matchId: string, requestId: string) => void;
  onReject: (matchId: string, requestId: string) => void;
  onCancel: (id: string) => void;
}) {
  if (loading && !data) {
    return (
      <div className="grid gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-44 w-full rounded-2xl" />
        ))}
      </div>
    );
  }
  if (error) return <Msg text={error} />;
  if (!data) return null;

  const empty = data.hosting.length === 0 && data.joined.length === 0;
  if (empty) {
    return (
      <EmptyCard
        title="You’re not in any matches yet"
        hint="Open spots on a booking to host a match, or join one from the Browse tab."
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Hosting */}
      <section>
        <Eyebrow style={{ marginBottom: 12 }}>Your hosted matches</Eyebrow>
        {data.hosting.length === 0 ? (
          <EmptyCard
            title="Not hosting any matches"
            hint="When you open spots on a booking, they’ll appear here for you to manage."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {data.hosting.map((m) => (
              <HostedMatchCard
                key={m.id}
                match={m}
                onApprove={onApprove}
                onReject={onReject}
                onCancel={onCancel}
              />
            ))}
          </div>
        )}
      </section>

      {/* Joined & requested */}
      <section>
        <Eyebrow style={{ marginBottom: 12 }}>Joined &amp; requested</Eyebrow>
        {data.joined.length === 0 ? (
          <EmptyCard
            title="No join requests yet"
            hint="Head to Browse and request to join an open match."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.joined.map((j) => (
              <MatchCard
                key={j.requestId}
                match={j.match}
                footer={
                  <div className="flex items-center justify-between gap-2">
                    <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>
                      Requested {new Date(j.requestedAt).toLocaleDateString()}
                    </span>
                    <span
                      className="fl-mono"
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '4px 9px',
                        borderRadius: 7,
                        background:
                          j.status === 'APPROVED'
                            ? 'var(--brand)'
                            : j.status === 'REJECTED'
                              ? 'var(--surface-2)'
                              : 'var(--surface-2)',
                        color:
                          j.status === 'APPROVED'
                            ? 'var(--on-brand)'
                            : j.status === 'REJECTED'
                              ? 'var(--danger)'
                              : 'var(--amber)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {STATUS_LABEL[j.status]}
                    </span>
                  </div>
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------- Hosted match card */

/** The highlighted host card: match summary + approve/reject request rows. */
function HostedMatchCard({
  match: m,
  onApprove,
  onReject,
  onCancel,
}: {
  match: OpenMatch & { pendingRequests: JoinRequest[] };
  onApprove: (matchId: string, requestId: string) => void;
  onReject: (matchId: string, requestId: string) => void;
  onCancel: (id: string) => void;
}) {
  const venue = m.venue?.name ?? 'Venue';
  const game = m.game?.name ?? 'Open match';

  return (
    <div
      style={{
        background:
          'linear-gradient(150deg, color-mix(in oklab, var(--brand) 14%, var(--surface)), var(--surface))',
        border: '1px solid var(--brand)',
        borderRadius: 14,
        padding: 15,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="fl-display" style={{ fontWeight: 700, fontSize: 17, textTransform: 'uppercase' }}>
          {game}
        </div>
        <span
          className="fl-mono"
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '4px 8px',
            borderRadius: 6,
            background: 'var(--brand)',
            color: 'var(--on-brand)',
            whiteSpace: 'nowrap',
          }}
        >
          {m.spots.remaining > 0
            ? `${m.spots.remaining} spot${m.spots.remaining === 1 ? '' : 's'} left`
            : 'Full'}
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 5 }}>
        {venue} · {formatWindow(m.time)} · Skill {skillLabel(m)}
      </div>

      <Eyebrow style={{ marginTop: 12, letterSpacing: '0.08em' }}>Requests to join</Eyebrow>

      {m.pendingRequests.length === 0 ? (
        <p style={{ fontSize: 12.5, color: 'var(--faint)', marginTop: 8 }}>
          No pending requests.
        </p>
      ) : (
        <div className="flex flex-col gap-2" style={{ marginTop: 8 }}>
          {m.pendingRequests.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-2.5"
              style={{
                padding: '10px 12px',
                background: 'var(--bg-2)',
                border: '1px solid var(--line)',
                borderRadius: 10,
              }}
            >
              <span
                className="fl-display grid place-items-center shrink-0"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  background: 'var(--surface-2)',
                  color: 'var(--brand)',
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {(r.player.name ?? 'P').charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate" style={{ fontSize: 13, fontWeight: 600 }}>
                  {r.player.name ?? 'Player'}
                </div>
              </div>
              <button
                type="button"
                disabled={m.spots.remaining <= 0}
                onClick={() => onApprove(m.id, r.id)}
                className="inline-flex items-center gap-1"
                style={{
                  cursor: m.spots.remaining <= 0 ? 'not-allowed' : 'pointer',
                  background: 'var(--brand)',
                  color: 'var(--on-brand)',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: 12,
                  padding: '7px 12px',
                  borderRadius: 8,
                  opacity: m.spots.remaining <= 0 ? 0.5 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                <Check className="h-3.5 w-3.5" /> Approve
              </button>
              <button
                type="button"
                aria-label="Reject request"
                onClick={() => onReject(m.id, r.id)}
                className="inline-flex items-center justify-center"
                style={{
                  cursor: 'pointer',
                  background: 'transparent',
                  border: '1px solid var(--line-strong)',
                  color: 'var(--muted)',
                  fontSize: 14,
                  padding: '6px 10px',
                  borderRadius: 8,
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => onCancel(m.id)}
        style={{
          cursor: 'pointer',
          marginTop: 14,
          width: '100%',
          padding: 11,
          borderRadius: 11,
          fontWeight: 700,
          fontSize: 13,
          background: 'transparent',
          border: '1px solid var(--line-strong)',
          color: 'var(--danger)',
        }}
      >
        Cancel match
      </button>
    </div>
  );
}

/* ------------------------------------------------------------- Match card */

function MatchCard({
  match,
  footer,
}: {
  match: OpenMatch;
  footer: React.ReactNode;
}) {
  const venue = match.venue?.name ?? 'Venue';
  const court = match.court?.name;
  const game = match.game?.name;
  const full = match.spots.remaining <= 0;

  return (
    <div
      className="relative flex flex-col"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 14,
        padding: 15,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="fl-display truncate" style={{ fontWeight: 700, fontSize: 17, textTransform: 'uppercase' }}>
            {game ?? 'Open match'}
          </h3>
          <p className="line-clamp-2" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
            {venue}
            {court ? ` · ${court}` : ''} · {formatWindow(match.time)}
          </p>
        </div>
        <span
          className="fl-mono"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--brand)',
            whiteSpace: 'nowrap',
          }}
        >
          {perPlayerLabel(match.fee)}
        </span>
      </div>

      {/* Chips: spots / skill / settle-mode */}
      <div className="flex flex-wrap gap-1.5" style={{ marginTop: 10 }}>
        <Chip>
          {full
            ? 'Full'
            : `${match.spots.remaining} spot${match.spots.remaining === 1 ? '' : 's'} left`}
        </Chip>
        <Chip>Skill {skillLabel(match)}</Chip>
        <Chip>{label(match.fee.repaymentMode)}</Chip>
      </div>

      {/* Secondary meta */}
      <div className="mt-3 grid gap-1.5">
        {match.venue?.city && <Meta icon={MapPin}>{match.venue.city}</Meta>}
        <Meta icon={User}>Hosted by {match.host.name ?? 'Player'}</Meta>
        <Meta icon={Users}>
          {match.spots.filled}/{match.spots.total} players in
        </Meta>
      </div>

      <div style={{ marginTop: 13 }}>{footer}</div>
    </div>
  );
}

/* ----------------------------------------------------------- Empty state */

function EmptyCard({ title, hint }: { title: string; hint: string }) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '34px 22px',
        background: 'var(--surface)',
        border: '1px dashed var(--line-strong)',
        borderRadius: 16,
      }}
    >
      <EmptyState title={title} hint={hint} />
    </div>
  );
}
