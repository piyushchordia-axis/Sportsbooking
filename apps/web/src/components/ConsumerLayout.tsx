import { UserRole } from '@sportsbooking/shared';
import { CSSProperties, useMemo } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  CalendarCheck,
  Moon,
  Search,
  Sun,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { useStorefront } from '../storefront/StorefrontProvider';
import { FloodlitToastProvider, useFloodlitToast } from '../floodlit/toast';
import { cn } from './ui/utils';

/** WCAG-ish contrast pick for text on a brand-coloured chip. */
function onBrandFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 'oklch(0.17 0.04 152)';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.45 ? 'oklch(0.17 0.02 250)' : 'oklch(0.99 0.01 150)';
}

const NAV = [
  { to: '/browse', label: 'Browse', icon: Search, match: ['/browse', '/venue'] },
  { to: '/open-matches', label: 'Matches', icon: Users, match: ['/open-matches', '/tournaments'] },
  { to: '/wallet', label: 'Wallet', icon: Wallet, match: ['/wallet'] },
  { to: '/my-bookings', label: 'Bookings', icon: CalendarCheck, match: ['/my-bookings'] },
  { to: '/account', label: 'Account', icon: User, match: ['/account', '/saved', '/offers'] },
];

/** Floating brand-coloured toast, rendered above the bottom nav. */
function ToastHost() {
  const { toast } = useFloodlitToast();
  if (!toast) return null;
  return (
    <div
      className="fl-mono"
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 'calc(86px + env(safe-area-inset-bottom))',
        zIndex: 60,
        background: 'var(--surface-2)',
        color: 'var(--chalk)',
        border: '1px solid var(--brand)',
        borderRadius: 11,
        padding: '11px 18px',
        fontSize: 13,
        fontWeight: 600,
        boxShadow: '0 12px 30px -10px black',
        whiteSpace: 'nowrap',
      }}
    >
      {toast}
    </div>
  );
}

/**
 * Player storefront shell ("Floodlit"). Wraps every consumer route in the
 * `.floodlit` theme scope, applies the active operator's brand colour
 * (white-label) and the day/night mode, and renders the app chrome — a sticky
 * top bar plus a bottom nav on mobile that expands to a top nav on desktop. The
 * landing route brings its own marketing chrome, so the app nav is suppressed
 * there.
 */
