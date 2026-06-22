import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';
import { type DiscoverVenue } from '../../api/client';
import { ImageWithFallback, SportIcon } from '../../components/common';
import { FALLBACK_VENUE_PHOTO, venuePhoto } from '../../lib/imagery';
import { useStorefront } from '../../storefront/StorefrontProvider';
import { flMoney } from '../../floodlit/toast';

/* ──────────────────────────────────────────────────────────────────────────
 * FLOODLIT MARKETING LANDING
 * Ported from "Sportline.dc.html". Visual redesign only — the data layer
 * (useStorefront → venues/scoped/ownerName) is preserved and real grounds
 * surface where the design shows ground cards / the live board.
 * Colours come from the Floodlit CSS vars (resolved by the `.floodlit` shell);
 * layout + responsive reflow come from Tailwind classes.
 * ──────────────────────────────────────────────────────────────────────── */

const inr = new Intl.NumberFormat('en-IN');
const DEFAULT_SPORTS = ['Box cricket', 'Football', 'Pickleball', 'Badminton', 'Tennis', 'Basketball'];
const SPORT_EMOJI: Record<string, string> = {
  cricket: '🏏',
  football: '⚽',
  soccer: '⚽',
  badminton: '🏸',
  pickleball: '🥎',
  tennis: '🎾',
  basketball: '🏀',
  turf: '⚽',
};
function sportEmoji(name: string): string {
  const k = name.toLowerCase();
  for (const key of Object.keys(SPORT_EMOJI)) if (k.includes(key)) return SPORT_EMOJI[key];
  return '🏟️';
}

function fromPrice(v: DiscoverVenue): string | null {
  return v.minPrice != null ? `₹${inr.format(Math.round(v.minPrice))}` : null;
}

/* ───────────────────────────── count-up hook ───────────────────────────────
 * Tweens a number up to `target` once the element scrolls into view (or on
 * mount for above-the-fold figures). setInterval (not rAF) so the tween still
 * runs when the render context reports hidden, matching the source design. */
function useCountUp(target: number, dec = 0, durMs = 1500) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [val, setVal] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const run = () => {
      if (started.current) return;
      started.current = true;
      const start = Date.now();
      const iv = setInterval(() => {
        const t = Math.min(1, (Date.now() - start) / durMs);
        const eased = 1 - Math.pow(1 - t, 3);
        setVal(target * eased);
        if (t >= 1) {
          setVal(target);
          clearInterval(iv);
        }
      }, 33);
    };

    const inView = () => {
      const r = el.getBoundingClientRect();
      const h = window.innerHeight || document.documentElement.clientHeight;
      return r.top < h - 40 && r.bottom > 0;
    };
    const check = () => {
      if (inView()) run();
    };

    let io: IntersectionObserver | null = null;
    try {
      io = new IntersectionObserver(
        (entries) => entries.forEach((e) => e.isIntersecting && run()),
        { threshold: 0.25 },
      );
      io.observe(el);
    } catch {
      /* IO unavailable — scroll fallback below covers it */
    }
    check();
    const raf = requestAnimationFrame(check);
    window.addEventListener('scroll', check, { passive: true, capture: true });
    window.addEventListener('resize', check, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', check, { capture: true });
      window.removeEventListener('resize', check);
      io?.disconnect();
    };
  }, [target, durMs]);

  const text = val.toLocaleString('en-IN', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
  return { ref, text };
}

function CountUp({
  to,
  dec = 0,
  prefix = '',
  suffix = '',
  className,
  style,
}: {
  to: number;
  dec?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { ref, text } = useCountUp(to, dec);
  return (
    <span ref={ref} className={className} style={style}>
      {prefix}
      {text}
      {suffix}
    </span>
  );
}

/* ─────────────────────── animated slot board (fills on scroll) ─────────── */
const FILL_MAP = [
  [1, 0, 1, 1, 0, 1, 1],
  [1, 1, 1, 0, 1, 1, 1],
  [1, 1, 0, 1, 1, 1, 1],
  [0, 1, 1, 1, 0, 1, 1],
];
const SLOT_ROWS = ['18:00', '19:00', '20:00', '21:00'];
const SLOT_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function SlotBoard() {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    let done = false;
    const fire = () => {
      if (done) return;
      done = true;
      setFilled(true);
    };
    const inView = () => {
      const r = el.getBoundingClientRect();
      const h = window.innerHeight || document.documentElement.clientHeight;
      return r.top < h - 60 && r.bottom > 0;
    };
    const check = () => inView() && fire();
    let io: IntersectionObserver | null = null;
    try {
      io = new IntersectionObserver(
        (entries) => entries.forEach((e) => e.isIntersecting && fire()),
        { threshold: 0.25 },
      );
      io.observe(el);
    } catch {
      /* fallback below */
    }
    check();
    window.addEventListener('scroll', check, { passive: true, capture: true });
    window.addEventListener('resize', check, { passive: true });
    return () => {
      window.removeEventListener('scroll', check, { capture: true });
      window.removeEventListener('resize', check);
      io?.disconnect();
    };
  }, []);

  return (
    <div
      className="rounded-[18px] p-5 sm:p-6"
      style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="fl-display text-lg font-bold sm:text-xl" style={{ color: 'var(--chalk)' }}>
          Tonight&apos;s slots · near you
        </div>
        <div className="fl-mono text-[13px]" style={{ color: 'var(--faint)' }}>
          filling fast ·{' '}
          <CountUp to={87} suffix="%" style={{ color: 'var(--amber)', fontWeight: 600 }} /> gone
        </div>
      </div>

      <div
        ref={gridRef}
        className="mt-4 grid gap-1.5"
        style={{ gridTemplateColumns: 'auto repeat(7,1fr)' }}
      >
        <div />
        {SLOT_DAYS.map((d, i) => (
          <div
            key={d}
            className="fl-mono text-center text-[10px]"
            style={{
              color: i >= 5 ? 'var(--green)' : 'var(--faint)',
              fontWeight: i >= 5 ? 600 : 400,
            }}
          >
            {d}
          </div>
        ))}
        {SLOT_ROWS.map((label, r) => (
          <Fragmentish key={label}>
            <div
              className="fl-mono flex items-center pr-1 text-[10px]"
              style={{ color: 'var(--faint)' }}
            >
              {label}
            </div>
            {FILL_MAP[r].map((f, c) => {
              const i = r * 7 + c;
              const on = filled && f === 1;
              return (
                <div
                  key={`${r}-${c}`}
                  className="h-[26px] rounded-md"
                  style={{
                    border: '1px solid var(--line-strong)',
                    background: on ? 'var(--green)' : 'transparent',
                    borderColor: on ? 'transparent' : 'var(--line-strong)',
                    transition: 'background .4s ease, border-color .4s ease',
                    transitionDelay: filled ? `${120 + i * 45}ms` : '0ms',
                  }}
                />
              );
            })}
          </Fragmentish>
        ))}
      </div>

      <div
        className="fl-mono mt-4 flex gap-5 text-[11px]"
        style={{ color: 'var(--faint)' }}
      >
        <span className="flex items-center gap-1.5">
          <span
            className="h-[11px] w-[11px] rounded-[3px]"
            style={{ background: 'var(--green)' }}
          />
          Taken
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-[11px] w-[11px] rounded-[3px]"
            style={{ border: '1px solid var(--line-strong)' }}
          />
          Grab it
        </span>
      </div>
    </div>
  );
}

