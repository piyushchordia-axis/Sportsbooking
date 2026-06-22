import { type ReactNode, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ChevronRight,
  Clock,
  Gift,
  MapPin,
  Plus,
  Repeat2,
  Search,
  Swords,
  Trophy,
  Wallet,
} from 'lucide-react';
import { type DiscoverVenue } from '../../api/client';
import { EmptyState, ImageWithFallback, SportIcon } from '../../components/common';
import { Button } from '../../components/ui/button';
import { FALLBACK_VENUE_PHOTO, HERO_IMAGE, venuePhoto } from '../../lib/imagery';
import { useStorefront } from '../../storefront/StorefrontProvider';

const inr = new Intl.NumberFormat('en-IN');
const DEFAULT_SPORTS = ['Turf football', 'Box cricket', 'Pickleball', 'Badminton'];

/** "from ₹800" — lowest configured hourly rate, or null when unpriced. */
function fromPrice(v: DiscoverVenue): string | null {
  return v.minPrice != null ? `₹${inr.format(Math.round(v.minPrice))}` : null;
}

/** "Mon, 22 Jun" — today, for the floodlit board header. */
function todayLabel(): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(new Date());
}

/* ───────────────────────────── Floodlit slot board ─────────────────────────
 * The signature element: a stadium-scoreboard of tonight's grounds near you.
 * The timeline ticks are an ambient motif; each venue row is a real launcher
 * into that ground, where live per-court availability resolves.
 * ─────────────────────────────────────────────────────────────────────────── */
