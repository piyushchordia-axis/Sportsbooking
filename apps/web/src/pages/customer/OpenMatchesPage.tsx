import { useState } from 'react';
import {
  Calendar,
  Check,
  Clock,
  MapPin,
  Swords,
  Trophy,
  User,
  Users,
  X,
} from 'lucide-react';
import { api, JoinRequest, OpenMatch } from '../../api/client';
import {
  Card,
  EmptyState,
  Msg,
  PageHeader,
  StatusPill,
  Tabs,
  useLoad,
} from '../../components/common';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';

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

/** Compact meta line (icon + text) used inside match cards. */
function Meta({ icon: Icon, children }: { icon: typeof MapPin; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0 text-primary/80" />
      <span className="truncate">{children}</span>
    </span>
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

  const browse = useLoad(() => api.listOpenMatches(), []);
  const mine = useLoad(() => api.myOpenMatches(), []);

  const reloadAll = () => {
    browse.reload();
    mine.reload();
  };

  const join = async (id: string) => {
    setMsg(null);
    try {
      await api.joinOpenMatch(id);
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
      setMsg('Match cancelled.');
      reloadAll();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="container">
      <PageHeader
        title="Open matches"
        subtitle="Find players, fill open spots and join games near you."
        badge={<StatusPill status="open">Find players</StatusPill>}
        action={
          <Tabs<TabId>
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'browse', label: 'Browse', icon: Swords },
              { id: 'mine', label: 'My matches', icon: Users },
            ]}
          />
        }
      />

      <Msg text={msg} />

      {tab === 'browse' ? (
        <BrowseTab
          matches={browse.data}
          loading={browse.loading}
          error={browse.error}
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
  );
}

/* ------------------------------------------------------------------ Browse */

function BrowseTab({
  matches,
  loading,
  error,
  onJoin,
}: {
  matches: OpenMatch[] | null;
  loading: boolean;
  error: string | null;
  onJoin: (id: string) => void;
}) {
  if (loading && !matches) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-44 w-full rounded-2xl" />
        ))}
      </div>
    );
  }
  if (error) return <Msg text={error} />;
  if (!matches || matches.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No open matches right now"
          hint="When players open up spots in their bookings, they’ll show up here to join."
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {matches.map((m) => (
        <MatchCard
          key={m.id}
          match={m}
          footer={
            <Button
              size="sm"
              className="w-full"
              disabled={m.spots.remaining <= 0}
              onClick={() => onJoin(m.id)}
            >
              {m.spots.remaining <= 0 ? 'Match full' : 'Request to join'}
            </Button>
          }
        />
      ))}
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
      <Card>
        <EmptyState
          title="You’re not in any matches yet"
          hint="Open spots on a booking to host a match, or join one from the Browse tab."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card title="Hosting" subtitle="Matches you opened — review join requests." topAccent="primary">
        {data.hosting.length === 0 ? (
          <EmptyState
            title="Not hosting any matches"
            hint="When you open spots on a booking, they’ll appear here for you to manage."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {data.hosting.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                footer={
                  <div className="space-y-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                        Pending requests
                      </p>
                      {m.pendingRequests.length === 0 ? (
                        <p className="mt-1.5 text-sm text-muted-foreground">
                          No pending requests.
                        </p>
                      ) : (
                        <ul className="mt-2 space-y-2">
                          {m.pendingRequests.map((r) => (
                            <li
                              key={r.id}
                              className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 p-2.5"
                            >
                              <span className="inline-flex items-center gap-2 min-w-0 text-sm font-medium">
                                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                                  <User className="h-3.5 w-3.5" />
                                </span>
                                <span className="truncate">{r.player.name ?? 'Player'}</span>
                              </span>
                              <span className="flex shrink-0 items-center gap-1.5">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={m.spots.remaining <= 0}
                                  onClick={() => onApprove(m.id, r.id)}
                                >
                                  <Check className="h-3.5 w-3.5" /> Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => onReject(m.id, r.id)}
                                >
                                  <X className="h-3.5 w-3.5" /> Reject
                                </Button>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="w-full"
                      onClick={() => onCancel(m.id)}
                    >
                      Cancel match
                    </Button>
                  </div>
                }
              />
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Joined & requested"
        subtitle="Matches you’ve asked to join and their status."
        topAccent="blue"
      >
        {data.joined.length === 0 ? (
          <EmptyState
            title="No join requests yet"
            hint="Head to Browse and request to join an open match."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {data.joined.map((j) => (
              <MatchCard
                key={j.requestId}
                match={j.match}
                footer={
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      Requested {new Date(j.requestedAt).toLocaleDateString()}
                    </span>
                    <StatusPill status={j.status} />
                  </div>
                }
              />
            ))}
          </div>
        )}
      </Card>
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

  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
              <Swords className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <h3 className="font-display font-semibold text-base leading-tight truncate">
                {game ?? 'Open match'}
              </h3>
              <p className="text-xs text-muted-foreground truncate">
                {venue}
                {court ? ` · ${court}` : ''}
              </p>
            </div>
          </div>
        </div>
        <StatusPill status={match.spots.remaining > 0 ? 'open' : 'full'}>
          {match.spots.remaining > 0
            ? `${match.spots.remaining} spot${match.spots.remaining === 1 ? '' : 's'} left`
            : 'Full'}
        </StatusPill>
      </div>

      <div className="mt-4 grid gap-2">
        <Meta icon={Calendar}>{formatWindow(match.time)}</Meta>
        {match.venue?.city && <Meta icon={MapPin}>{match.venue.city}</Meta>}
        <Meta icon={User}>Hosted by {match.host.name ?? 'Player'}</Meta>
        <Meta icon={Users}>
          {match.spots.filled}/{match.spots.total} players in
        </Meta>
        <Meta icon={Trophy}>
          Skill {match.skillMin}
          {match.skillMax && match.skillMax !== match.skillMin ? `–${match.skillMax}` : ''}
        </Meta>
        <Meta icon={Clock}>₹{match.fee.perPlayer} per player</Meta>
      </div>

      <div className="mt-4 border-t border-border pt-4">{footer}</div>
    </div>
  );
}