/** Tiny inline fragment helper to keep the grid flat (avoids extra wrappers). */
function Fragmentish({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/* ───────────────────────────── section eyebrow ─────────────────────────── */
function Eyebrow({ children, tone = 'green' }: { children: ReactNode; tone?: 'green' | 'amber' }) {
  return (
    <div
      className="fl-mono text-xs font-semibold uppercase"
      style={{ color: tone === 'amber' ? 'var(--amber)' : 'var(--green)', letterSpacing: '0.16em' }}
    >
      {children}
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2
      className="fl-display mt-3.5 text-[clamp(34px,4.6vw,62px)] font-extrabold"
      style={{ color: 'var(--chalk)', lineHeight: 0.95 }}
    >
      {children}
    </h2>
  );
}

/* ───────────────────────────── amber CTA button ────────────────────────── */
function AmberCTA({
  to,
  children,
  big = false,
}: {
  to: string;
  children: ReactNode;
  big?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-2.5 rounded-xl font-bold no-underline ${
        big ? 'px-7 py-4 text-[17px]' : 'px-6 py-[15px] text-base'
      }`}
      style={{
        background: 'var(--amber)',
        color: 'var(--on-amber)',
        boxShadow: '0 10px 34px -10px var(--amber)',
      }}
    >
      {children}
    </Link>
  );
}

function GhostCTA({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2.5 rounded-xl px-6 py-[15px] text-base font-semibold no-underline"
      style={{ background: 'transparent', color: 'var(--chalk)', border: '1px solid var(--line-strong)' }}
    >
      {children}
    </Link>
  );
}

const cardStyle: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
};
const innerCardStyle: CSSProperties = {
  background: 'var(--bg-2)',
  border: '1px solid var(--line)',
};

export function LandingPage() {
  const { scoped, ownerName, ownerLogo, venues, loading } = useStorefront();

  // Distinct sports across the (scoped or marketplace) grounds — real data.
  const sports = useMemo(() => {
    const seen = new Map<string, string>();
    for (const v of venues)
      for (const g of v.games) {
        const k = g.name.toLowerCase();
        if (!seen.has(k)) seen.set(k, g.name);
      }
    const found = Array.from(seen.values());
    return found.length ? found.slice(0, 6) : DEFAULT_SPORTS;
  }, [venues]);

  // Distinct cities across grounds, for the "Now in" strip.
  const cities = useMemo(() => {
    const seen = new Set<string>();
    for (const v of venues) if (v.city) seen.add(v.city);
    const found = Array.from(seen);
    return found.length ? found.slice(0, 6) : ['Bengaluru', 'Hyderabad', 'Pune', 'Mumbai', 'Delhi NCR', 'Chennai'];
  }, [venues]);

  // Real grounds to surface in the hero phone + open-matches trio.
  const featured = venues.slice(0, 4);
  const heroGround = featured[0] ?? null;
  const brandName = scoped && ownerName ? ownerName : 'Sportline';

  return (
    <div style={{ background: 'var(--bg)', color: 'var(--chalk)' }}>
      {/* ============ HERO ============ */}
      <header className="relative overflow-hidden px-5 pb-16 pt-12 sm:px-8 sm:pt-16 lg:pb-24">
        {/* floodlight flares */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-20 -top-44 h-[560px] w-[560px] rounded-full blur-[20px]"
          style={{
            background: 'radial-gradient(circle, var(--amber) 0%, transparent 62%)',
            opacity: 0.16,
            animation: 'fl-flick 7s ease-in-out infinite',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-56 h-[620px] w-[620px] rounded-full blur-[24px]"
          style={{
            background: 'radial-gradient(circle, var(--green) 0%, transparent 60%)',
            opacity: 0.14,
            animation: 'fl-flick 9s ease-in-out infinite .6s',
          }}
        />

        <div className="relative z-[2] mx-auto grid max-w-[1240px] grid-cols-1 items-center gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
          <div>
            <div
              className="fl-mono inline-flex items-center gap-2.5 rounded-full px-3.5 py-2 text-[11px] font-semibold uppercase"
              style={{ color: 'var(--green)', border: '1px solid var(--line)', letterSpacing: '0.16em' }}
            >
              {scoped && ownerLogo ? (
                <img src={ownerLogo} alt="" className="h-4 w-4 rounded-sm object-contain" />
              ) : (
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: 'var(--green)', boxShadow: '0 0 8px var(--green)', animation: 'fl-blip 1.8s infinite' }}
                />
              )}
              {scoped ? brandName : 'Book turf & courts · India'}
            </div>

            <h1
              className="fl-display mt-5 text-[clamp(46px,7.4vw,104px)] font-extrabold"
              style={{ lineHeight: 0.92, letterSpacing: '-0.005em' }}
            >
              {scoped ? (
                <>
                  Grab a slot at{' '}
                  <span
                    style={{
                      color: 'var(--green)',
                      textShadow: '0 0 34px color-mix(in oklab, var(--green) 45%, transparent)',
                    }}
                  >
                    {brandName}
                  </span>
                  .
                </>
              ) : (
                <>
                  Grab a slot.
                  <br />
                  <span
                    style={{
                      color: 'var(--green)',
                      textShadow: '0 0 34px color-mix(in oklab, var(--green) 45%, transparent)',
                    }}
                  >
                    Get a game
                  </span>{' '}
                  on.
                </>
              )}
            </h1>

            <p
              className="mt-5 max-w-[30em] text-[clamp(16px,1.4vw,19px)]"
              style={{ color: 'var(--muted)', lineHeight: 1.55 }}
            >
              {scoped
                ? `Book ${brandName}'s grounds in seconds. See live slots and real prices, split the bill with your crew, and find players when you're short. No more WhatsApp chaos.`
                : "Book turfs and courts near you in seconds. See live slots and real prices, split the bill with your crew, and find players when you're short. No more WhatsApp chaos."}
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <AmberCTA to="/browse">
                Find a ground near you <span className="fl-mono">→</span>
              </AmberCTA>
              <GhostCTA to="/open-matches">Browse open matches</GhostCTA>
            </div>

            {/* proof strip */}
            <div
              className="mt-9 flex max-w-[520px] flex-wrap overflow-hidden rounded-xl"
              style={{ border: '1px solid var(--line)' }}
            >
              <div className="min-w-[140px] flex-1 px-[18px] py-4" style={{ borderRight: '1px solid var(--line)' }}>
                <CountUp
                  to={120}
                  suffix="+"
                  className="fl-mono block text-[clamp(26px,3vw,34px)] font-semibold"
                  style={{ color: 'var(--green)', letterSpacing: '-0.01em' }}
                />
                <div className="mt-1 text-xs" style={{ color: 'var(--faint)' }}>
                  grounds to book
                </div>
              </div>
              <div className="min-w-[140px] flex-1 px-[18px] py-4" style={{ borderRight: '1px solid var(--line)' }}>
                <CountUp
                  to={2400}
                  suffix="+"
                  className="fl-mono block text-[clamp(26px,3vw,34px)] font-semibold"
                  style={{ color: 'var(--amber)', letterSpacing: '-0.01em' }}
                />
                <div className="mt-1 text-xs" style={{ color: 'var(--faint)' }}>
                  slots booked this week
                </div>
              </div>
              <div className="min-w-[110px] flex-1 px-[18px] py-4">
                <CountUp
                  to={30}
                  suffix="s"
                  className="fl-mono block text-[clamp(26px,3vw,34px)] font-semibold"
                  style={{ color: 'var(--chalk)', letterSpacing: '-0.01em' }}
                />
                <div className="mt-1 text-xs" style={{ color: 'var(--faint)' }}>
                  to lock a slot
                </div>
              </div>
            </div>
            <div className="fl-mono mt-2.5 text-[11px]" style={{ color: 'var(--faint)' }}>
              * illustrative figures across the {brandName} network
            </div>
          </div>

          {/* phone in context — featured real ground if available */}
          <div className="relative flex justify-center">
            <div
              className="relative z-[1] w-[clamp(248px,80vw,308px)] rounded-[40px] p-[11px]"
              style={{
                background: 'linear-gradient(160deg, var(--surface-2), var(--surface))',
                border: '1px solid var(--line-strong)',
                boxShadow: '0 40px 90px -30px black, 0 0 60px -20px var(--green)',
              }}
            >
              <div
                className="overflow-hidden rounded-[30px]"
                style={{ background: 'var(--bg-2)', border: '1px solid var(--line)' }}
              >
                <div
                  className="px-4 pb-3 pt-[15px]"
                  style={{
                    background: 'linear-gradient(180deg, color-mix(in oklab,var(--brand) 20%, var(--bg-2)), var(--bg-2))',
                    borderBottom: '1px solid var(--line)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="fl-display text-[15px] font-bold">Grounds near you</span>
                    <span className="fl-mono flex items-center gap-1 text-[10px]" style={{ color: 'var(--green)' }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--green)' }} />
                      {heroGround?.city ?? 'Koramangala'}
                    </span>
                  </div>
                </div>

                <div className="p-3">
                  <div className="overflow-hidden rounded-[13px]" style={{ border: '1px solid var(--brand)', background: 'var(--surface)' }}>
                    {heroGround && (
                      <div className="relative h-20 w-full overflow-hidden">
                        <ImageWithFallback
                          src={venuePhoto({ photos: heroGround.photos, games: heroGround.games })}
                          fallback={FALLBACK_VENUE_PHOTO}
                          alt=""
                          className="h-full w-full object-cover opacity-90"
                        />
                      </div>
                    )}
                    <div
                      className="px-[13px] pb-[11px] pt-[13px]"
                      style={{ background: 'color-mix(in oklab,var(--brand) 12%, var(--surface))' }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="fl-display truncate text-[15px] font-bold">
                          {heroGround?.name ?? 'Greenfield Turf'}
                        </div>
                        <span className="fl-mono text-[11px]" style={{ color: 'var(--amber)' }}>
                          ★ 4.8
                        </span>
                      </div>
                      <div className="fl-mono mt-1 text-[10px]" style={{ color: 'var(--faint)' }}>
                        {heroGround?.games[0]?.name ?? '⚽ 🏏'} · 12 slots open tonight
                      </div>
                    </div>
                    <div className="flex gap-1.5 px-[13px] py-[11px]">
                      {['6PM', '7PM', '8PM'].map((t, i) => (
                        <span
                          key={t}
                          className="fl-mono flex-1 rounded-md py-[7px] text-center text-[11px]"
                          style={
                            i === 1
                              ? { background: 'var(--brand)', color: 'var(--on-brand)', fontWeight: 600 }
                              : { border: '1px solid var(--line)', color: 'var(--muted)' }
                          }
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* split bar */}
                  <div className="mt-[11px] rounded-[11px] px-[13px] py-[11px]" style={innerCardStyle}>
                    <div className="flex items-center justify-between text-[11px]">
                      <span style={{ color: 'var(--muted)' }}>Split {flMoney(900)} · 5 going</span>
                      <span className="fl-mono font-semibold" style={{ color: 'var(--green)' }}>
                        {flMoney(180)} each
                      </span>
                    </div>
                    <div className="mt-2 flex items-center">
                      {[
                        'var(--green-2)',
                        'var(--amber-2)',
                        'var(--surface-2)',
                        'var(--green-2)',
                        'var(--amber-2)',
                      ].map((bg, i) => (
                        <span
                          key={i}
                          className="h-[22px] w-[22px] rounded-full"
                          style={{ background: bg, marginLeft: i ? -7 : 0, opacity: i >= 3 ? 0.7 : 1 }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* pay bar */}
                <div className="px-[13px] pb-3.5">
                  <div
                    className="flex items-center justify-center gap-2 rounded-[11px] p-[13px] text-sm font-bold"
                    style={{ background: 'var(--amber)', color: 'var(--on-amber)' }}
                  >
                    Pay {flMoney(180)} · Join game
                  </div>
                  <div className="fl-mono mt-[7px] text-center text-[9px]" style={{ color: 'var(--faint)' }}>
                    SECURED BY RAZORPAY
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ============ THE PROBLEM ============ */}
      <section
        className="px-5 py-16 sm:px-8 sm:py-20 lg:py-[108px]"
        style={{ background: 'var(--bg-2)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}
      >
        <div className="mx-auto grid max-w-[1240px] grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-16">
          <div>
            <Eyebrow tone="amber">The Friday-night scramble</Eyebrow>
            <SectionHeading>
              It&apos;s 9pm Friday.
              <br />
              Still no ground.
            </SectionHeading>
            <p className="my-5 max-w-[30em] text-[clamp(16px,1.3vw,18px)]" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
              You&apos;ve called six turfs — all booked. The group chat is 80 messages of &ldquo;I&apos;m in&rdquo; and
              &ldquo;maybe.&rdquo; Two guys dropped out, so now you&apos;re short. And nobody&apos;s actually paid.
              Game&apos;s basically off.
            </p>
            <div className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--line)' }}>
              {[
                'Calling turf after turf to find one free',
                'Chasing the crew to actually confirm',
                '"Who\'s paying?" — and chasing the cash',
                'Two short — and the whole game falls apart',
              ].map((t, i) => (
                <div
                  key={t}
                  className="flex items-center gap-3.5 px-[18px] py-[15px]"
                  style={{ background: 'var(--surface)', borderTop: i ? '1px solid var(--line)' : undefined }}
                >
                  <span className="fl-mono font-semibold" style={{ color: 'var(--amber)' }}>
                    0{i + 1}
                  </span>
                  <span className="text-[15px] font-medium">{t}</span>
                </div>
              ))}
            </div>
          </div>

          {/* messy group-chat collage */}
          <div className="relative min-h-[340px] sm:min-h-[380px]">
            <div
              className="absolute left-[4%] top-[8%] w-[62%] -rotate-[4deg] rounded p-[18px_18px_22px]"
              style={{ background: 'oklch(0.95 0.04 95)', color: 'oklch(0.25 0.04 60)', boxShadow: '0 24px 50px -20px black' }}
            >
              <div className="fl-mono pb-1.5 text-[11px] opacity-60" style={{ borderBottom: '1px dashed oklch(0.5 0.04 60)' }}>
                CALLED TONIGHT
              </div>
              <div className="text-sm italic" style={{ lineHeight: 2 }}>
                Greenfield — booked
                <br />
                City Turf — booked
                <br />
                Arena 11 — <span className="line-through">9pm?</span> gone
                <br />
                PlayZone — no answer
              </div>
            </div>
            <div
              className="absolute right-[3%] top-[2%] w-[46%] rotate-[5deg] rounded-[3px] p-[15px] text-[13px] font-semibold"
              style={{ background: 'oklch(0.86 0.13 95)', color: 'oklch(0.28 0.06 70)', boxShadow: '0 20px 40px -16px black', lineHeight: 1.4 }}
            >
              &ldquo;Bhai 2 log kam pad gaye, kal khelein? 😭&rdquo;
            </div>
            <div
              className="absolute bottom-[4%] right-[8%] w-[58%] -rotate-2 rounded-xl p-3.5"
              style={{ background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: '0 24px 50px -20px black' }}
            >
              <div className="mb-2.5 flex items-center gap-2">
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: '#25D366' }} />
                <span className="fl-mono text-[11px]" style={{ color: 'var(--faint)' }}>
                  SUNDAY SQUAD · 18 members
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="max-w-[85%] self-start rounded-[11px_11px_11px_3px] px-2.5 py-[7px] text-[12.5px]" style={{ background: 'var(--surface-2)' }}>
                  Ground mila? 8pm ke liye
                </span>
                <span
                  className="self-end rounded-[11px_11px_3px_11px] px-2.5 py-[7px] text-[12.5px]"
                  style={{ background: 'color-mix(in oklab,#25D366 28%, var(--surface-2))' }}
                >
                  Dekh raha hu... sab full 😩
                </span>
                <span className="self-start rounded-[11px_11px_11px_3px] px-2.5 py-[7px] text-[12.5px]" style={{ background: 'var(--surface-2)' }}>
                  +1 maybe
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section className="px-5 py-16 sm:px-8 sm:py-20 lg:py-[108px]">
        <div className="mx-auto max-w-[1240px]">
          <div className="max-w-[34em]">
            <Eyebrow>How it works</Eyebrow>
            <SectionHeading>Search → Slot → Split → Play.</SectionHeading>
            <p className="mt-4 text-[clamp(16px,1.3vw,18px)]" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
              Find a free ground near you, lock the slot, split the bill so everyone pays their share, and show up to
              play. Under a minute, start to finish.
            </p>
          </div>

          <div className="mt-11 grid grid-cols-1 items-stretch gap-5 lg:grid-cols-[1.25fr_1fr] lg:gap-8">
            <SlotBoard />

            {/* price transparency */}
            <div className="rounded-[18px] p-5 sm:p-6" style={cardStyle}>
              <div className="fl-display text-lg font-bold sm:text-xl" style={{ color: 'var(--chalk)' }}>
                Know the price before you go
              </div>
              <div className="mt-1 text-[13px]" style={{ color: 'var(--faint)' }}>
                Hover a band — no surprises at the gate.
              </div>
              <div className="mt-4 flex flex-col gap-2.5">
                {[
                  { label: 'Weekday · before 4pm', sub: 'Cheapest slots', price: '₹500', tone: 'green' as const },
                  { label: 'Weekday · 4pm–10pm', sub: 'Peak · floodlights on', price: '₹900', tone: 'amber' as const },
                  { label: 'Weekend · all day', sub: 'Most in demand', price: '₹1,100', tone: 'amber' as const },
                ].map((band) => (
                  <PriceBand key={band.label} {...band} />
                ))}
              </div>
              <div
                className="mt-4 rounded-[11px] px-4 py-3.5"
                style={{ background: 'var(--bg-2)', border: '1px dashed var(--line-strong)' }}
              >
                <div className="text-[13px]" style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
                  Real prices, upfront. Split it across the crew and it&apos;s pocket change each — pay your share in
                  the app, done.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ WHY SPORTLINE ============ */}
      <section
        className="px-5 py-16 sm:px-8 sm:py-20 lg:py-[108px]"
        style={{ background: 'var(--bg-2)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}
      >
        <div className="mx-auto max-w-[1240px]">
          <div className="max-w-[34em]">
            <Eyebrow tone="amber">Why {brandName}</Eyebrow>
            <SectionHeading>
              Less group chat.
              <br />
              More game.
            </SectionHeading>
          </div>
          <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
            <div className="overflow-hidden rounded-2xl p-6" style={cardStyle}>
              <div className="fl-mono text-xs uppercase" style={{ color: 'var(--faint)', letterSpacing: '0.12em' }}>
                Live availability
              </div>
              <div className="fl-display mt-3 text-[30px] font-extrabold" style={{ lineHeight: 1 }}>
                See what&apos;s actually free
              </div>
              <p className="mt-3.5 text-[14.5px]" style={{ color: 'var(--muted)', lineHeight: 1.55 }}>
                Real-time slots across every ground near you. No calling around, no &ldquo;let me check the
                register.&rdquo; If it&apos;s green, it&apos;s yours.
              </p>
            </div>
            <div
              className="overflow-hidden rounded-2xl p-6"
              style={{
                background: 'linear-gradient(150deg, color-mix(in oklab,var(--green) 15%, var(--surface)), var(--surface))',
                border: '1px solid var(--green-2)',
              }}
            >
              <div className="fl-mono text-xs uppercase" style={{ color: 'var(--green)', letterSpacing: '0.12em' }}>
                Split the bill
              </div>
              <div className="fl-mono mt-3.5 flex items-baseline gap-2.5 font-semibold">
                <span className="text-lg" style={{ color: 'var(--faint)' }}>
                  ₹900
                </span>
                <span className="text-sm" style={{ color: 'var(--faint)' }}>
                  ÷ 5 =
                </span>
                <span className="text-[38px]" style={{ color: 'var(--green)' }}>
                  ₹180
                </span>
              </div>
              <p className="mt-3.5 text-[14.5px]" style={{ color: 'var(--muted)', lineHeight: 1.55 }}>
                Everyone pays their share right in the app. No &ldquo;I&apos;ll Gpay you later,&rdquo; no one stuck
                footing the whole bill.
              </p>
            </div>
            <div className="overflow-hidden rounded-2xl p-6" style={cardStyle}>
              <div className="fl-mono text-xs uppercase" style={{ color: 'var(--faint)', letterSpacing: '0.12em' }}>
                Packs &amp; passes
              </div>
              <div className="fl-mono mt-3.5 flex items-baseline gap-2.5 font-semibold">
                <span className="text-[38px]" style={{ color: 'var(--amber)' }}>
                  ₹8,000
                </span>
                <span className="text-[13px]" style={{ color: 'var(--faint)' }}>
                  / 10 games
                </span>
              </div>
              <p className="mt-3.5 text-[14.5px]" style={{ color: 'var(--muted)', lineHeight: 1.55 }}>
                Play every week? Buy a pack and save on every booking. Your regular slot, locked in, cheaper.
              </p>
            </div>
            <div className="overflow-hidden rounded-2xl p-6" style={cardStyle}>
              <div className="fl-mono text-xs uppercase" style={{ color: 'var(--faint)', letterSpacing: '0.12em' }}>
                Reminders
              </div>
              <div className="fl-display mt-3 text-[30px] font-extrabold" style={{ lineHeight: 1 }}>
                Nobody ghosts
              </div>
              <div className="fl-mono mt-1.5 text-[13px]" style={{ color: 'var(--green)' }}>
                In-app reminders to the whole crew
              </div>
              <p className="mt-3.5 text-[14.5px]" style={{ color: 'var(--muted)', lineHeight: 1.55 }}>
                Auto reminders so everyone shows up — and knows exactly what they owe. Less herding, more playing.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ============ OPEN MATCHES / FIND PLAYERS ============ */}
      <section className="px-5 py-16 sm:px-8 sm:py-20 lg:py-[108px]">
        <div className="mx-auto max-w-[1240px]">
          <div className="max-w-[36em]">
            <Eyebrow>Open matches &amp; players</Eyebrow>
            <SectionHeading>
              Short two players?
              <br />
              Get a full game.
            </SectionHeading>
            <p className="mt-4 text-[clamp(16px,1.3vw,18px)]" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
              Join an open game near you, or post yours and let the community fill the spots. Tournaments and your
              regular squad, all in one place.
            </p>
            <div className="mt-7">
              <AmberCTA to="/open-matches">
                See open matches <span className="fl-mono">→</span>
              </AmberCTA>
            </div>
          </div>

          <div className="mt-10 grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
            {/* open matches */}
            <div className="flex flex-col gap-3.5 rounded-2xl p-6" style={cardStyle}>
              <div className="fl-display text-xl font-bold">Join an open match</div>
              <div className="rounded-xl p-3.5" style={innerCardStyle}>
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-semibold">Box cricket</span>
                  <span className="fl-mono text-xs" style={{ color: 'var(--green)' }}>
                    8–9 PM
                  </span>
                </div>
                <div className="fl-mono mt-1.5 text-[13px]" style={{ color: 'var(--muted)' }}>
                  2 spots left · {flMoney(150)} · 1.2 km
                </div>
                <div className="mt-3 flex items-center gap-1.5">
                  {['var(--green-2)', 'var(--amber-2)', 'var(--surface-2)'].map((bg, i) => (
                    <span key={i} className="h-[26px] w-[26px] rounded-full" style={{ background: bg, marginLeft: i ? -10 : 0 }} />
                  ))}
                  {[0, 1].map((i) => (
                    <span
                      key={i}
                      className="grid h-[26px] w-[26px] place-items-center rounded-full text-[13px]"
                      style={{ border: '1px dashed var(--line-strong)', color: 'var(--faint)', marginLeft: i ? -6 : -10 }}
                    >
                      +
                    </span>
                  ))}
                  <Link
                    to="/open-matches"
                    className="ml-auto rounded-lg px-3 py-[7px] text-xs font-semibold no-underline"
                    style={{ background: 'var(--green)', color: 'var(--on-brand)' }}
                  >
                    Join
                  </Link>
                </div>
              </div>
              <div className="rounded-xl p-3.5" style={innerCardStyle}>
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-semibold">5-a-side football</span>
                  <span className="fl-mono text-xs" style={{ color: 'var(--green)' }}>
                    9–10 PM
                  </span>
                </div>
                <div className="fl-mono mt-1.5 text-[13px]" style={{ color: 'var(--muted)' }}>
                  4 spots left · {flMoney(120)} · 3.0 km
                </div>
              </div>
              <p className="text-[13px]" style={{ color: 'var(--faint)', lineHeight: 1.5 }}>
                Skill level shown, so it&apos;s always a fair game.
              </p>
            </div>

            {/* tournaments */}
            <div className="flex flex-col gap-3.5 rounded-2xl p-6" style={cardStyle}>
              <div className="fl-display text-xl font-bold">Play tournaments</div>
              <div className="rounded-xl p-4" style={innerCardStyle}>
                <div className="mb-3.5 flex items-center justify-between">
                  <span className="text-sm font-semibold">Sunday Cup · 8 teams</span>
                  <span className="fl-mono text-[11px]" style={{ color: 'var(--amber)' }}>
                    ₹500/team
                  </span>
                </div>
                <div
                  className="fl-mono grid items-center gap-x-2.5 gap-y-[7px] text-[11px]"
                  style={{ gridTemplateColumns: '1fr auto 1fr' }}
                >
                  {[
                    ['Strikers', 'Smashers', false],
                    ['Royals', 'United', true],
                    ['Titans', 'Warriors', false],
                  ].map(([a, b, hot]) => (
                    <Fragmentish key={a as string}>
                      <div
                        className="rounded-md px-2.5 py-1.5"
                        style={
                          hot
                            ? { background: 'color-mix(in oklab,var(--green) 20%,var(--surface-2))', border: '1px solid var(--green-2)' }
                            : { background: 'var(--surface-2)' }
                        }
                      >
                        {a as string}
                      </div>
                      <div style={{ color: 'var(--faint)' }}>vs</div>
                      <div className="rounded-md px-2.5 py-1.5" style={{ background: 'var(--surface-2)', color: 'var(--faint)' }}>
                        {b as string}
                      </div>
                    </Fragmentish>
                  ))}
                </div>
              </div>
              <p className="text-[13px]" style={{ color: 'var(--faint)', lineHeight: 1.5 }}>
                Enter your team, see the fixtures, track the bracket — all in the app.
              </p>
            </div>

            {/* your squad */}
            <div className="flex flex-col gap-3.5 rounded-2xl p-6" style={cardStyle}>
              <div className="fl-display text-xl font-bold">Your squad</div>
              <div className="flex flex-col gap-2">
                {[
                  { i: 'R', name: 'Rohit M.', sub: 'in · paid ✓', val: '₹180', bg: 'var(--green-2)', tone: 'var(--green)' },
                  { i: 'P', name: 'Priya K.', sub: 'in · paid ✓', val: '₹180', bg: 'var(--amber-2)', tone: 'var(--green)' },
                  { i: 'A', name: 'Arjun S.', sub: 'invited · pending', val: 'nudge', bg: 'var(--surface-2)', tone: 'var(--amber)' },
                ].map((m) => (
                  <div key={m.name} className="flex items-center gap-2.5 rounded-[11px] px-3.5 py-3" style={innerCardStyle}>
                    <span
                      className="fl-display grid h-[34px] w-[34px] place-items-center rounded-full font-bold"
                      style={{ background: m.bg, color: 'var(--on-amber)' }}
                    >
                      {m.i}
                    </span>
                    <div className="flex-1">
                      <div className="text-sm font-semibold">{m.name}</div>
                      <div className="fl-mono text-[11px]" style={{ color: 'var(--faint)' }}>
                        {m.sub}
                      </div>
                    </div>
                    <span className="fl-mono text-[11px] font-semibold" style={{ color: m.tone }}>
                      {m.val}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[13px]" style={{ color: 'var(--faint)', lineHeight: 1.5 }}>
                Save your regular crew and invite the whole squad in one tap.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ============ GROUNDS NEAR YOU (real data) ============ */}
      {(loading || venues.length > 0) && (
        <section
          className="px-5 py-16 sm:px-8 sm:py-20 lg:py-[108px]"
          style={{ background: 'var(--bg-2)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}
        >
          <div className="mx-auto max-w-[1240px]">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="max-w-[34em]">
                <Eyebrow>{scoped ? brandName : 'Grounds near you'}</Eyebrow>
                <SectionHeading>{scoped ? `Play at ${brandName}` : 'Lit up tonight.'}</SectionHeading>
              </div>
              <Link
                to="/browse"
                className="fl-mono text-sm font-semibold no-underline"
                style={{ color: 'var(--green)' }}
              >
                View all →
              </Link>
            </div>

            <div className="mt-9 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
              {loading && venues.length === 0
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-64 animate-pulse rounded-2xl"
                      style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
                    />
                  ))
                : venues.slice(0, 6).map((v) => <GroundCard key={v.id} venue={v} />)}
            </div>
          </div>
        </section>
      )}

      {/* ============ SPORTS + CITIES (real sports/cities) ============ */}
      <section className="px-5 py-16 sm:px-8 sm:py-20 lg:py-[108px]">
        <div className="mx-auto max-w-[1240px]">
          <div className="max-w-[34em]">
            <Eyebrow tone="amber">Every sport · every night</Eyebrow>
            <SectionHeading>Whatever your game is.</SectionHeading>
          </div>
          <div className="mt-9 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6 md:gap-4">
            {sports.map((s) => (
              <Link
                key={s}
                to="/browse"
                className="flex aspect-square flex-col items-center justify-center gap-2.5 rounded-2xl no-underline transition-colors"
                style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--chalk)' }}
              >
                <span className="text-3xl">
                  <SportIconOrEmoji name={s} />
                </span>
                <span className="fl-display px-2 text-center text-[15px] font-bold leading-none">{s}</span>
              </Link>
            ))}
          </div>
          <div className="fl-mono mt-7 flex flex-wrap items-center gap-3 text-[13px]" style={{ color: 'var(--muted)' }}>
            <span className="text-[11px] uppercase" style={{ color: 'var(--faint)', letterSpacing: '0.1em' }}>
              Now in
            </span>
            {cities.map((c, i) => (
              <Fragmentish key={c}>
                {i > 0 && <span style={{ color: 'var(--faint)' }}>·</span>}
                <span>{c}</span>
              </Fragmentish>
            ))}
            <span style={{ color: 'var(--green)' }}>+ more every month</span>
          </div>
        </div>
      </section>

      {/* ============ PROOF ============ */}
      <section
        className="px-5 py-16 sm:px-8 sm:py-20 lg:py-[108px]"
        style={{ background: 'var(--bg-2)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}
      >
        <div className="mx-auto max-w-[1240px]">
          {/* numbers */}
          <div className="grid grid-cols-1 overflow-hidden rounded-2xl sm:grid-cols-3" style={{ border: '1px solid var(--line)' }}>
            <ProofNum to={50000} suffix="+" dec={0} color="var(--green)" label={`players booking on ${brandName}`} border />
            <ProofNum to={120} suffix="+" dec={0} color="var(--amber)" label="grounds you can book tonight" border />
            <ProofNum to={4.8} suffix="★" dec={1} color="var(--chalk)" label="average player rating" />
          </div>

          {/* quote */}
          <div className="mt-8 grid grid-cols-1 items-center gap-6 sm:grid-cols-[auto_1fr] sm:gap-10 lg:mt-12">
            <div
              className="h-[clamp(120px,40vw,190px)] w-[clamp(120px,40vw,190px)] rounded-2xl"
              style={{ background: 'linear-gradient(150deg, var(--green-2), var(--surface-2))', border: '1px solid var(--line)' }}
            />
            <div>
              <p
                className="fl-display text-[clamp(22px,3vw,34px)] font-semibold"
                style={{ textTransform: 'none', lineHeight: 1.18, letterSpacing: '0.005em' }}
              >
                &ldquo;It used to take an hour of calls to lock a ground. Now it&apos;s 30 seconds, my whole crew&apos;s
                paid up before we leave, and we&apos;ve never had a game fall through.&rdquo;
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className="text-[15px] font-semibold">Aditya R.</span>
                <span className="text-sm" style={{ color: 'var(--faint)' }}>
                  · plays box cricket every Sunday, Bengaluru
                </span>
              </div>
              <div className="mt-5 flex flex-wrap gap-2.5">
                {['Razorpay secure pay', 'Instant refunds', 'DPDP-compliant'].map((chip) => (
                  <span
                    key={chip}
                    className="fl-mono inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs"
                    style={{ color: 'var(--muted)', border: '1px solid var(--line)' }}
                  >
                    <span className="h-[7px] w-[7px] rounded-full" style={{ background: 'var(--green)' }} />
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ WHAT IT COSTS ============ */}
      <section className="px-5 py-16 sm:px-8 sm:py-20 lg:py-[108px]">
        <div className="mx-auto max-w-[1240px]">
          <div className="max-w-[36em]">
            <Eyebrow>What it costs you</Eyebrow>
            <SectionHeading>
              Free to use.
              <br />
              Pay only for your slot.
            </SectionHeading>
            <p className="mt-4 text-[clamp(16px,1.3vw,18px)]" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
              Browsing and booking is free. You pay the ground&apos;s price — the same rate you&apos;d pay at the gate —
              split fairly across your crew. No booking fees, no surprises.
            </p>
          </div>
          <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3 lg:gap-5">
            {[
              { big: '₹0', color: 'var(--green)', t: 'To use the app', d: 'Browse grounds, see live slots and check prices — all free, no account needed to look.' },
              { big: 'Gate price', color: 'var(--amber)', t: 'For your slot', d: 'Exactly what the ground charges — shown upfront, peak and off-peak. No platform markup.' },
              { big: 'No fees', color: 'var(--chalk)', t: 'On top', d: 'Cancel in time and get an instant refund. Split the bill at no extra charge. What you see is what you pay.' },
            ].map((c) => (
              <div key={c.t} className="rounded-2xl p-6" style={cardStyle}>
                <div className="fl-display text-[34px] font-extrabold" style={{ color: c.color, lineHeight: 1 }}>
                  {c.big}
                </div>
                <div className="fl-display mt-2.5 text-[19px] font-bold">{c.t}</div>
                <p className="mt-2.5 text-sm" style={{ color: 'var(--muted)', lineHeight: 1.55 }}>
                  {c.d}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ CLOSE ============ */}
      <section className="relative overflow-hidden px-5 py-20 text-center sm:px-8 lg:py-32">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-160px] h-[480px] w-[760px] -translate-x-1/2 blur-[30px]"
          style={{
            background: 'radial-gradient(ellipse, var(--green) 0%, transparent 62%)',
            opacity: 0.16,
            animation: 'fl-flick 8s ease-in-out infinite',
          }}
        />
        <div className="relative z-[2] mx-auto max-w-[880px]">
          <h2 className="fl-display text-[clamp(44px,8vw,108px)] font-extrabold" style={{ lineHeight: 0.9 }}>
            Stop scrolling.
            <br />
            <span style={{ color: 'var(--green)', textShadow: '0 0 40px color-mix(in oklab,var(--green) 50%, transparent)' }}>
              Game on.
            </span>
          </h2>
          <p className="mx-auto mt-6 max-w-[30em] text-[clamp(16px,1.5vw,20px)]" style={{ color: 'var(--muted)', lineHeight: 1.55 }}>
            Find a ground near you, grab a slot, and get the whole crew on the pitch tonight.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <AmberCTA to="/browse" big>
              Find a ground near you <span className="fl-mono">→</span>
            </AmberCTA>
            <GhostCTA to="/open-matches">Browse open matches</GhostCTA>
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="px-5 py-10 sm:px-8 lg:py-14" style={{ background: 'var(--bg-2)', borderTop: '1px solid var(--line)' }}>
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            {scoped && ownerLogo ? (
              <img src={ownerLogo} alt="" className="h-7 w-7 rounded-md object-contain" />
            ) : (
              <span
                className="grid h-7 w-7 place-items-center rounded-md"
                style={{ border: '2px solid var(--green)' }}
              >
                <span className="h-3 w-3 rounded-full" style={{ border: '2px solid var(--green)' }} />
              </span>
            )}
            <span className="fl-display text-xl font-extrabold">{brandName}</span>
            <span className="ml-2 text-[13px]" style={{ color: 'var(--faint)' }}>
              Book. Split. Play.
            </span>
          </div>
          <div className="flex flex-wrap gap-5 text-sm">
            <Link to="/browse" className="no-underline" style={{ color: 'var(--muted)' }}>
              Find a ground
            </Link>
            <Link to="/open-matches" className="no-underline" style={{ color: 'var(--muted)' }}>
              Open matches
            </Link>
            <Link to="/tournaments" className="no-underline" style={{ color: 'var(--muted)' }}>
              Tournaments
            </Link>
            <Link to="/login" className="no-underline" style={{ color: 'var(--muted)' }}>
              Sign in
            </Link>
          </div>
          <div className="fl-mono text-xs" style={{ color: 'var(--faint)' }}>
            ₹ · Razorpay · DPDP-compliant
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ───────────────────────────── price band (hover resolves) ─────────────── */
function PriceBand({
  label,
  sub,
  price,
  tone,
}: {
  label: string;
  sub: string;
  price: string;
  tone: 'green' | 'amber';
}) {
  const [hover, setHover] = useState(false);
  const accent = tone === 'green' ? 'var(--green)' : 'var(--amber)';
  const accent2 = tone === 'green' ? 'var(--green-2)' : 'var(--amber-2)';
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative flex items-center justify-between overflow-hidden rounded-[11px] px-4 py-[15px]"
      style={{
        border: `1px solid ${hover ? accent2 : 'var(--line)'}`,
        background: hover ? `color-mix(in oklab,${accent} 12%, var(--surface))` : 'transparent',
        transition: 'border-color .25s, background .25s',
      }}
    >
      <div>
        <div className="fl-mono text-[13px]">{label}</div>
        <div className="mt-0.5 text-[11px]" style={{ color: 'var(--faint)' }}>
          {sub}
        </div>
      </div>
      <div
        className="fl-mono text-xl font-semibold"
        style={{
          color: hover ? accent : 'var(--muted)',
          transform: hover ? 'scale(1.08)' : 'scale(1)',
          transition: 'color .25s, transform .25s',
        }}
      >
        {price}
      </div>
    </div>
  );
}

/* ───────────────────────────── proof number cell ──────────────────────── */
function ProofNum({
  to,
  suffix,
  dec,
  color,
  label,
  border = false,
}: {
  to: number;
  suffix: string;
  dec: number;
  color: string;
  label: string;
  border?: boolean;
}) {
  return (
    <div className="p-6 sm:p-8" style={border ? { borderRight: '1px solid var(--line)' } : undefined}>
      <CountUp
        to={to}
        dec={dec}
        suffix={suffix}
        className="fl-mono block text-[clamp(38px,5vw,58px)] font-semibold"
        style={{ color, lineHeight: 1 }}
      />
      <div className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
        {label}
      </div>
    </div>
  );
}

/* ───────────────────────────── ground card (real data) ────────────────── */
function GroundCard({ venue }: { venue: DiscoverVenue }) {
  const price = fromPrice(venue);
  return (
    <Link
      to={`/venue/${venue.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl no-underline transition-transform hover:-translate-y-0.5"
      style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
    >
      <div className="relative aspect-[16/10] overflow-hidden" style={{ background: 'var(--surface-2)' }}>
        <ImageWithFallback
          src={venuePhoto({ photos: venue.photos, games: venue.games })}
          fallback={FALLBACK_VENUE_PHOTO}
          alt={venue.name}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.65), transparent 60%)' }} />
        {price && (
          <span
            className="fl-mono absolute left-3 top-3 rounded-lg px-2.5 py-1 text-xs font-bold"
            style={{ background: 'var(--amber)', color: 'var(--on-amber)' }}
          >
            from {price}
          </span>
        )}
        <div className="absolute inset-x-3 bottom-3">
          <h3 className="fl-display truncate text-lg font-extrabold leading-tight text-white">{venue.name}</h3>
          {venue.city && <p className="mt-0.5 text-sm text-white/80">{venue.city}</p>}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        {venue.games.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {venue.games.slice(0, 4).map((g) => (
              <span
                key={g.id}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--muted)' }}
              >
                <SportIcon name={g.name} className="h-3.5 w-3.5" />
                {g.name}
              </span>
            ))}
          </div>
        )}
        <p className="fl-mono mt-auto text-xs" style={{ color: 'var(--faint)' }}>
          Open {venue.openTime}–{venue.closeTime}
        </p>
      </div>
    </Link>
  );
}

/* Prefer the app's vector SportIcon; fall back to an emoji glyph for sports it
 * doesn't recognise so the grid never shows a blank tile. */
function SportIconOrEmoji({ name }: { name: string }) {
  return (
    <span className="grid place-items-center">
      <SportIcon name={name} className="h-8 w-8" />
      <span className="sr-only">{sportEmoji(name)}</span>
    </span>
  );
}
