import { UserRole } from '@sportsbooking/shared';
import { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { isRole, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { GamesPage } from './pages/admin/GamesPage';
import { OwnersPage } from './pages/admin/OwnersPage';
import { PlatformPage } from './pages/admin/PlatformPage';
import { AccountPage } from './pages/customer/AccountPage';
import { BookingPage } from './pages/customer/BookingPage';
import { TournamentsPage } from './pages/customer/TournamentsPage';
import { WalletPage } from './pages/customer/WalletPage';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/owner/DashboardPage';
import { OffersPage } from './pages/owner/OffersPage';
import { PacksPage } from './pages/owner/PacksPage';
import { PlayersPage } from './pages/owner/PlayersPage';
import { TournamentsAdminPage } from './pages/owner/TournamentsAdminPage';
import { VenuesPage } from './pages/owner/VenuesPage';

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
    </Layout>
  );
}
