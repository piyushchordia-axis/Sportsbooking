import { UserRole } from '@sportsbooking/shared';
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  CalendarSearch,
  ChevronDown,
  LogOut,
  Moon,
  Sun,
  Swords,
  Trophy,
  User,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { useStorefront } from '../storefront/StorefrontProvider';
import { initials } from '../lib/imagery';
import { cn } from './ui/utils';

const NAV = [
  { to: '/browse', label: 'Browse', icon: CalendarSearch },
  { to: '/open-matches', label: 'Open matches', icon: Swords },
  { to: '/tournaments', label: 'Tournaments', icon: Trophy },
];

const ACCOUNT = [
  { to: '/my-bookings', label: 'My bookings', icon: CalendarSearch },
  { to: '/wallet', label: 'Wallet', icon: Wallet },
  { to: '/account', label: 'Account', icon: User },
];

/**
 * Public, consumer-facing shell for the player storefront (landing / browse /
 * venue / book). A marketing-style top navbar + footer — NOT the admin sidebar.
 * Re-themes to a venue owner's branding (white-label) via ThemeProvider, which
 * pages set when an owner/venue context is in view.
 */
export function ConsumerLayout() {
  const { user, logout } = useAuth();
  const { branding, mode, toggleMode } = useTheme();
  const { scoped, ownerName, exitStorefront } = useStorefront();
  const loc = useLocation();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const [logoBroken, setLogoBroken] = useState(false);

  useEffect(() => setLogoBroken(false), [branding.logoUrl]);
  useEffect(() => setMenu(false), [loc.pathname]);

  const isPlayer = user?.role === UserRole.CUSTOMER;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[80rem] items-center gap-6 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 shrink-0">
            {branding.logoUrl && !logoBroken ? (
              <img
                src={branding.logoUrl}
                alt=""
                onError={() => setLogoBroken(true)}
                className="h-9 w-9 rounded-xl object-contain bg-secondary/60 p-1"
              />
            ) : (
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
                <Activity className="h-5 w-5" strokeWidth={2.6} />
              </span>
            )}
            <span className="ff-display text-lg font-extrabold tracking-tight truncate max-w-[12rem]">
              {scoped && ownerName ? (
                ownerName
              ) : (
                <>
                  Sport<span className="text-primary">line</span>
                </>
              )}
            </span>
          </Link>
          {scoped && (
            <button
              onClick={exitStorefront}
              className="hidden lg:inline-flex shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-primary/40"
              title="Browse all operators on Sportline"
            >
              All operators
            </button>
          )}

          <nav className="hidden md:flex items-center gap-1">
            {NAV.map((n) => {
              const active = loc.pathname === n.to || loc.pathname.startsWith(n.to + '/');
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={cn(
                    'rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'text-primary bg-primary/10'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={toggleMode}
              aria-label="Toggle theme"
              className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground hover:border-primary/40"
            >
              {mode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {isPlayer ? (
              <div className="relative">
                <button
                  onClick={() => setMenu((v) => !v)}
                  className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-2.5 transition-colors hover:border-primary/40"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-primary text-xs font-semibold ring-1 ring-primary/30">
                    {initials(user?.name)}
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </button>
                {menu && (
                  <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-border bg-popover p-1 shadow-2xl">
                    <div className="px-3 py-2">
                      <p className="truncate text-sm font-semibold">{user?.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {user?.mobile || 'Player'}
                      </p>
                    </div>
                    <div className="my-1 h-px bg-border" />
                    {ACCOUNT.map((a) => (
                      <Link
                        key={a.to}
                        to={a.to}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <a.icon className="h-4 w-4" /> {a.label}
                      </Link>
                    ))}
                    <div className="my-1 h-px bg-border" />
                    <button
                      onClick={() => {
                        logout();
                        nav('/');
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-destructive hover:bg-muted"
                    >
                      <LogOut className="h-4 w-4" /> Log out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Link
                  to="/login"
                  className="rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Sign in
                </Link>
                <Link
                  to="/browse"
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Book now
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Mobile nav row */}
        <div className="md:hidden border-t border-border">
          <div className="mx-auto flex max-w-[80rem] items-center gap-1 overflow-x-auto px-2 py-2">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                <n.icon className="h-4 w-4" /> {n.label}
              </Link>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-border bg-elevated/40">
        <div className="mx-auto flex max-w-[80rem] flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Activity className="h-4 w-4" strokeWidth={2.6} />
            </span>
            <span className="ff-display font-bold">
              Sport<span className="text-primary">line</span>
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Book turf, courts &amp; games near you — © {new Date().getFullYear()} Sportline.
          </p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link to="/browse" className="hover:text-foreground">
              Browse
            </Link>
            <Link to="/open-matches" className="hover:text-foreground">
              Open matches
            </Link>
            <Link to="/tournaments" className="hover:text-foreground">
              Tournaments
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
