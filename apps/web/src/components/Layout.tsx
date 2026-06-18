import { UserRole } from '@sportsbooking/shared';
import { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Activity, LogOut, Moon, Sun } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeProvider';

const NAV: Record<UserRole, { to: string; label: string }[]> = {
  [UserRole.CUSTOMER]: [
    { to: '/book', label: 'Book' },
    { to: '/wallet', label: 'Wallet' },
    { to: '/tournaments', label: 'Tournaments' },
    { to: '/account', label: 'Account' },
  ],
  [UserRole.OWNER]: [
    { to: '/owner', label: 'Dashboard' },
    { to: '/owner/new-booking', label: 'New booking' },
    { to: '/owner/bookings', label: 'Bookings' },
    { to: '/owner/venues', label: 'Venues' },
    { to: '/owner/packs', label: 'Packs' },
    { to: '/owner/offers', label: 'Offers' },
    { to: '/owner/players', label: 'Players' },
    { to: '/owner/tournaments', label: 'Tournaments' },
  ],
  [UserRole.STAFF]: [
    { to: '/owner/new-booking', label: 'New booking' },
    { to: '/owner/bookings', label: 'Bookings' },
    { to: '/owner/venues', label: 'Venues' },
  ],
  [UserRole.SUPER_ADMIN]: [
    { to: '/admin', label: 'Platform' },
    { to: '/admin/games', label: 'Games' },
    { to: '/admin/owners', label: 'Owners' },
  ],
};

const ROLE_LABEL: Record<UserRole, string> = {
  [UserRole.CUSTOMER]: 'Player',
  [UserRole.OWNER]: 'Owner',
  [UserRole.STAFF]: 'Staff',
  [UserRole.SUPER_ADMIN]: 'Admin',
};

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { branding, mode, toggleMode } = useTheme();
  const loc = useLocation();
  const links = user ? NAV[user.role] : [];
  const [logoBroken, setLogoBroken] = useState(false);
  useEffect(() => setLogoBroken(false), [branding.logoUrl]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <nav className="max-w-[80rem] mx-auto px-4 h-16 flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2 shrink-0">
            {branding.logoUrl && !logoBroken ? (
              <img
                src={branding.logoUrl}
                alt=""
                onError={() => setLogoBroken(true)}
                className="h-8 w-8 rounded-lg object-contain bg-secondary/60 p-0.5"
              />
            ) : (
              <span className="grid place-items-center h-8 w-8 rounded-lg bg-primary text-primary-foreground">
                <Activity className="h-5 w-5" strokeWidth={2.5} />
              </span>
            )}
            <span className="font-display font-bold text-xl tracking-tight">
              Sport<span className="text-primary">line</span>
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-1 overflow-x-auto hide-scrollbar">
            {links.map((l) => {
              const active = loc.pathname === l.to;
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:text-secondary-foreground hover:bg-secondary'
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-3 shrink-0">
            <button
              onClick={toggleMode}
              className="grid place-items-center h-9 w-9 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
              title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {mode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            {user ? (
              <>
                <div className="hidden sm:flex flex-col items-end leading-tight">
                  <span className="text-sm font-medium">{user.name}</span>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-primary">
                    {ROLE_LABEL[user.role]}
                  </span>
                </div>
                <button
                  onClick={logout}
                  className="grid place-items-center h-9 w-9 rounded-lg border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
                  title="Logout"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold"
              >
                Login
              </Link>
            )}
          </div>
        </nav>

        {/* Mobile nav row */}
        {links.length > 0 && (
          <div className="md:hidden border-t border-border">
            <div className="max-w-[80rem] mx-auto px-2 flex items-center gap-1 overflow-x-auto hide-scrollbar py-2">
              {links.map((l) => {
                const active = loc.pathname === l.to;
                return (
                  <Link
                    key={l.to}
                    to={l.to}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${
                      active
                        ? 'bg-primary/15 text-primary'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </header>

      <main>{children}</main>
    </div>
  );
}
