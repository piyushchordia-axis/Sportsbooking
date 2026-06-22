import { UserRole } from '@sportsbooking/shared';
import { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Activity,
  Bell,
  Building2,
  CalendarPlus,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Gamepad2,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Lock,
  LogOut,
  type LucideIcon,
  Moon,
  Palette,
  PanelLeft,
  Search,
  Send,
  Settings,
  Sun,
  Tag,
  Ticket,
  Trophy,
  UserCog,
  Users,
} from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { initials } from '../lib/imagery';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { cn } from './ui/utils';

interface NavLeaf {
  to: string;
  label: string;
  icon: LucideIcon;
}
interface NavGroup {
  label: string;
  icon: LucideIcon;
  children: NavLeaf[];
}
type NavNode = NavLeaf | NavGroup;
const isGroup = (n: NavNode): n is NavGroup => 'children' in n;

// Customers live in the consumer shell (ConsumerLayout), so they have no entry
// here — this map only drives the admin/owner/staff/super-admin console sidebar.
const NAV: Partial<Record<UserRole, NavNode[]>> = {
  [UserRole.OWNER]: [
    { to: '/owner', label: 'Dashboard', icon: LayoutDashboard },
    {
      label: 'Bookings',
      icon: ClipboardList,
      children: [
        { to: '/owner/new-booking', label: 'New Booking', icon: CalendarPlus },
        { to: '/owner/bookings', label: 'All Bookings', icon: ClipboardList },
      ],
    },
    {
      label: 'Catalog',
      icon: Building2,
      children: [
        { to: '/owner/venues', label: 'Grounds', icon: Building2 },
        { to: '/owner/packs', label: 'Packs', icon: Ticket },
        { to: '/owner/offers', label: 'Offers', icon: Tag },
        { to: '/owner/branding', label: 'Branding', icon: Palette },
      ],
    },
    { to: '/owner/players', label: 'Players', icon: Users },
    { to: '/owner/staff', label: 'Staff', icon: UserCog },
    { to: '/owner/tournaments', label: 'Tournaments', icon: Trophy },
  ],
  [UserRole.STAFF]: [
    { to: '/owner/new-booking', label: 'New Booking', icon: CalendarPlus },
    { to: '/owner/bookings', label: 'Bookings', icon: ClipboardList },
    { to: '/owner/venues', label: 'Grounds', icon: Building2 },
  ],
  [UserRole.SUPER_ADMIN]: [
    { to: '/admin', label: 'Platform', icon: LayoutDashboard },
    { to: '/admin/games', label: 'Games', icon: Gamepad2 },
    { to: '/admin/owners', label: 'Owners', icon: Building2 },
  ],
};

const SYSTEM: { label: string; icon: LucideIcon }[] = [
  { label: 'Support', icon: LifeBuoy },
  { label: 'Feedback', icon: Send },
  { label: 'Settings', icon: Settings },
];

const ROLE_LABEL: Record<UserRole, string> = {
  [UserRole.CUSTOMER]: 'Player',
  [UserRole.OWNER]: 'Owner',
  [UserRole.STAFF]: 'Staff',
  [UserRole.SUPER_ADMIN]: 'Super Admin',
};

