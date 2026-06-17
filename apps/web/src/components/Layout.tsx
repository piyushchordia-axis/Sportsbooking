import { UserRole } from '@sportsbooking/shared';
import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const NAV: Record<UserRole, { to: string; label: string }[]> = {
  [UserRole.CUSTOMER]: [
    { to: '/book', label: 'Book' },
    { to: '/wallet', label: 'Wallet' },
    { to: '/tournaments', label: 'Tournaments' },
    { to: '/account', label: 'Account' },
  ],
  [UserRole.OWNER]: [
    { to: '/owner', label: 'Dashboard' },
    { to: '/owner/venues', label: 'Venues' },
    { to: '/owner/packs', label: 'Packs' },
    { to: '/owner/offers', label: 'Offers' },
    { to: '/owner/players', label: 'Players' },
    { to: '/owner/tournaments', label: 'Tournaments' },
  ],
  [UserRole.STAFF]: [{ to: '/owner/venues', label: 'Venues' }],
  [UserRole.SUPER_ADMIN]: [
    { to: '/admin', label: 'Platform' },
    { to: '/admin/games', label: 'Games' },
    { to: '/admin/owners', label: 'Owners' },
  ],
};

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const links = user ? NAV[user.role] : [];

  return (
    <>
      <nav className="nav">
        <strong>🏟️ SportsBooking</strong>
        {links.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            style={{ fontWeight: loc.pathname === l.to ? 700 : 400 }}
          >
            {l.label}
          </Link>
        ))}
        <span style={{ marginLeft: 'auto' }} />
        {user ? (
          <>
            <span style={{ opacity: 0.8 }}>
              {user.name} · {user.role}
            </span>
            <a href="#" onClick={logout}>
              Logout
            </a>
          </>
        ) : (
          <Link to="/login">Login</Link>
        )}
      </nav>
      {children}
    </>
  );
}
