/** Public ground browse/search (player storefront). */
import { UserRole } from '@sportsbooking/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  Heart,
  Loader2,
  MapPin,
  Navigation,
  Search,
  Store,
} from 'lucide-react';
import { api, DiscoverVenue } from '../../api/client';
import { EmptyState, Select, useLoad } from '../../components/common';
import { DatePicker } from '../../components/ui/date-picker';
import { fromISODate, toISODate } from '../../lib/date';
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

const RADIUS_OPTIONS = [
  { value: '', label: 'Any distance' },
  { value: '5', label: 'Within 5 km' },
  { value: '10', label: 'Within 10 km' },
  { value: '25', label: 'Within 25 km' },
];

/** Page size for "Load more" pagination (both geo + default browse). */
const PAGE_SIZE = 9;

/** Geolocation flow state. */
type GeoState = 'idle' | 'locating' | 'on' | 'denied' | 'unsupported' | 'error';

/** Format a distance for the card badge ("2.4 km" / "850 m"). */
function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

/** Pick a sport emoji for the card's image-strip tag (Floodlit design). */
function sportEmoji(games: { name: string }[]): string {
  const names = games.map((g) => g.name.toLowerCase());
  const has = (...keys: string[]) => names.some((n) => keys.some((k) => n.includes(k)));
  if (has('cricket')) return '🏏';
  if (has('football', 'soccer', 'futsal')) return '⚽';
  if (has('badminton')) return '🏸';
  if (has('tennis', 'pickle')) return '🎾';
  if (has('basket')) return '🏀';
  if (has('volley')) return '🏐';
  if (has('hockey')) return '🏑';
  if (has('table tennis', 'ping')) return '🏓';
  if (has('swim')) return '🏊';
  if (has('squash')) return '🎯';
  return '🏟️';
}

