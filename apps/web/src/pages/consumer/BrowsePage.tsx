/** Public ground browse/search (player storefront). */
import { UserRole } from '@sportsbooking/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Search, Store } from 'lucide-react';
import { api, DiscoverVenue } from '../../api/client';
import { EmptyState, Select, useLoad } from '../../components/common';
import { Skeleton } from '../../components/ui/skeleton';
import { venuePhoto } from '../../lib/imagery';
import { useStorefront } from '../../storefront/StorefrontProvider';
import { useAuth } from '../../auth/AuthContext';
import { flMoney } from '../../floodlit/toast';

/**
 * Saved-venue state shared by the browse cards. For a signed-in customer we
 * fetch the saved set once and expose an optimistic toggle; for guests /
 * non-customers `canSave` is false and the heart is hidden.
 */
function useSavedVenues() {
  const { user } = useAuth();
  const canSave = user?.role === UserRole.CUSTOMER;
  const [saved, setSaved] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!canSave) {
      setSaved(new Set());
      return;
    }
    let alive = true;
    api
      .listSavedVenues()
      .then((rows) => alive && setSaved(new Set(rows.map((r) => r.venueId))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [canSave]);

  const toggle = (venueId: string) => {
    const wasSaved = saved.has(venueId);
    // Optimistic: flip immediately, revert on failure.
    setSaved((prev) => {
      const next = new Set(prev);
      wasSaved ? next.delete(venueId) : next.add(venueId);
      return next;
    });
    const req = wasSaved ? api.unsaveVenue(venueId) : api.saveVenue(venueId);
    req.catch(() =>
      setSaved((prev) => {
        const next = new Set(prev);
        wasSaved ? next.add(venueId) : next.delete(venueId);
        return next;
      }),
    );
  };

  return { canSave, saved, toggle };
}

const PRICE_TIERS = [
  { value: '', label: 'Any price' },
  { value: '500', label: 'Up to ₹500/hr' },
  { value: '1000', label: 'Up to ₹1,000/hr' },
  { value: '1500', label: 'Up to ₹1,500/hr' },
  { value: '2500', label: 'Up to ₹2,500/hr' },
];

/** Page size for "Load more" pagination. */
const PAGE_SIZE = 9;

