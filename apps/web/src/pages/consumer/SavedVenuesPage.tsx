/** Player storefront: the signed-in customer's saved/bookmarked venues. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, MapPin, Search, Trash2 } from 'lucide-react';
import { api, SavedVenue } from '../../api/client';
import {
  Card,
  EmptyState,
  Msg,
  PageHeader,
  StatusPill,
  useLoad,
} from '../../components/common';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';

export function SavedVenuesPage() {
  const { data, error, loading, reload } = useLoad<SavedVenue[]>(
    () => api.listSavedVenues(),
    [],
  );

  // Venues removed during this session — hidden optimistically while the
  // unsave request lands, then confirmed by the reload.
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const remove = async (venueId: string) => {
    setActionError(null);
    setRemoving((prev) => new Set(prev).add(venueId));
    try {
      await api.unsaveVenue(venueId);
      reload();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(venueId);
        return next;
      });
    }
  };

  const saved = data ?? [];

  return (
    <div className="container">
      <PageHeader
        title="Saved grounds"
        subtitle="Your bookmarked venues — jump back in and book a slot"
        badge={
          !loading && saved.length > 0 ? (
            <StatusPill status="active">{saved.length} saved</StatusPill>
          ) : undefined
        }
      />

      <Card title="Saved grounds" topAccent="primary">
        <Msg text={error ?? actionError} />

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : saved.length === 0 ? (
          <div>
            <EmptyState
              title="No saved grounds yet"
              hint="Tap the heart on any ground to save it here for quick access."
            />
            <div className="flex justify-center">
              <Button asChild variant="outline">
                <Link to="/browse">
                  <Search className="h-4 w-4" /> Browse grounds
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {saved.map((v) => (
              <div
                key={v.venueId}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-primary/40"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Heart className="h-5 w-5 fill-current" />
                </span>
                <Link
                  to={`/venue/${v.venueId}`}
                  className="min-w-0 flex-1"
                >
                  <span className="block truncate font-display text-base font-semibold text-foreground">
                    {v.name}
                  </span>
                  {v.city && (
                    <span className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{v.city}</span>
                    </span>
                  )}
                </Link>
                <Button asChild size="sm">
                  <Link to={`/venue/${v.venueId}`}>View &amp; book</Link>
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={`Remove ${v.name} from saved`}
                  disabled={removing.has(v.venueId)}
                  onClick={() => remove(v.venueId)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
