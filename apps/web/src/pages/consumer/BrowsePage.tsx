/** Public ground browse/search (player storefront). */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Loader2, MapPin, Navigation, Search, Store } from 'lucide-react';
import { api, DiscoverVenue } from '../../api/client';
import {
  EmptyState,
  ImageWithFallback,
  PageHeader,
  Select,
  SportIcon,
  useLoad,
} from '../../components/common';
import { Button } from '../../components/ui/button';
import { DatePicker } from '../../components/ui/date-picker';
import { fromISODate, toISODate } from '../../lib/date';
import { FALLBACK_VENUE_PHOTO, venuePhoto } from '../../lib/imagery';
import { useStorefront } from '../../storefront/StorefrontProvider';

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

/** Format a distance for the card badge ("2.4 km away" / "850 m away"). */
function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  return `${km.toFixed(1)} km away`;
}

export function BrowsePage() {
  // Venues come from the storefront context: owner-scoped when on a white-label
  // site, all grounds in the marketplace. The sport list stays canonical.
  const { scoped, ownerName, venues, loading, error } = useStorefront();
  const { data: games } = useLoad(() => api.discoverGames(), []);

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

  return (
    <div className="container py-8">
      <PageHeader
        title={scoped && ownerName ? `Grounds by ${ownerName}` : 'Browse grounds'}
        subtitle={
          scoped
            ? 'Pick a ground, choose your slot and book in seconds.'
            : 'Find turf, courts and arenas near you — book a slot in seconds.'
        }
      />

      {scoped && (
        <div className="-mt-2 mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Store className="h-4 w-4 shrink-0 text-primary" />
          <span>
            You're viewing a single operator. Use{' '}
            <span className="font-medium text-foreground">All grounds</span> in the menu to
            explore the full marketplace.
          </span>
        </div>
      )}

      {/* Filter bar */}
      <div className="sticky top-[4.5rem] z-10 mb-6 rounded-2xl border border-border bg-card/95 p-4 backdrop-blur-md">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="relative block lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or city…"
              className="flex h-10 w-full min-w-0 rounded-xl border border-border bg-input-background pl-9 pr-3.5 py-1 text-sm text-foreground outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
            />
          </label>
          <div className="[&_label]:mb-0">
            <Select label="" value={city} onChange={setCity} options={cityOptions} />
          </div>
          <div className="[&_label]:mb-0">
            <Select label="" value={sport} onChange={setSport} options={sportOptions} />
          </div>
          <div className="[&_label]:mb-0">
            <Select label="" value={maxPrice} onChange={setMaxPrice} options={PRICE_TIERS} />
          </div>
          <DatePicker
            value={fromISODate(date)}
            onChange={(d) => setDate(toISODate(d))}
            placeholder="Any date"
          />
        </div>

        {/* Location row: "Near me" toggle + optional radius selector */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {geoActive ? (
            <>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={clearLocation}
                className="gap-1.5"
              >
                <Navigation className="h-3.5 w-3.5 fill-current" />
                Near me — on
              </Button>
              <div className="w-44 [&_label]:mb-0">
                <Select
                  label=""
                  value={radiusKm}
                  onChange={setRadiusKm}
                  options={RADIUS_OPTIONS}
                />
              </div>
              <span className="text-xs text-muted-foreground">Sorted by distance</span>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={requestLocation}
              disabled={geo === 'locating'}
              className="gap-1.5"
            >
              {geo === 'locating' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Navigation className="h-3.5 w-3.5" />
              )}
              {geo === 'locating' ? 'Locating…' : 'Use my location'}
            </Button>
          )}
        </div>

        {geoMessage && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
            {geoMessage}
          </p>
        )}

        {date && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-primary" />
            Showing availability for{' '}
            <span className="font-medium text-foreground">{date}</span> — open a ground to pick
            a slot.
          </p>
        )}
      </div>

      {error && <p className="mb-4 text-sm font-medium text-destructive">{error}</p>}

      {(loading && list.length === 0) || (geoActive && geoLoading && list.length === 0) ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading grounds…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No grounds match your filters"
          hint={
            geoActive
              ? 'Try widening the distance radius, or clear your other filters.'
              : 'Try clearing the search or picking a different city, sport or price.'
          }
        />
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? 'ground' : 'grounds'}{' '}
            {showLoadMore && !geoActive ? 'matched' : 'found'}
            {geoActive ? ' near you' : ''}
          </p>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((v) => (
              <VenueCard key={v.id} venue={v} dateQuery={dateQuery} showDistance={geoActive} />
            ))}
          </div>

          {showLoadMore && (
            <div className="mt-8 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={loadMore}
                disabled={geoMoreLoading}
                className="gap-2"
              >
                {geoMoreLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {geoMoreLoading ? 'Loading…' : 'Load more'}
              </Button>
            </div>
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
}: {
  venue: DiscoverVenue;
  dateQuery: string;
  showDistance?: boolean;
}) {
  return (
    <Link
      to={`/venue/${venue.id}${dateQuery}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-muted">
        <ImageWithFallback
          src={venuePhoto({ games: venue.games })}
          fallback={FALLBACK_VENUE_PHOTO}
          alt={venue.name}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
        />
        {showDistance && venue.distanceKm != null && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground shadow-sm">
            <Navigation className="h-3 w-3 fill-current" />
            {formatDistance(venue.distanceKm)}
          </span>
        )}
        {venue.minPrice != null && (
          <span className="absolute right-3 top-3 rounded-full bg-card/90 px-2.5 py-1 text-xs font-semibold text-foreground shadow-sm backdrop-blur-sm">
            from ₹{venue.minPrice}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold leading-tight text-foreground">
            {venue.name}
          </h3>
          {venue.city && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{venue.city}</span>
            </p>
          )}
        </div>

        {venue.games.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {venue.games.map((g) => (
              <span
                key={g.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground"
              >
                <SportIcon name={g.name} className="h-3.5 w-3.5" />
                {g.name}
              </span>
            ))}
          </div>
        )}

        <Button className="mt-auto w-full" tabIndex={-1}>
          View &amp; book
        </Button>
      </div>
    </Link>
  );
}
