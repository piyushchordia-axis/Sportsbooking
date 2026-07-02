import { FeatureFlag, UserRole } from '@sportsbooking/shared';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Bell,
  BellOff,
  Building2,
  CalendarPlus,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Gamepad2,
  Gift,
  History,
  KeyRound,
  LayoutDashboard,
  Loader2,
  Lock,
  LogOut,
  type LucideIcon,
  Moon,
  Palette,
  PanelLeft,
  Search,
  Sun,
  Tag,
  Ticket,
  Trophy,
  UserCog,
  Users,
} from 'lucide-react';
import { api, type NotificationItem, type SearchResults } from '../api/client';
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
  /** If set, the item is shown only when the owner has this entitlement. */
  flag?: FeatureFlag;
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
        { to: '/owner/packs', label: 'Packs', icon: Ticket, flag: FeatureFlag.MEMBERSHIPS },
        { to: '/owner/offers', label: 'Offers', icon: Tag },
        { to: '/owner/branding', label: 'Branding', icon: Palette },
      ],
    },
    { to: '/owner/players', label: 'Players', icon: Users },
    { to: '/owner/staff', label: 'Staff', icon: UserCog },
    { to: '/owner/tournaments', label: 'Tournaments', icon: Trophy, flag: FeatureFlag.TOURNAMENTS },
    { to: '/owner/loyalty', label: 'Loyalty', icon: Gift, flag: FeatureFlag.LOYALTY },
    { to: '/owner/activity', label: 'Activity', icon: History },
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

// Compact "time-ago" label for the notification feed (e.g. "just now", "5m",
// "3h", "2d"); falls back to a short date once past a week.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

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
  const [logoBroken, setLogoBroken] = useState(false);
  // Owner feature entitlements — null until loaded (we show all nav items while
  // loading, then hide the ones the owner isn't entitled to). Staff inherit the
  // owner's flags (the endpoint reads the owner row); other roles skip the fetch.
  const [entFlags, setEntFlags] = useState<FeatureFlag[] | null>(null);

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
  // Load feature entitlements for owner/staff to gate the sidebar. Best-effort:
  // on failure, treat as "no flags" so gated items hide rather than 403 on click.
  useEffect(() => {
    if (user?.role === UserRole.OWNER || user?.role === UserRole.STAFF) {
      api
        .getEntitlements()
        .then((e) => setEntFlags(e.featureFlags))
        .catch(() => setEntFlags([]));
    } else {
      setEntFlags(null);
    }
  }, [user?.id, user?.role]);

  // The login screen always renders full-bleed (no app shell), even if a stale
  // session is still in localStorage.
  if (!user || loc.pathname === '/login') return <>{children}</>;

  // Gate flag-linked nav items by the owner's entitlements. While loading
  // (entFlags === null) everything shows; once loaded, hide leaves whose flag is
  // not enabled, and drop a group left with no visible children.
  const leafVisible = (leaf: NavLeaf): boolean =>
    !leaf.flag || entFlags === null || entFlags.includes(leaf.flag);
  const nav = (NAV[user.role] ?? [])
    .map((n) =>
      isGroup(n) ? { ...n, children: n.children.filter(leafVisible) } : n,
    )
    .filter((n) => (isGroup(n) ? n.children.length > 0 : leafVisible(n)));
  const groupHasActive = (g: NavGroup) => g.children.some((c) => isActive(loc.pathname, c.to));
  const groupOpen = (g: NavGroup) => openGroups[g.label] ?? groupHasActive(g);

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

          <GlobalSearch />

          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
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

      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </div>
  );
}

/**
 * The topbar "bell": owner/staff in-app notification center. Fetches the feed on
 * mount and again each time the panel opens, shows an unread-count badge, and
 * lets the user mark items read individually or all at once. Clicking an item
 * marks it read and follows its link when present.
 */