export function BrowsePage() {
  // Venues come from the storefront context: owner-scoped when on a white-label
  // site, all grounds in the marketplace. The sport list stays canonical.
  const { scoped, ownerName, venues, loading, error } = useStorefront();
  const { data: games } = useLoad(() => api.discoverGames(), []);
  const { canSave, saved, toggle: toggleSaved } = useSavedVenues();

  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [sport, setSport] = useState('');
  const [date, setDate] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

  // --- Geolocation / "Near me" state ---
  const [geo, setGeo] = useState<GeoState>('idle');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusKm, setRadiusKm] = useState('');
  // Distance-sorted venues fetched from the server when geo is active.
  const [geoVenues, setGeoVenues] = useState<DiscoverVenue[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoMoreLoading, setGeoMoreLoading] = useState(false);
  // Server may have more pages while the last page is a full PAGE_SIZE.
  const [geoHasMore, setGeoHasMore] = useState(false);

  // Client-side "Load more" cursor for the default (non-geo) browse list.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const geoActive = geo === 'on' && !!coords;

  function requestLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeo('unsupported');
      return;
    }
    setGeo('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeo('on');
      },
      (err) => {
        setCoords(null);
        setGeo(err.code === err.PERMISSION_DENIED ? 'denied' : 'error');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  function clearLocation() {
    setGeo('idle');
    setCoords(null);
    setGeoVenues([]);
    setGeoHasMore(false);
  }

  // Fetch the first distance-sorted page whenever location / radius changes.
  useEffect(() => {
    if (!geoActive || !coords) return;
    let alive = true;
    setGeoLoading(true);
    api
      .discoverVenues({
        lat: coords.lat,
        lng: coords.lng,
        radiusKm: radiusKm ? Number(radiusKm) : undefined,
        limit: PAGE_SIZE,
        offset: 0,
      })
      .then((rows) => {
        if (!alive) return;
        setGeoVenues(rows);
        setGeoHasMore(rows.length === PAGE_SIZE);
      })
      .catch(() => {
        if (alive) setGeo('error');
      })
      .finally(() => {
        if (alive) setGeoLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [geoActive, coords, radiusKm]);

  function loadMoreGeo() {
    if (!coords || geoMoreLoading) return;
    setGeoMoreLoading(true);
    api
      .discoverVenues({
        lat: coords.lat,
        lng: coords.lng,
        radiusKm: radiusKm ? Number(radiusKm) : undefined,
        limit: PAGE_SIZE,
        offset: geoVenues.length,
      })
      .then((rows) => {
        // De-dupe defensively in case the server window shifts between calls.
        setGeoVenues((prev) => {
          const seen = new Set(prev.map((v) => v.id));
          return [...prev, ...rows.filter((v) => !seen.has(v.id))];
        });
        setGeoHasMore(rows.length === PAGE_SIZE);
      })
      .catch(() => setGeo('error'))
      .finally(() => setGeoMoreLoading(false));
  }

  // The base list the filters run against: server geo results, else storefront.
  const list = geoActive ? geoVenues : venues ?? [];

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
    const rows = list.filter((v) => {
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
    // When locating, keep nearest-first even after client filtering.
    if (geoActive) {
      rows.sort((a, b) => {
        const da = a.distanceKm ?? Infinity;
        const db = b.distanceKm ?? Infinity;
        return da - db;
      });
    }
    return rows;
  }, [list, q, city, sport, maxPrice, geoActive]);

  // Reset the client-side pagination cursor when the filtered set changes.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [q, city, sport, maxPrice, geoActive]);

  // In geo mode the server paginates; otherwise slice the filtered list locally.
  const visible = geoActive ? filtered : filtered.slice(0, visibleCount);
  const showLoadMore = geoActive
    ? geoHasMore && filtered.length > 0
    : filtered.length > visibleCount;

  function loadMore() {
    if (geoActive) loadMoreGeo();
    else setVisibleCount((c) => c + PAGE_SIZE);
  }

  // Carry the chosen date into the venue page as a preselected slot date.
  const dateQuery = date ? `?date=${date}` : '';

  const geoMessage =
    geo === 'denied'
      ? 'Location access was denied — showing all grounds. Enable location in your browser to sort by distance.'
      : geo === 'unsupported'
        ? "Your browser doesn't support location — showing all grounds."
        : geo === 'error'
          ? "Couldn't get your location — showing all grounds. Try again in a moment."
          : null;

  const venueCountLabel =
    filtered.length === 0
      ? ''
      : `${filtered.length} ${filtered.length === 1 ? 'ground' : 'grounds'} ${
          geoActive ? 'near you' : showLoadMore ? 'matched' : 'found'
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

      {/* Search field */}
      <label
        className="mt-5 flex items-center gap-2.5 rounded-xl px-3.5 py-3"
        style={{ background: 'var(--surface)', border: '1px solid var(--line-strong)' }}
      >
        <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--faint)' }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search grounds, areas, games…"
          className="w-full min-w-0 bg-transparent text-sm outline-none"
          style={{ color: 'var(--chalk)' }}
        />
      </label>

      {/* Filter chips: city / sport / price / date / near-me */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="fl-chip-select [&_label]:mb-0">
          <Select label="" value={city} onChange={setCity} options={cityOptions} />
        </div>
        <div className="fl-chip-select [&_label]:mb-0">
          <Select label="" value={sport} onChange={setSport} options={sportOptions} />
        </div>
        <div className="fl-chip-select [&_label]:mb-0">
          <Select label="" value={maxPrice} onChange={setMaxPrice} options={PRICE_TIERS} />
        </div>
        <DatePicker
          value={fromISODate(date)}
          onChange={(d) => setDate(toISODate(d))}
          placeholder="Any date"
        />
      </div>

      {/* Location row: "Near me" chip + optional radius selector */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {geoActive ? (
          <>
            <button
              type="button"
              onClick={clearLocation}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold"
              style={{ background: 'var(--brand)', color: 'var(--on-brand)' }}
            >
              <Navigation className="h-3.5 w-3.5 fill-current" />
              Near me — on
            </button>
            <div className="fl-chip-select w-44 [&_label]:mb-0">
              <Select
                label=""
                value={radiusKm}
                onChange={setRadiusKm}
                options={RADIUS_OPTIONS}
              />
            </div>
            <span className="text-xs" style={{ color: 'var(--faint)' }}>
              Sorted by distance
            </span>
          </>
        ) : (
          <button
            type="button"
            onClick={requestLocation}
            disabled={geo === 'locating'}
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium disabled:opacity-60"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--line-strong)',
              color: 'var(--chalk)',
            }}
          >
            {geo === 'locating' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Navigation className="h-3.5 w-3.5" />
            )}
            {geo === 'locating' ? 'Locating…' : 'Use my location'}
          </button>
        )}
      </div>

      {geoMessage && (
        <p className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
          <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--brand)' }} />
          {geoMessage}
        </p>
      )}

      {date && (
        <p className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
          <CalendarDays className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--brand)' }} />
          Showing availability for{' '}
          <span style={{ color: 'var(--chalk)', fontWeight: 600 }}>{date}</span> — open a ground
          to pick a slot.
        </p>
      )}

      {error && (
        <p className="mt-4 text-sm font-medium" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      {(loading && list.length === 0) || (geoActive && geoLoading && list.length === 0) ? (
        <p className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>
          Loading grounds…
        </p>
      ) : filtered.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No grounds match your filters"
            hint={
              geoActive
                ? 'Try widening the distance radius, or clear your other filters.'
                : 'Try clearing the search or picking a different city, sport or price.'
            }
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
                dateQuery={dateQuery}
                showDistance={geoActive}
                canSave={canSave}
                isSaved={saved.has(v.id)}
                onToggleSave={toggleSaved}
              />
            ))}
          </div>

          {showLoadMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={geoMoreLoading}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold disabled:opacity-60 md:mx-auto md:max-w-xs"
              style={{
                background: 'transparent',
                border: '1px solid var(--line-strong)',
                color: 'var(--muted)',
              }}
            >
              {geoMoreLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {geoMoreLoading ? 'Loading…' : 'Load more grounds'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function VenueCard({
  venue,
  dateQuery,
  showDistance,
  canSave,
  isSaved,
  onToggleSave,
}: {
  venue: DiscoverVenue;
  dateQuery: string;
  showDistance?: boolean;
  canSave?: boolean;
  isSaved?: boolean;
  onToggleSave?: (venueId: string) => void;
}) {
  const gamesLabel = venue.games.map((g) => g.name).join(' · ');
  const cityLine = [gamesLabel, venue.city].filter(Boolean).join(' · ');

  return (
    <Link
      to={`/venue/${venue.id}${dateQuery}`}
      className="group flex flex-col overflow-hidden rounded-2xl transition-colors"
      style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
    >
      {/* Gradient image strip with sport emoji + heart */}
      <div
        className="flex h-24 items-end justify-between p-3"
        style={{
          background:
            'linear-gradient(135deg, color-mix(in oklab, var(--brand) 40%, var(--surface-2)), var(--surface-2))',
        }}
      >
        <span style={{ fontSize: 30, lineHeight: 1 }}>{sportEmoji(venue.games)}</span>
        <div className="flex items-center gap-2">
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
              className="grid h-8 w-8 place-items-center rounded-full"
              style={{ background: 'color-mix(in oklab, var(--bg) 55%, transparent)' }}
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
        </div>
      </div>

      <div className="flex flex-1 flex-col px-3.5 pb-4 pt-3">
        <div className="flex items-baseline justify-between gap-2.5">
          <h3
            className="fl-display"
            style={{ fontSize: 18, fontWeight: 700, color: 'var(--chalk)' }}
          >
            {venue.name}
          </h3>
          {showDistance && venue.distanceKm != null && (
            <span
              className="fl-mono whitespace-nowrap text-xs"
              style={{ color: 'var(--faint)' }}
            >
              {formatDistance(venue.distanceKm)}
            </span>
          )}
        </div>

        {cityLine && (
          <p className="mt-1 text-[12.5px]" style={{ color: 'var(--muted)' }}>
            {cityLine}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between pt-3">
          {venue.minPrice != null ? (
            <div className="fl-mono text-[13px]" style={{ color: 'var(--faint)' }}>
              from{' '}
              <span style={{ color: 'var(--brand)', fontWeight: 600, fontSize: 16 }}>
                {flMoney(venue.minPrice)}
              </span>
            </div>
          ) : (
            <span />
          )}
          <span
            className="text-xs font-semibold"
            style={{ color: 'var(--brand)' }}
          >
            View slots →
          </span>
        </div>
      </div>
    </Link>
  );
}