export function BrowsePage() {
  // Venues come from the storefront context: owner-scoped when on a white-label
  // site, all grounds in the marketplace. The sport list stays canonical.
  const { scoped, ownerName, venues, loading, error } = useStorefront();
  const { data: games } = useLoad(() => api.discoverGames(), []);
  const { canSave, saved, toggle: toggleSaved } = useSavedVenues();

  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [sport, setSport] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

  // Client-side "Load more" cursor.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const list = venues ?? [];

  const cityOptions = useMemo(() => {
    const set = new Set<string>();
    for (const v of list) if (v.city) set.add(v.city);
    return [
      { value: '', label: 'All cities' },
      ...[...set].sort().map((c) => ({ value: c, label: c })),
    ];
  }, [list]);

  const sportOptions = useMemo(() => {
    // Prefer the canonical game list; fall back to sports present in results.
    const names = new Set<string>();
    for (const g of games ?? []) if (g?.name) names.add(g.name);
    if (names.size === 0) for (const v of list) for (const g of v.games) names.add(g.name);
    return [
      { value: '', label: 'All sports' },
      ...[...names].sort().map((n) => ({ value: n, label: n })),
    ];
  }, [games, list]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const cap = maxPrice ? Number(maxPrice) : null;
    return list.filter((v) => {
      if (city && v.city !== city) return false;
      if (sport && !v.games.some((g) => g.name === sport)) return false;
      // Price filter: venues with no configured price always pass.
      if (cap != null && v.minPrice != null && v.minPrice > cap) return false;
      if (term) {
        const hay = `${v.name} ${v.city ?? ''} ${v.address ?? ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [list, q, city, sport, maxPrice]);

  // Reset the pagination cursor when the filtered set changes.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [q, city, sport, maxPrice]);

  const visible = filtered.slice(0, visibleCount);
  const showLoadMore = filtered.length > visibleCount;

  const venueCountLabel =
    filtered.length === 0
      ? ''
      : `${filtered.length} ${filtered.length === 1 ? 'ground' : 'grounds'} ${
          showLoadMore ? 'matched' : 'found'
        }`;

  return (
    <div className="py-6 sm:py-8">
      {/* Heading */}
      <h1
        className="fl-display"
        style={{ fontSize: 'clamp(28px,5vw,40px)', lineHeight: 1, color: 'var(--chalk)' }}
      >
        {scoped && ownerName ? `Grounds by ${ownerName}` : 'Find a ground'}
      </h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
        {scoped
          ? 'Pick a ground, choose your slot and book in seconds.'
          : 'Find turf, courts and arenas near you — book a slot in seconds.'}
      </p>

      {scoped && (
        <div
          className="mt-4 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm"
          style={{
            background: 'var(--surface)',
            border: '1px dashed var(--line-strong)',
            color: 'var(--muted)',
          }}
        >
          <Store className="h-4 w-4 shrink-0" style={{ color: 'var(--brand)' }} />
          <span>
            You're viewing a single operator. Use{' '}
            <span style={{ color: 'var(--chalk)', fontWeight: 600 }}>All grounds</span> in the
            menu to explore the full marketplace.
          </span>
        </div>
      )}

      {/* Search + filters — one compact, low-key row (search no longer dominates;
          it sits inline with the filter chips and wraps on small screens). */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <label
          className="flex h-9 min-w-0 flex-1 basis-full items-center gap-2 rounded-lg px-3 sm:basis-60"
          style={{ background: 'var(--bg-2)', border: '1px solid var(--line)' }}
        >
          <Search className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--faint)' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search grounds…"
            className="w-full min-w-0 bg-transparent text-[13px] outline-none"
            style={{ color: 'var(--chalk)' }}
          />
        </label>
        <div className="fl-chip-select w-32 shrink-0 [&_label]:mb-0">
          <Select label="" value={sport} onChange={setSport} options={sportOptions} />
        </div>
        <div className="fl-chip-select w-32 shrink-0 [&_label]:mb-0">
          <Select label="" value={city} onChange={setCity} options={cityOptions} />
        </div>
        <div className="fl-chip-select w-28 shrink-0 [&_label]:mb-0">
          <Select label="" value={maxPrice} onChange={setMaxPrice} options={PRICE_TIERS} />
        </div>
      </div>

      {error && (
        <p className="mt-4 text-sm font-medium" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      {loading && list.length === 0 ? (
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No grounds match your filters"
            hint="Try clearing the search or picking a different city, sport or price."
          />
        </div>
      ) : (
        <>
          <div
            className="fl-mono mt-5 mb-3"
            style={{ fontSize: 11, letterSpacing: '.06em', color: 'var(--faint)' }}
          >
            {venueCountLabel}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {visible.map((v) => (
              <VenueCard
                key={v.id}
                venue={v}
                canSave={canSave}
                isSaved={saved.has(v.id)}
                onToggleSave={toggleSaved}
              />
            ))}
          </div>

          {showLoadMore && (
            <button
              type="button"
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold md:mx-auto md:max-w-xs"
              style={{
                background: 'transparent',
                border: '1px solid var(--line-strong)',
                color: 'var(--muted)',
              }}
            >
              Load more grounds
            </button>
          )}
        </>
      )}
    </div>
  );
}

function VenueCard({
  venue,
  canSave,
  isSaved,
  onToggleSave,
}: {
  venue: DiscoverVenue;
  canSave?: boolean;
  isSaved?: boolean;
  onToggleSave?: (venueId: string) => void;
}) {
  const gamesLabel = venue.games.map((g) => g.name).join(' · ');
  const cityLine = [gamesLabel, venue.city].filter(Boolean).join(' · ');
  const photo = venuePhoto({ photos: venue.photos, games: venue.games });

  return (
    <Link
      to={`/venue/${venue.id}`}
      className="group relative flex h-48 flex-col justify-end overflow-hidden rounded-2xl"
      style={{ border: '1px solid var(--line)' }}
    >
      {/* Ground photo as the card background */}
      <img
        src={photo}
        alt=""
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
      />
      {/* Brand-tinted bottom scrim — NOT a full-image wash. The photo stays
          vivid up top; a single dark, brand-cast teal fades in only over the
          lower third so the name + price stay legible without dulling the
          picture. Theme-aware via --bg/--brand (darkens at night, lightens by
          day). */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to top, ' +
            'color-mix(in oklab, var(--bg) 78%, var(--brand)) 0%, ' +
            'color-mix(in oklab, color-mix(in oklab, var(--bg) 78%, var(--brand)) 52%, transparent) 46%, ' +
            'transparent 80%)',
        }}
      />

      {canSave && (
        <button
          type="button"
          aria-label={isSaved ? 'Remove from saved' : 'Save ground'}
          aria-pressed={isSaved}
          onClick={(e) => {
            // The card is a Link — don't navigate when toggling the heart.
            e.preventDefault();
            e.stopPropagation();
            onToggleSave?.(venue.id);
          }}
          className="absolute right-2.5 top-2.5 grid h-8 w-8 place-items-center rounded-full"
          style={{
            background: 'color-mix(in oklab, var(--bg) 50%, transparent)',
            backdropFilter: 'blur(4px)',
          }}
        >
          <Heart
            className="h-4 w-4 transition-colors"
            style={
              isSaved
                ? { fill: 'var(--brand)', color: 'var(--brand)' }
                : { color: 'var(--chalk)' }
            }
          />
        </button>
      )}

      {/* Text sits over the dark base of the overlay */}
      <div className="relative p-4">
        <h3
          className="fl-display"
          style={{
            fontSize: 19,
            fontWeight: 700,
            color: 'var(--chalk)',
            // Scrim-matched halo: reinforces contrast over bright photo areas
            // (e.g. white turf lines) in both light and dark mode.
            textShadow: '0 1px 14px color-mix(in oklab, var(--bg) 78%, var(--brand))',
          }}
        >
          {venue.name}
        </h3>
        {cityLine && (
          <p
            className="mt-1 truncate text-[12.5px]"
            style={{ color: 'color-mix(in oklab, var(--chalk) 80%, transparent)' }}
          >
            {cityLine}
          </p>
        )}
        <div className="mt-3 flex items-center justify-between">
          {venue.minPrice != null ? (
            <span
              className="fl-mono inline-flex items-baseline gap-1 rounded-lg px-2.5 py-1 text-[12px] font-semibold"
              style={{ background: 'var(--brand)', color: 'var(--on-brand)' }}
            >
              from
              <span className="text-[14px] font-bold">{flMoney(venue.minPrice)}</span>
            </span>
          ) : (
            <span />
          )}
          <span className="text-xs font-semibold" style={{ color: 'var(--brand)' }}>
            View slots →
          </span>
        </div>
      </div>
    </Link>
  );
}