const COLLAPSE_KEY = 'reflex-sidebar-collapsed';
// Active on an exact match, or — for deep routes only — a sub-path. Section-index
// routes like '/owner' and '/admin' must match EXACTLY, otherwise they'd light up
// for every child route (e.g. Dashboard showing active on /owner/players).
const isActive = (path: string, to: string) =>
  path === to || (to.split('/').filter(Boolean).length >= 2 && path.startsWith(to + '/'));

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { branding, mode, toggleMode } = useTheme();
  const loc = useLocation();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [logoBroken, setLogoBroken] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => setLogoBroken(false), [branding.logoUrl]);
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  // Close transient surfaces on navigation.
  useEffect(() => {
    setMobileOpen(false);
    setUserMenu(false);
  }, [loc.pathname]);

  // The login screen always renders full-bleed (no app shell), even if a stale
  // session is still in localStorage.
  if (!user || loc.pathname === '/login') return <>{children}</>;

  const nav = NAV[user.role] ?? [];
  const groupHasActive = (g: NavGroup) => g.children.some((c) => isActive(loc.pathname, c.to));
  const groupOpen = (g: NavGroup) => openGroups[g.label] ?? groupHasActive(g);

  const flash = (label: string) => {
    setToast(`${label} is coming soon.`);
    window.setTimeout(() => setToast(null), 2600);
  };

  const leafClass = (active: boolean) =>
    cn(
      'group/nav flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
      collapsed && 'lg:justify-center lg:px-0',
      active
        ? 'bg-primary/12 text-primary'
        : 'text-muted-foreground hover:text-foreground hover:bg-muted',
    );

  const labelClass = cn('truncate', collapsed && 'lg:hidden');

  const renderLeaf = (n: NavLeaf, opts?: { nested?: boolean }) => {
    const active = isActive(loc.pathname, n.to);
    const Icon = n.icon;
    return (
      <Link key={n.to} to={n.to} title={n.label} className={leafClass(active)}>
        <Icon className={cn('h-[18px] w-[18px] shrink-0', opts?.nested && !collapsed && 'h-4 w-4')} />
        <span className={labelClass}>{n.label}</span>
        {active && !collapsed && (
          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary lg:block hidden" />
        )}
      </Link>
    );
  };

  const renderGroup = (g: NavGroup) => {
    const Icon = g.icon;
    const hasActive = groupHasActive(g);
    // Collapsed desktop rail: flatten to its child icons (no toggle).
    if (collapsed) {
      return (
        <div key={g.label} className="lg:contents">
          <button
            onClick={() => setOpenGroups((s) => ({ ...s, [g.label]: !groupOpen(g) }))}
            title={g.label}
            className={cn(leafClass(hasActive), 'w-full lg:hidden')}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            <span className={labelClass}>{g.label}</span>
          </button>
          {/* rail icons (desktop only) */}
          <div className="hidden lg:flex lg:flex-col lg:gap-1">
            {g.children.map((c) => renderLeaf(c))}
          </div>
          {/* expanded children (mobile drawer only) */}
          {groupOpen(g) && (
            <div className="lg:hidden ml-3 flex flex-col gap-1 border-l border-border pl-3">
              {g.children.map((c) => renderLeaf(c, { nested: true }))}
            </div>
          )}
        </div>
      );
    }
    const open = groupOpen(g);
    return (
      <div key={g.label}>
        <button
          onClick={() => setOpenGroups((s) => ({ ...s, [g.label]: !open }))}
          className={cn(
            'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
            hasActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
          )}
        >
          <Icon className="h-[18px] w-[18px] shrink-0" />
          <span className="truncate">{g.label}</span>
          <ChevronDown
            className={cn('ml-auto h-4 w-4 transition-transform', open && 'rotate-180')}
          />
        </button>
        {open && (
          <div className="mt-1 ml-3 flex flex-col gap-1 border-l border-border pl-3">
            {g.children.map((c) => renderLeaf(c, { nested: true }))}
          </div>
        )}
      </div>
    );
  };

  const sectionLabel = (text: string) => (
    <p
      className={cn(
        'px-3 pt-5 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70',
        collapsed && 'lg:hidden',
      )}
    >
      {text}
    </p>
  );

  return (
    <div className="min-h-screen flex">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed lg:sticky top-0 z-50 lg:z-30 h-screen shrink-0 flex flex-col',
          'bg-sidebar border-r border-border transition-[width,transform] duration-200 ease-out',
          'w-[270px]',
          collapsed ? 'lg:w-[76px]' : 'lg:w-[270px]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        {/* Brand */}
        <Link
          to="/"
          className="flex h-16 items-center gap-2.5 px-4 shrink-0 border-b border-border"
        >
          {branding.logoUrl && !logoBroken ? (
            <img
              src={branding.logoUrl}
              alt=""
              onError={() => setLogoBroken(true)}
              className="h-9 w-9 rounded-xl object-contain bg-secondary/60 p-1 shrink-0"
            />
          ) : (
            <span className="grid place-items-center h-9 w-9 rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/25 shrink-0">
              <Activity className="h-5 w-5" strokeWidth={2.6} />
            </span>
          )}
          <span
            className={cn(
              'font-display font-extrabold text-lg tracking-tight leading-none',
              collapsed && 'lg:hidden',
            )}
          >
            Sport<span className="text-primary">line</span>
          </span>
        </Link>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto hide-scrollbar px-3 pb-3">
          {sectionLabel('Workspace')}
          <div className="flex flex-col gap-1">
            {nav.map((n) => (isGroup(n) ? renderGroup(n) : renderLeaf(n)))}
          </div>
        </nav>

        {/* User card */}
        <div className="relative border-t border-border p-3">
          {userMenu && (
            <div className="absolute bottom-full left-3 right-3 mb-2 rounded-xl border border-border bg-popover p-1 shadow-2xl">
              {SYSTEM.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.label}
                    onClick={() => {
                      setUserMenu(false);
                      flash(s.label);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    <Icon className="h-4 w-4" /> {s.label}
                  </button>
                );
              })}
              <div className="my-1 h-px bg-border" />
              <button
                onClick={() => {
                  setUserMenu(false);
                  setPwOpen(true);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                <KeyRound className="h-4 w-4" /> Change password
              </button>
              <button
                onClick={logout}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-destructive hover:bg-muted"
              >
                <LogOut className="h-4 w-4" /> Log out
              </button>
            </div>
          )}
          <button
            onClick={() => setUserMenu((v) => !v)}
            className="flex w-full items-center gap-3 rounded-xl p-2 transition-colors hover:bg-muted"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary text-sm font-semibold ring-1 ring-primary/30">
              {initials(user.name)}
            </span>
            <span className={cn('min-w-0 flex-1 text-left leading-tight', collapsed && 'lg:hidden')}>
              <span className="block truncate text-sm font-semibold">{user.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {user.email || user.mobile || ROLE_LABEL[user.role]}
              </span>
            </span>
            <ChevronUp
              className={cn('h-4 w-4 shrink-0 text-muted-foreground', collapsed && 'lg:hidden')}
            />
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md">
          <button
            onClick={() =>
              window.innerWidth >= 1024
                ? setCollapsed((v) => !v)
                : setMobileOpen((v) => !v)
            }
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground hover:border-primary/40"
            aria-label="Toggle sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </button>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              flash('Universal search');
            }}
            className="relative hidden sm:block flex-1 max-w-2xl"
          >
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search venues, bookings, players…"
              aria-label="Search the console (coming soon)"
              className="h-10 w-full rounded-xl border border-border bg-input-background pl-10 pr-20 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Soon
            </span>
          </form>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => flash('Notifications')}
              className="relative grid h-9 w-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground hover:border-primary/40"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-destructive" />
            </button>
            <button
              onClick={toggleMode}
              className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground hover:border-primary/40"
              aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {mode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary text-sm font-semibold ring-1 ring-primary/30">
              {initials(user.name)}
            </span>
          </div>
        </header>

        <main className="flex-1">{children}</main>
      </div>

      {/* Coming-soon toast */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-xl border border-border bg-popover px-4 py-2.5 text-sm font-medium text-popover-foreground shadow-2xl">
          {toast}
        </div>
      )}

      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </div>
  );
}