export function ConsumerLayout() {
  const { user } = useAuth();
  const { branding, mode, toggleMode } = useTheme();
  const { scoped, ownerName, exitStorefront } = useStorefront();
  const loc = useLocation();
  const nav = useNavigate();

  const exitToMarketplace = () => {
    exitStorefront();
    nav('/browse');
  };

  const isPlayer = user?.role === UserRole.CUSTOMER;
  const isLanding =
    loc.pathname === '/' || loc.pathname.startsWith('/s/');

  // White-label: when an operator is in scope, drive --brand from their colour;
  // otherwise fall back to the Floodlit green baked into the .floodlit scope.
  const brandStyle = useMemo<CSSProperties>(() => {
    if (!scoped) return {};
    return {
      '--brand': branding.primaryColor,
      '--on-brand': onBrandFor(branding.primaryColor),
    } as CSSProperties;
  }, [scoped, branding.primaryColor]);

  const name = scoped && ownerName ? ownerName : 'Sportline';
  const short = name.charAt(0).toUpperCase();

  if (isLanding) {
    return (
      <div
        className="floodlit"
        data-fl-mode={mode}
        style={{ ...brandStyle, minHeight: '100vh' }}
      >
        <Outlet />
        <ToastHost />
      </div>
    );
  }

  const navActive = (m: string[]) =>
    m.some((p) => loc.pathname === p || loc.pathname.startsWith(p + '/'));

  return (
    <div
      className="floodlit"
      data-fl-mode={mode}
      style={{ ...brandStyle, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      {/* ===== Top bar ===== */}
      <header
        className="sticky top-0 z-40"
        style={{
          background: 'color-mix(in oklab, var(--bg) 86%, transparent)',
          backdropFilter: 'blur(14px)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="flex min-w-0 flex-1 items-center gap-2.5">
            {scoped && branding.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt=""
                className="h-9 w-9 shrink-0 rounded-[10px] object-contain"
                style={{ background: 'var(--surface)', padding: 3 }}
              />
            ) : (
              <span
                className="fl-display grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-lg"
                style={{ background: 'var(--brand)', color: 'var(--on-brand)', fontWeight: 800 }}
              >
                {short}
              </span>
            )}
            <span className="min-w-0">
              <span className="fl-display block truncate text-base font-bold leading-none">
                {name}
              </span>
              {scoped && (
                <span className="block truncate text-[11px]" style={{ color: 'var(--faint)' }}>
                  white-label storefront
                </span>
              )}
            </span>
          </Link>

          {/* Exit the white-label storefront back to the full marketplace. */}
          {scoped && (
            <button
              onClick={exitToMarketplace}
              className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors"
              style={{ border: '1px solid var(--line-strong)', color: 'var(--muted)' }}
              title="Browse all operators on Sportline"
            >
              All grounds
            </button>
          )}

          {/* desktop nav */}
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => {
              const active = navActive(n.match);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className="rounded-xl px-3 py-2 text-sm font-medium transition-colors"
                  style={{ color: active ? 'var(--brand)' : 'var(--muted)' }}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={toggleMode}
              aria-label="Toggle day / night"
              className="grid h-9 w-9 place-items-center rounded-[10px]"
              style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--chalk)' }}
            >
              {mode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            {isPlayer ? (
              <Link
                to="/account"
                aria-label="Account"
                className="fl-display grid h-9 w-9 place-items-center rounded-full text-sm"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--line-strong)', fontWeight: 700 }}
              >
                {(user?.name || 'P').charAt(0).toUpperCase()}
              </Link>
            ) : (
              <Link
                to="/login"
                className="inline-flex h-9 items-center rounded-[10px] px-3.5 text-[13px] font-semibold"
                style={{ background: 'var(--surface)', border: '1px solid var(--line-strong)', color: 'var(--chalk)' }}
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* ===== Content ===== */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 sm:px-6 md:pb-10">
        {/* Keyed by route so the fade+lift transition replays on each tab switch. */}
        <div key={loc.pathname} className="fl-page-enter">
          <Outlet />
        </div>
      </main>

      {/* ===== Bottom nav (mobile) ===== */}
      <nav
        className="sticky bottom-0 z-40 flex md:hidden"
        style={{
          background: 'color-mix(in oklab, var(--bg) 92%, transparent)',
          backdropFilter: 'blur(14px)',
          borderTop: '1px solid var(--line)',
          padding: '8px 6px calc(8px + env(safe-area-inset-bottom))',
        }}
      >
        {NAV.map((n) => {
          const active = navActive(n.match);
          const Icon = n.icon;
          return (
            <button
              key={n.to}
              onClick={() => nav(n.to)}
              className="flex flex-1 flex-col items-center gap-1 py-1.5"
              style={{ background: 'none', border: 'none', color: active ? 'var(--brand)' : 'var(--faint)' }}
            >
              <Icon className="h-[19px] w-[19px]" />
              <span className="text-[10px] font-semibold">{n.label}</span>
              <span
                className="h-0.5 w-4 rounded-full"
                style={{ background: active ? 'var(--brand)' : 'transparent' }}
              />
            </button>
          );
        })}
      </nav>

      <ToastHost />
    </div>
  );
}

/** Wrap the consumer subtree in the Floodlit toast provider + the shell. */
export function ConsumerLayoutRoot() {
  return (
    <FloodlitToastProvider>
      <ConsumerLayout />
    </FloodlitToastProvider>
  );
}

export { cn };
