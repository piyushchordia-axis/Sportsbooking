import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type NotificationItem } from '../api/client';

/** Compact "time ago" (mirrors the owner bell's relativeTime). */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const sec = Math.round((Date.now() - then) / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Player in-app notification bell for the consumer storefront. Fetches the
 * signed-in customer's feed (GET /me/notifications), shows an unread badge, and
 * on open marks everything read and lists recent items. Best-effort: any fetch
 * error just leaves the bell empty (notifications are non-critical).
 */
export function PlayerBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = () =>
    api
      .listMyNotifications()
      .then((f) => {
        setItems(f.items);
        setUnread(f.unread);
      })
      .catch(() => undefined);

  useEffect(() => {
    void load();
  }, []);

  // Close on outside click / Escape.
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

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0);
      api.markAllMyNotificationsRead().catch(() => undefined);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        aria-label="Notifications"
        className="relative grid h-9 w-9 place-items-center rounded-[10px]"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--chalk)' }}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span
            className="absolute -right-1 -top-1 grid min-w-[16px] place-items-center rounded-full px-1 text-[10px] font-bold leading-4"
            style={{ background: 'var(--brand)', color: '#fff' }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl shadow-xl"
          style={{ background: 'var(--surface)', border: '1px solid var(--line-strong)' }}
        >
          <div
            className="px-3 py-2 text-xs font-semibold uppercase tracking-wide"
            style={{ color: 'var(--muted)', borderBottom: '1px solid var(--line)' }}
          >
            Notifications
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm" style={{ color: 'var(--muted)' }}>
                You&apos;re all caught up.
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    setOpen(false);
                    if (n.link) navigate(n.link);
                  }}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-2)]"
                  style={{ borderBottom: '1px solid var(--line)' }}
                >
                  <span className="text-sm font-semibold" style={{ color: 'var(--chalk)' }}>
                    {n.title}
                  </span>
                  {n.body && (
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>
                      {n.body}
                    </span>
                  )}
                  <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
                    {timeAgo(n.createdAt)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