function NotificationBell() {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const feed = await api.listNotifications();
      setItems(feed.items);
      setUnread(feed.unread);
    } catch {
      // Leave the last-known feed in place on a transient failure.
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial unread badge on mount, then refresh whenever the panel opens.
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Dismiss the panel on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markAll = async () => {
    try {
      await api.markAllNotificationsRead();
    } catch {
      /* ignore — refetch reflects the real state */
    }
    await load();
  };

  const openItem = async (n: NotificationItem) => {
    if (!n.readAt) {
      // Optimistically clear the unread treatment, then persist.
      setItems((prev) =>
        prev.map((it) => (it.id === n.id ? { ...it, readAt: new Date().toISOString() } : it)),
      );
      setUnread((u) => Math.max(0, u - 1));
      try {
        await api.markNotificationRead(n.id);
      } catch {
        /* ignore — the next open refetches the truth */
      }
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground hover:border-primary/40"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground ring-2 ring-background">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[360px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-popover-foreground">Notifications</span>
              {unread > 0 && (
                <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary">
                  {unread} new
                </span>
              )}
            </div>
            <button
              onClick={markAll}
              disabled={unread === 0}
              className="text-xs font-semibold text-primary transition-colors hover:text-primary/80 disabled:cursor-not-allowed disabled:text-muted-foreground/60"
            >
              Mark all read
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto hide-scrollbar">
            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
                  <BellOff className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">You&apos;re all caught up</p>
                <p className="text-xs text-muted-foreground">
                  New bookings and activity will show up here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((n) => {
                  const isUnread = !n.readAt;
                  return (
                    <li key={n.id}>
                      <button
                        onClick={() => openItem(n)}
                        className={cn(
                          'relative flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors hover:bg-muted',
                          isUnread && 'bg-primary/[0.06]',
                        )}
                      >
                        {isUnread && (
                          <span className="absolute left-1.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary" />
                        )}
                        <div className="flex items-baseline justify-between gap-2 pl-2">
                          <span
                            className={cn(
                              'truncate text-sm',
                              isUnread
                                ? 'font-semibold text-foreground'
                                : 'font-medium text-muted-foreground',
                            )}
                          >
                            {n.title}
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                            {relativeTime(n.createdAt)}
                          </span>
                        </div>
                        {n.body && (
                          <p className="line-clamp-2 pl-2 text-xs text-muted-foreground">{n.body}</p>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** One clickable group in the search dropdown, keyed by category. */
interface SearchGroupSpec {
  key: keyof SearchResults;
  label: string;
  icon: LucideIcon;
}
const SEARCH_GROUPS: SearchGroupSpec[] = [
  { key: 'venues', label: 'Grounds', icon: Building2 },
  { key: 'players', label: 'Players', icon: Users },
  { key: 'tournaments', label: 'Tournaments', icon: Trophy },
  { key: 'bookings', label: 'Bookings', icon: ClipboardList },
];

const totalHits = (r: SearchResults) =>
  r.venues.length + r.players.length + r.tournaments.length + r.bookings.length;

/**
 * Owner/staff global quick-search in the topbar. Debounces input (~300ms), only
 * queries at two or more characters, and renders grouped, clickable results that
 * navigate into the relevant console section and close the dropdown.
 */
function GlobalSearch() {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);

  const term = q.trim();
  const active = term.length >= 2;

  // Debounced search: a fresh keystroke resets the timer; stale responses are
  // discarded via the `cancelled` latch so out-of-order replies can't flicker.
  useEffect(() => {
    if (!active) {
      setResults(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await api.search(term);
        if (!cancelled) setResults(res);
      } catch {
        if (!cancelled) setResults({ venues: [], players: [], tournaments: [], bookings: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [term, active]);

  // Dismiss the dropdown on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const rows = (key: keyof SearchResults) => {
    if (!results) return null;
    switch (key) {
      case 'venues':
        return results.venues.map((v) => (
          <SearchRow
            key={v.id}
            icon={Building2}
            title={v.name}
            sub={v.city ?? undefined}
            onClick={() => go('/owner/venues')}
          />
        ));
      case 'players':
        return results.players.map((p) => (
          <SearchRow
            key={p.customerId}
            icon={Users}
            title={p.name ?? 'Unnamed player'}
            sub={p.mobile ?? undefined}
            onClick={() => go('/owner/players')}
          />
        ));
      case 'tournaments':
        return results.tournaments.map((t) => (
          <SearchRow
            key={t.id}
            icon={Trophy}
            title={t.name}
            onClick={() => go('/owner/tournaments')}
          />
        ));
      case 'bookings':
        return results.bookings.map((b) => (
          <SearchRow
            key={b.id}
            icon={ClipboardList}
            title={b.customerName ?? 'Booking'}
            sub={
              [b.venueName, b.startsAt ? relativeTime(b.startsAt) : null]
                .filter(Boolean)
                .join(' · ') || undefined
            }
            onClick={() => go('/owner/bookings')}
          />
        ));
      default:
        return null;
    }
  };

  const hasResults = results !== null && totalHits(results) > 0;

  return (
    <div className="relative hidden sm:block flex-1 max-w-2xl" ref={ref}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search venues, bookings, players…"
        aria-label="Search the console"
        className="h-10 w-full rounded-xl border border-border bg-input-background pl-10 pr-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
      />

      {open && active && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
          {loading && !results ? (
            <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </div>
          ) : !hasResults ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-medium text-foreground">No results for &ldquo;{term}&rdquo;</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Try a venue, player name, or mobile number.
              </p>
            </div>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto hide-scrollbar py-1">
              {SEARCH_GROUPS.map((g) => {
                const groupRows = rows(g.key);
                if (!results || results[g.key].length === 0) return null;
                const GroupIcon = g.icon;
                return (
                  <div key={g.key} className="py-1">
                    <div className="flex items-center gap-2 px-4 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                      <GroupIcon className="h-3 w-3" />
                      {g.label}
                    </div>
                    {groupRows}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A single clickable result row inside the search dropdown. */
function SearchRow({
  icon: Icon,
  title,
  sub,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  sub?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-sm font-medium text-foreground">{title}</span>
        {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
    </button>
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