function LiveBoard({
  venues,
  loading,
  label,
}: {
  venues: DiscoverVenue[];
  loading: boolean;
  label: string;
}) {
  const rows = venues.slice(0, 4);
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/12 bg-[oklch(0.17_0.022_168)]/85 shadow-2xl shadow-black/40 backdrop-blur-md">
      <span className="flood-sweep" aria-hidden />
      <div className="relative">
        {/* Board header */}
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="relative grid h-2.5 w-2.5 place-items-center">
              <span className="live-dot absolute inset-0 rounded-full bg-accent" />
            </span>
            <span className="ff-display text-sm font-extrabold uppercase tracking-[0.18em] text-white">
              {label}
            </span>
          </div>
          <span className="ff-score text-xs text-white/55">{todayLabel()}</span>
        </div>

        {/* Ambient prime-time timeline */}
        <div className="flex items-center gap-1.5 px-5 pt-4">
          {['17', '18', '19', '20', '21', '22'].map((h, i) => (
            <span
              key={h}
              className={`ff-score flex-1 rounded-md py-1 text-center text-[11px] ${
                i >= 1 && i <= 4
                  ? 'bg-accent/15 text-accent'
                  : 'bg-white/5 text-white/40'
              }`}
            >
              {h}
            </span>
          ))}
        </div>
        <p className="px-5 pb-3 pt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
          Prime time near you · tap a ground to pick a slot
        </p>

        {/* Venue rows */}
        <div className="px-2.5 pb-3">
          {loading && rows.length === 0
            ? Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="mx-2.5 my-1 h-16 animate-pulse rounded-xl bg-white/5"
                />
              ))
            : rows.map((v) => (
                <Link
                  key={v.id}
                  to={`/venue/${v.id}`}
                  className="group flex items-center gap-3.5 rounded-xl px-3 py-3 transition-colors hover:bg-white/[0.06]"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[0.06] ring-1 ring-white/10">
                    <SportIcon name={v.games[0]?.name} className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-white">{v.name}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-white/50">
                      {v.city && (
                        <>
                          <MapPin className="h-3 w-3 shrink-0" /> {v.city}
                          <span className="text-white/25">·</span>
                        </>
                      )}
                      <Clock className="h-3 w-3 shrink-0" /> till {v.closeTime}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {fromPrice(v) && (
                      <p className="ff-score text-sm font-bold text-accent">
                        {fromPrice(v)}
                      </p>
                    )}
                    <p className="text-[10px] uppercase tracking-wider text-white/35">
                      per hr
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-white/30 transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                </Link>
              ))}
          {!loading && rows.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-white/45">
              New grounds are lighting up soon.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Ground card ──────────────────────────────── */
function GroundCard({ venue }: { venue: DiscoverVenue }) {
  const price = fromPrice(venue);
  return (
    <Link
      to={`/venue/${venue.id}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-muted">
        <ImageWithFallback
          src={venuePhoto({ photos: venue.photos, games: venue.games })}
          fallback={FALLBACK_VENUE_PHOTO}
          alt={venue.name}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
        {price && (
          <span className="ff-score absolute left-3 top-3 rounded-lg bg-accent px-2.5 py-1 text-xs font-bold text-accent-foreground shadow-lg">
            from {price}
          </span>
        )}
        <div className="absolute inset-x-3 bottom-3">
          <h3 className="ff-display truncate text-lg font-extrabold leading-tight text-white drop-shadow">
            {venue.name}
          </h3>
          {venue.city && (
            <p className="mt-0.5 flex items-center gap-1 text-sm text-white/80">
              <MapPin className="h-3.5 w-3.5 shrink-0" /> {venue.city}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        {venue.games.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {venue.games.slice(0, 4).map((g) => (
              <span
                key={g.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
              >
                <SportIcon name={g.name} className="h-3.5 w-3.5" />
                {g.name}
              </span>
            ))}
          </div>
        )}
        <p className="mt-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" /> Open {venue.openTime}–{venue.closeTime}
        </p>
      </div>
    </Link>
  );
}

/* ───────────────────────────── Section eyebrow ──────────────────────────── */
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="ff-score text-xs font-bold uppercase tracking-[0.22em] text-primary">
      {children}
    </p>
  );
}

export function LandingPage() {
  const { scoped, ownerName, ownerLogo, venues, loading } = useStorefront();
  const [sport, setSport] = useState<string>('All');

  // Distinct sports across the (scoped or marketplace) grounds.
  const sports = useMemo(() => {
    const seen = new Map<string, string>();
    for (const v of venues)
      for (const g of v.games) {
        const k = g.name.toLowerCase();
        if (!seen.has(k)) seen.set(k, g.name);
      }
    const found = Array.from(seen.values());
    return found.length ? found.slice(0, 8) : DEFAULT_SPORTS;
  }, [venues]);

  const filtered = useMemo(() => {
    if (sport === 'All') return venues;
    return venues.filter((v) =>
      v.games.some((g) => g.name.toLowerCase() === sport.toLowerCase()),
    );
  }, [venues, sport]);

  const featured = filtered.slice(0, 6);
  const boardLabel = scoped && ownerName ? ownerName : 'Tonight';

  return (
    <div className="flex flex-col">
      {/* ───────────────────────── HERO (forced floodlit night) ───────────────── */}
      <section className="relative isolate overflow-hidden text-white">
        {/* Pitch backdrop: night gradient + faint turf photo + painted lines */}
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              'linear-gradient(158deg in oklab, oklch(0.29 0.072 176) 0%, oklch(0.21 0.046 173) 32%, oklch(0.16 0.022 166) 64%, oklch(0.123 0.013 160) 100%)',
          }}
        />
        <ImageWithFallback
          src={scoped ? venuePhoto({ games: venues[0]?.games }) : HERO_IMAGE}
          fallback={FALLBACK_VENUE_PHOTO}
          alt=""
          className="absolute inset-0 -z-10 h-full w-full object-cover opacity-[0.16] mix-blend-luminosity"
        />
        <div
          className="pitch-lines absolute inset-0 -z-10 opacity-50"
          aria-hidden
          style={{
            maskImage: 'radial-gradient(120% 90% at 70% 0%, black 35%, transparent 80%)',
            WebkitMaskImage:
              'radial-gradient(120% 90% at 70% 0%, black 35%, transparent 80%)',
          }}
        />
        {/* Floodlamp glows */}
        <div
          className="pointer-events-none absolute -top-24 left-[8%] -z-10 h-72 w-72 rounded-full bg-accent/25 blur-[130px]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -top-28 right-[12%] -z-10 h-80 w-80 rounded-full bg-primary/25 blur-[140px]"
          aria-hidden
        />

        <div className="mx-auto grid max-w-[80rem] grid-cols-1 items-center gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.05fr_0.95fr] lg:py-28">
          {/* Copy column */}
          <div className="min-w-0 animate-in fade-in slide-in-from-bottom-3 duration-700">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 backdrop-blur">
              {scoped && ownerLogo ? (
                <img
                  src={ownerLogo}
                  alt=""
                  className="h-4 w-4 rounded-sm object-contain"
                />
              ) : (
                <span className="relative grid h-2 w-2 place-items-center">
                  <span className="live-dot absolute inset-0 rounded-full bg-accent" />
                </span>
              )}
              <span className="ff-score text-xs font-bold uppercase tracking-[0.18em] text-white/80">
                {scoped ? ownerName : 'Live near you'}
              </span>
            </span>

            <h1 className="ff-display mt-6 text-[2.15rem] font-extrabold leading-[0.98] tracking-tight sm:text-5xl lg:text-[4.25rem]">
              {scoped ? (
                <>
                  Book your court
                  <br />
                  <span className="text-accent">at {ownerName}.</span>
                </>
              ) : (
                <>
                  Find your ground.
                  <br />
                  <span className="text-accent">Play tonight.</span>
                </>
              )}
            </h1>

            <p className="mt-5 max-w-lg text-lg leading-relaxed text-white/65">
              {scoped
                ? `Live availability across ${ownerName}'s grounds. Pick a slot, pay your way, and just show up — no calls, no waiting.`
                : 'Live availability for turf, box cricket, pickleball and badminton near you. Pick a slot, pay your way, and just show up — no calls, no waiting.'}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="xl">
                <Link to="/browse">
                  <Search className="h-4 w-4" /> Find a ground
                </Link>
              </Button>
              <Link
                to="/login"
                className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/20 px-6 text-base font-semibold text-white transition-colors hover:border-accent/50 hover:bg-white/[0.06]"
              >
                Join with your number <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {/* Sport quick-pick */}
            <div className="mt-9">
              <p className="ff-score text-[11px] font-bold uppercase tracking-[0.2em] text-white/40">
                Jump to your game
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {sports.map((s) => (
                  <Link
                    key={s}
                    to="/browse"
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.04] px-3.5 py-1.5 text-sm font-medium text-white/85 backdrop-blur transition-colors hover:border-accent/50 hover:text-white"
                  >
                    <SportIcon name={s} className="h-4 w-4" />
                    {s}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* Signature board */}
          <div className="min-w-0 animate-in fade-in slide-in-from-bottom-4 duration-700 lg:[animation-delay:120ms]">
            <LiveBoard venues={venues} loading={loading} label={boardLabel} />
          </div>
        </div>
      </section>

      {/* ───────────────────────── GROUNDS NEAR YOU ──────────────────────────── */}
      <section className="mx-auto w-full max-w-[80rem] px-4 py-16 sm:px-6 sm:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>Grounds</Eyebrow>
            <h2 className="ff-display mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              {scoped ? `Play at ${ownerName}` : 'Grounds near you'}
            </h2>
          </div>
          <Button asChild variant="ghost">
            <Link to="/browse">
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        {/* Sport filter */}
        <div className="hide-scrollbar mt-6 flex gap-2 overflow-x-auto pb-1">
          {['All', ...sports].map((s) => {
            const on = s === sport;
            return (
              <button
                key={s}
                onClick={() => setSport(s)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  on
                    ? 'border-primary/40 bg-primary/12 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground'
                }`}
              >
                {s !== 'All' && <SportIcon name={s} className="h-4 w-4" />}
                {s}
              </button>
            );
          })}
        </div>

        <div className="mt-8">
          {loading && featured.length === 0 ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-72 animate-pulse rounded-2xl border border-border bg-card"
                />
              ))}
            </div>
          ) : featured.length === 0 ? (
            <EmptyState
              title={sport === 'All' ? 'No grounds listed yet' : `No ${sport} grounds yet`}
              hint="Try another sport, or check back soon — new venues are added all the time."
            />
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {featured.map((v) => (
                <GroundCard key={v.id} venue={v} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ───────────────────────── OPEN MATCHES ──────────────────────────────── */}
      <section className="border-y border-border bg-muted/30">
        <div className="mx-auto grid w-full max-w-[80rem] grid-cols-1 items-center gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2">
          <div className="min-w-0">
            <Eyebrow>Open matches</Eyebrow>
            <h2 className="ff-display mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              Two short? Find your four.
            </h2>
            <p className="mt-4 max-w-md text-muted-foreground">
              Book a slot and open the spare spots. Players near you request to join,
              you approve who's in, and skill levels keep the game even. The
              fix for every &ldquo;we need a 4th&rdquo; group chat.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link to="/open-matches">
                  See open matches <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <span className="text-sm text-muted-foreground">
                Sign in with your number to host or join.
              </span>
            </div>
          </div>

          {/* Roster motif */}
          <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Swords className="h-4 w-4 text-primary" />
                <span className="ff-display font-bold text-foreground">
                  Pickleball · 7:30 PM
                </span>
              </div>
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                2 spots open
              </span>
            </div>
            <div className="mt-5 grid grid-cols-4 gap-3">
              {['AR', 'SK'].map((p) => (
                <div key={p} className="flex flex-col items-center gap-1.5">
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/15 text-sm font-bold text-primary ring-1 ring-primary/30">
                    {p}
                  </span>
                  <span className="text-[11px] text-muted-foreground">In</span>
                </div>
              ))}
              {[0, 1].map((i) => (
                <div key={i} className="flex flex-col items-center gap-1.5">
                  <span className="grid h-12 w-12 place-items-center rounded-full border border-dashed border-primary/40 text-primary/70">
                    <Plus className="h-5 w-5" />
                  </span>
                  <span className="text-[11px] text-primary">Open</span>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between rounded-xl bg-muted/60 px-3.5 py-2.5 text-xs text-muted-foreground">
              <span>Skill: Intermediate</span>
              <span className="ff-score text-foreground">Smash Arena · Indiranagar</span>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────── PACKS & LOYALTY ───────────────────────────── */}
      <section className="mx-auto w-full max-w-[80rem] px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <Eyebrow>Play more, pay less</Eyebrow>
          <h2 className="ff-display mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Regulars get rewarded.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Prepay a pack, earn on every game, and bring your crew along — the more
            you play, the less each game costs.
          </p>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
          {[
            {
              icon: Wallet,
              title: 'Session packs',
              desc: 'Buy ten plays up front at a lower rate. Sessions load to your wallet and cover your bookings automatically.',
            },
            {
              icon: Gift,
              title: 'Loyalty credit',
              desc: 'Earn credit on every booking and spend, then redeem it straight against your next slot.',
            },
            {
              icon: Repeat2,
              title: 'Refer & earn',
              desc: 'Share your code. When a friend plays their first paid game, you both get credit.',
            },
          ].map((c) => (
            <div
              key={c.title}
              className="relative overflow-hidden rounded-2xl border border-border bg-card p-6"
            >
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/12 text-primary">
                <c.icon className="h-6 w-6" />
              </span>
              <h3 className="ff-display mt-4 text-lg font-bold text-foreground">
                {c.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {c.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ───────────────────────── TOURNAMENTS ───────────────────────────────── */}
      <section className="border-t border-border bg-muted/30">
        <div className="mx-auto grid w-full max-w-[80rem] grid-cols-1 items-center gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2">
          <div className="order-2 min-w-0 rounded-3xl border border-border bg-card p-7 shadow-sm lg:order-1">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-accent" />
              <span className="ff-display font-bold text-foreground">
                Weekend Cup · Box cricket
              </span>
            </div>
            <div className="mt-5 space-y-2.5">
              {[
                ['Quarter-final', 'Sat 6:00 PM'],
                ['Semi-final', 'Sat 8:00 PM'],
                ['Final', 'Sun 7:00 PM'],
              ].map(([round, when], i) => (
                <div
                  key={round}
                  className="flex items-center justify-between rounded-xl border border-border bg-background/60 px-4 py-3"
                >
                  <span className="flex items-center gap-3">
                    <span className="ff-score text-xs text-muted-foreground">
                      0{i + 1}
                    </span>
                    <span className="font-semibold text-foreground">{round}</span>
                  </span>
                  <span className="ff-score text-sm text-muted-foreground">{when}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <Eyebrow>Compete</Eyebrow>
            <h2 className="ff-display mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              Cups & leagues, run right.
            </h2>
            <p className="mt-4 max-w-md text-muted-foreground">
              Enter solo or bring a team. Pay your entry online, track fixtures and
              results, and let the bracket sort out who's actually the best in the
              neighbourhood.
            </p>
            <div className="mt-7">
              <Button asChild size="lg">
                <Link to="/tournaments">
                  Browse tournaments <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────── FINAL CTA ─────────────────────────────────── */}
      <section className="mx-auto w-full max-w-[80rem] px-4 py-16 sm:px-6 sm:py-20">
        <div className="relative isolate overflow-hidden rounded-[1.75rem] px-6 py-16 text-center text-white sm:px-12">
          <div
            className="absolute inset-0 -z-10"
            style={{
              background:
                'linear-gradient(135deg in oklab, oklch(0.3 0.075 176) 0%, oklch(0.19 0.035 170) 100%)',
            }}
          />
          <div
            className="pitch-lines absolute inset-0 -z-10 opacity-40"
            aria-hidden
            style={{
              maskImage: 'radial-gradient(80% 120% at 50% 0%, black, transparent 75%)',
              WebkitMaskImage:
                'radial-gradient(80% 120% at 50% 0%, black, transparent 75%)',
            }}
          />
          <div
            className="pointer-events-none absolute -top-20 left-1/2 -z-10 h-64 w-64 -translate-x-1/2 rounded-full bg-accent/30 blur-[120px]"
            aria-hidden
          />
          <h2 className="ff-display mx-auto max-w-2xl text-3xl font-extrabold tracking-tight sm:text-5xl">
            {scoped ? `Your game at ${ownerName} is on.` : 'Your game is waiting.'}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-white/65">
            Find a ground, lock the slot, and round up the crew — all from your phone,
            in the time it takes to read this.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="xl">
              <Link to="/browse">
                Find a ground <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Link
              to="/login"
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/20 px-6 text-base font-semibold text-white transition-colors hover:border-accent/50 hover:bg-white/[0.06]"
            >
              Join free
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
