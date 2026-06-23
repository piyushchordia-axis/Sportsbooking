import { UserRole } from '@sportsbooking/shared';
import { lazy, ReactNode, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { isRole, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { ConsumerLayoutRoot } from './components/ConsumerLayout';
import { StorefrontProvider } from './storefront/StorefrontProvider';

// Consumer storefront (public)
const LandingPage = lazy(() =>
  import('./pages/consumer/LandingPage').then((m) => ({ default: m.LandingPage })),
);
const BrowsePage = lazy(() =>
  import('./pages/consumer/BrowsePage').then((m) => ({ default: m.BrowsePage })),
);
const VenueDetailPage = lazy(() =>
  import('./pages/consumer/VenueDetailPage').then((m) => ({ default: m.VenueDetailPage })),
);

// Player account area (consumer shell, authed)
const AccountPage = lazy(() =>
  import('./pages/customer/AccountPage').then((m) => ({ default: m.AccountPage })),
);
const TournamentsPage = lazy(() =>
  import('./pages/customer/TournamentsPage').then((m) => ({ default: m.TournamentsPage })),
);
const MyBookingsPage = lazy(() =>
  import('./pages/customer/MyBookingsPage').then((m) => ({ default: m.MyBookingsPage })),
);
const WalletPage = lazy(() =>
  import('./pages/customer/WalletPage').then((m) => ({ default: m.WalletPage })),
);
const OpenMatchesPage = lazy(() =>
  import('./pages/customer/OpenMatchesPage').then((m) => ({ default: m.OpenMatchesPage })),
);
const SavedVenuesPage = lazy(() =>
  import('./pages/customer/SavedVenuesPage').then((m) => ({ default: m.SavedVenuesPage })),
);
const OffersInboxPage = lazy(() =>
  import('./pages/customer/OffersInboxPage').then((m) => ({ default: m.OffersInboxPage })),
);

// Player auth (OTP) — consumer storefront. Console auth lives at /admin/login.
const PlayerAuthPage = lazy(() =>
  import('./pages/consumer/PlayerAuthPage').then((m) => ({ default: m.PlayerAuthPage })),
);
const AdminLoginPage = lazy(() =>
  import('./pages/admin/AdminLoginPage').then((m) => ({ default: m.AdminLoginPage })),
);

// Admin / owner console (sidebar shell)
const GamesPage = lazy(() =>
  import('./pages/admin/GamesPage').then((m) => ({ default: m.GamesPage })),
);
const OwnersPage = lazy(() =>
  import('./pages/admin/OwnersPage').then((m) => ({ default: m.OwnersPage })),
);
const PlatformPage = lazy(() =>
  import('./pages/admin/PlatformPage').then((m) => ({ default: m.PlatformPage })),
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
const StaffPage = lazy(() =>
  import('./pages/owner/StaffPage').then((m) => ({ default: m.StaffPage })),
);
const TournamentsAdminPage = lazy(() =>
  import('./pages/owner/TournamentsAdminPage').then((m) => ({
    default: m.TournamentsAdminPage,
  })),
);
const VenuesPage = lazy(() =>
  import('./pages/owner/VenuesPage').then((m) => ({ default: m.VenuesPage })),
);
const ActivityPage = lazy(() =>
  import('./pages/owner/ActivityPage').then((m) => ({ default: m.ActivityPage })),
);
const LoyaltyPage = lazy(() =>
  import('./pages/owner/LoyaltyPage').then((m) => ({ default: m.LoyaltyPage })),
);
const OwnerVenueDetailPage = lazy(() =>
  import('./pages/owner/VenueDetailPage').then((m) => ({ default: m.VenueDetailPage })),
);
const BrandingPage = lazy(() =>
  import('./pages/owner/BrandingPage').then((m) => ({ default: m.BrandingPage })),
);

function Require({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { user } = useAuth();
  // Players authenticate at /login (OTP); the console (owner/staff/super-admin)
  // authenticates at /admin/login — which is only reachable by typing it.
  const loginPath = roles.includes(UserRole.CUSTOMER) ? '/login' : '/admin/login';
  if (!user || !isRole(user, ...roles)) return <Navigate to={loginPath} replace />;
  return <>{children}</>;
}

const customer = (el: ReactNode) => <Require roles={[UserRole.CUSTOMER]}>{el}</Require>;
const owner = (el: ReactNode) => (
  <Require roles={[UserRole.OWNER, UserRole.STAFF]}>{el}</Require>
);
const admin = (el: ReactNode) => <Require roles={[UserRole.SUPER_ADMIN]}>{el}</Require>;

/** Owner/staff/super-admin console — the sidebar shell. */
function AdminShell() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

/** Public consumer storefront — wraps the consumer layout in the per-owner
 *  white-label storefront context (resolves owner from subdomain/path/param). */
function ConsumerRoot() {
  return (
    <StorefrontProvider>
      <ConsumerLayoutRoot />
    </StorefrontProvider>
  );
}

export function App() {
  return (
    <Suspense
      fallback={<div className="container py-10 text-muted-foreground">Loading…</div>}
    >
      <Routes>
        {/* Full-bleed auth screens. Players sign in with OTP at /login; the
            owner/staff/super-admin console signs in at /admin/login, which is
            only reached by navigating to /admin directly — never linked from
            the consumer storefront. */}
        <Route path="/login" element={<PlayerAuthPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />

        {/* Public consumer storefront + authed player area */}
        <Route element={<ConsumerRoot />}>
          <Route path="/" element={<LandingPage />} />
          {/* Per-owner white-label storefront entry (subdomain-equivalent in dev) */}
          <Route path="/s/:key" element={<LandingPage />} />
          <Route path="/browse" element={<BrowsePage />} />
          <Route path="/venue/:venueId" element={<VenueDetailPage />} />
          <Route path="/tournaments" element={<TournamentsPage />} />
          {/* Public: guests can browse open matches; joining/creating prompts
              login inside the page (see OpenMatchesPage). */}
          <Route path="/open-matches" element={<OpenMatchesPage />} />
          <Route path="/my-bookings" element={customer(<MyBookingsPage />)} />
          <Route path="/saved" element={customer(<SavedVenuesPage />)} />
          <Route path="/offers" element={customer(<OffersInboxPage />)} />
          <Route path="/wallet" element={customer(<WalletPage />)} />
          <Route path="/account" element={customer(<AccountPage />)} />
          {/* Legacy authed booking route → public browse */}
          <Route path="/book" element={<Navigate to="/browse" replace />} />
        </Route>

        {/* Owner / staff / super-admin console */}
        <Route element={<AdminShell />}>
          <Route path="/owner" element={owner(<DashboardPage />)} />
          <Route path="/owner/new-booking" element={owner(<NewBookingPage />)} />
          <Route path="/owner/bookings" element={owner(<BookingsPage />)} />
          <Route path="/owner/venues" element={owner(<VenuesPage />)} />
          <Route
            path="/owner/venues/:id"
            element={owner(<OwnerVenueDetailPage />)}
          />
          <Route path="/owner/branding" element={owner(<BrandingPage />)} />
          <Route path="/owner/packs" element={owner(<PacksPage />)} />
          <Route path="/owner/offers" element={owner(<OffersPage />)} />
          <Route path="/owner/players" element={owner(<PlayersPage />)} />
          <Route path="/owner/staff" element={owner(<StaffPage />)} />
          <Route path="/owner/tournaments" element={owner(<TournamentsAdminPage />)} />
          <Route path="/owner/activity" element={owner(<ActivityPage />)} />
          <Route path="/owner/loyalty" element={owner(<LoyaltyPage />)} />
          <Route path="/admin" element={admin(<PlatformPage />)} />
          <Route path="/admin/games" element={admin(<GamesPage />)} />
          <Route path="/admin/owners" element={admin(<OwnersPage />)} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
