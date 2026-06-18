import { UserRole } from '@sportsbooking/shared';
import { lazy, ReactNode, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { isRole, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';

const GamesPage = lazy(() =>
  import('./pages/admin/GamesPage').then((m) => ({ default: m.GamesPage })),
);
const OwnersPage = lazy(() =>
  import('./pages/admin/OwnersPage').then((m) => ({ default: m.OwnersPage })),
);
const PlatformPage = lazy(() =>
  import('./pages/admin/PlatformPage').then((m) => ({ default: m.PlatformPage })),
);
const AccountPage = lazy(() =>
  import('./pages/customer/AccountPage').then((m) => ({ default: m.AccountPage })),
);
const BookingPage = lazy(() =>
  import('./pages/customer/BookingPage').then((m) => ({ default: m.BookingPage })),
);
const TournamentsPage = lazy(() =>
  import('./pages/customer/TournamentsPage').then((m) => ({ default: m.TournamentsPage })),
);
const WalletPage = lazy(() =>
  import('./pages/customer/WalletPage').then((m) => ({ default: m.WalletPage })),
);
const LoginPage = lazy(() =>
  import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })),
);
const DashboardPage = lazy(() =>
  import('./pages/owner/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const NewBookingPage = lazy(() =>
  import('./pages/owner/NewBookingPage').then((m) => ({ default: m.NewBookingPage })),
);
const BookingsPage = lazy(() =>
  import('./pages/owner/BookingsPage').then((m) => ({ default: m.BookingsPage })),
);
const OffersPage = lazy(() =>
  import('./pages/owner/OffersPage').then((m) => ({ default: m.OffersPage })),
);
const PacksPage = lazy(() =>
  import('./pages/owner/PacksPage').then((m) => ({ default: m.PacksPage })),
);
const PlayersPage = lazy(() =>
  import('./pages/owner/PlayersPage').then((m) => ({ default: m.PlayersPage })),
);
const TournamentsAdminPage = lazy(() =>
  import('./pages/owner/TournamentsAdminPage').then((m) => ({
    default: m.TournamentsAdminPage,
  })),
);
const VenuesPage = lazy(() =>
  import('./pages/owner/VenuesPage').then((m) => ({ default: m.VenuesPage })),
);

function Require({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!isRole(user, ...roles)) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const customer = (el: ReactNode) => <Require roles={[UserRole.CUSTOMER]}>{el}</Require>;
const owner = (el: ReactNode) => (
  <Require roles={[UserRole.OWNER, UserRole.STAFF]}>{el}</Require>
);
const admin = (el: ReactNode) => <Require roles={[UserRole.SUPER_ADMIN]}>{el}</Require>;

export function App() {
  return (
    <Layout>
      <Suspense fallback={<div className="container py-10 text-muted-foreground">Loading…</div>}>
        <Routes>
          <Route path="/" element={<Navigate to="/book" replace />} />
          <Route path="/login" element={<LoginPage />} />

          {/* Customer */}
          <Route path="/book" element={customer(<BookingPage />)} />
          <Route path="/wallet" element={customer(<WalletPage />)} />
          <Route path="/tournaments" element={customer(<TournamentsPage />)} />
          <Route path="/account" element={customer(<AccountPage />)} />

          {/* Owner / staff */}
          <Route path="/owner" element={owner(<DashboardPage />)} />
          <Route path="/owner/new-booking" element={owner(<NewBookingPage />)} />
          <Route path="/owner/bookings" element={owner(<BookingsPage />)} />
          <Route path="/owner/venues" element={owner(<VenuesPage />)} />
          <Route path="/owner/packs" element={owner(<PacksPage />)} />
          <Route path="/owner/offers" element={owner(<OffersPage />)} />
          <Route path="/owner/players" element={owner(<PlayersPage />)} />
          <Route path="/owner/tournaments" element={owner(<TournamentsAdminPage />)} />

          {/* Super admin */}
          <Route path="/admin" element={admin(<PlatformPage />)} />
          <Route path="/admin/games" element={admin(<GamesPage />)} />
          <Route path="/admin/owners" element={admin(<OwnersPage />)} />

          <Route path="*" element={<Navigate to="/book" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