const pwInput =
  'h-11 w-full rounded-xl border border-border bg-input-background pl-10 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20';

/**
 * Change-password dialog for owner/staff/super-admin (the admin shell).
 * Customers use the consumer shell + OTP, so this never renders for them.
 */
function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Reset transient state whenever the dialog is opened or closed.
  useEffect(() => {
    if (!open) {
      setCurrent('');
      setNext('');
      setConfirm('');
      setBusy(false);
      setError(null);
      setDone(false);
    }
  }, [open]);

  const submit = async () => {
    setError(null);
    if (next.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setError('New password and confirmation do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Update the password for your account. You&apos;ll keep your current session.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm font-medium text-primary">
            Password updated successfully.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Current password</span>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  placeholder="Enter current password"
                  className={pwInput}
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">New password</span>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  placeholder="At least 8 characters"
                  className={pwInput}
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Confirm new password</span>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter new password"
                  className={pwInput}
                  onKeyDown={(e) => e.key === 'Enter' && !busy && submit()}
                />
              </div>
            </label>

            {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {done ? (
            <button
              onClick={() => onOpenChange(false)}
              className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={() => onOpenChange(false)}
                className="h-11 rounded-xl border border-border px-5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy || !current || !next || !confirm}
                className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? 'Updating…' : 'Update password'}
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
