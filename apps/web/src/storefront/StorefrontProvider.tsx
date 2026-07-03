import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, DiscoverVenue } from '../api/client';
import { DEFAULT_BRANDING, useTheme } from '../theme/ThemeProvider';

/**
 * Per-owner white-label storefront context.
 *
 * Resolves the "active owner" for the consumer site from (in priority order):
 *   1. a subdomain   — e.g. smash-arena.sportline.app  (production white-label)
 *   2. a path key     — /s/:key
 *   3. a query param  — ?owner=<id|slug>
 *   4. the session    — remembered once entered, so navigation stays in-store
 * When an owner is resolved the whole consumer site re-themes to that owner's
 * branding and only their grounds are shown; with no owner it's the platform
 * marketplace (all grounds, default theme).
 */
export interface StorefrontValue {
  scoped: boolean;
  ownerId: string | null;
  ownerName: string | null;
  ownerLogo: string | null;
  venues: DiscoverVenue[];
  allVenues: DiscoverVenue[];
  loading: boolean;
  error: string | null;
  exitStorefront: () => void;
}

const StorefrontContext = createContext<StorefrontValue>({
  scoped: false,
  ownerId: null,
  ownerName: null,
  ownerLogo: null,
  venues: [],
  allVenues: [],
  loading: true,
  error: null,
  exitStorefront: () => undefined,
});

const SESSION_KEY = 'storefront-owner-key';
const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'admin', 'api', 'localhost', '127']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Owner display name from a venue ("Smash Arena — Indiranagar" → "Smash Arena"). */
const ownerNameOf = (v: DiscoverVenue) => v.name.split(' — ')[0].trim();
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Parse a white-label subdomain from the host, if any (ignores apex + reserved). */
function subdomainKey(): string | null {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname;
  if (!host || host === 'localhost' || UUID_RE.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host))
    return null;
  const parts = host.split('.');
  // Need at least sub.domain.tld (or sub.localhost) to have a meaningful subdomain.
  if (parts.length < 2) return null;
  const sub = parts[0];
  if (RESERVED_SUBDOMAINS.has(sub)) return null;
  // Treat apex domains (example.com) as non-scoped: 2 parts where the first is the brand.
  if (parts.length === 2 && parts[1] !== 'localhost') return null;
  return sub;
}

export function StorefrontProvider({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const { setBranding } = useTheme();
  const [allVenues, setAllVenues] = useState<DiscoverVenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .discoverVenues()
      .then((v) => alive && setAllVenues(v))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  // Resolve the active owner key from URL/session each navigation.
  const key = useMemo(() => {
    const fromHost = subdomainKey();
    const fromPath = loc.pathname.match(/^\/s\/([^/]+)/)?.[1] ?? null;
    const fromQuery = new URLSearchParams(loc.search).get('owner');
    let resolved = fromHost || fromPath || fromQuery;
    if (resolved) {
      try {
        sessionStorage.setItem(SESSION_KEY, resolved);
      } catch {
        /* ignore */
      }
    } else {
      try {
        resolved = sessionStorage.getItem(SESSION_KEY);
      } catch {
        resolved = null;
      }
    }
    return resolved ? decodeURIComponent(resolved) : null;
  }, [loc.pathname, loc.search]);

  // Match the key to an owner (by id or slugified owner name).
  const resolved = useMemo(() => {
    if (!key || allVenues.length === 0) return null;
    const lower = key.toLowerCase();
    const match = allVenues.find(
      (v) => v.ownerId.toLowerCase() === lower || slugify(ownerNameOf(v)) === lower,
    );
    if (!match) return null;
    const venues = allVenues.filter((v) => v.ownerId === match.ownerId);
    return {
      ownerId: match.ownerId,
      ownerName: ownerNameOf(match),
      ownerLogo: match.branding.logoUrl ?? null,
      branding: match.branding,
      venues,
    };
  }, [key, allVenues]);

  // Single source of white-label theme for the consumer site: the scoped owner,
  // else the owner of the venue being viewed (/venue/:id), else platform default.
  // (Centralised here so pages don't fight over setBranding via effect ordering.)
  const themeBranding = useMemo(() => {
    if (resolved) return resolved.branding;
    const venueId = loc.pathname.match(/^\/venue\/([^/]+)/)?.[1];
    if (venueId) {
      const v = allVenues.find((x) => x.id === venueId);
      if (v) return v.branding;
    }
    return DEFAULT_BRANDING;
  }, [resolved, loc.pathname, allVenues]);

  useEffect(() => {
    setBranding(themeBranding);
  }, [themeBranding, setBranding]);

  const exitStorefront = () => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    setBranding(DEFAULT_BRANDING);
    // Drop ?owner= and any /s/:key by sending the player to the marketplace root.
    window.location.assign('/');
  };

  const value: StorefrontValue = {
    scoped: !!resolved,
    ownerId: resolved?.ownerId ?? null,
    ownerName: resolved?.ownerName ?? null,
    ownerLogo: resolved?.ownerLogo ?? null,
    venues: resolved ? resolved.venues : allVenues,
    allVenues,
    loading,
    error,
    exitStorefront,
  };

  return <StorefrontContext.Provider value={value}>{children}</StorefrontContext.Provider>;
}

export const useStorefront = () => useContext(StorefrontContext);
