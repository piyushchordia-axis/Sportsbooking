/** Player storefront: offers currently available to the customer in the
 * active (scoped) operator's store. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgePercent, Search, Sparkles, Store, Tag } from 'lucide-react';
import { api, OfferInboxItem } from '../../api/client';
import {
  Card,
  EmptyState,
  Msg,
  PageHeader,
  StatusPill,
} from '../../components/common';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { useStorefront } from '../../storefront/StorefrontProvider';

/** "12 Jun 2026" from an ISO date/timestamp; null-safe. */
function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Human validity window line from an offer's validFrom/validTo. */
function validityLabel(o: OfferInboxItem): string | null {
  const from = fmtDate(o.validFrom);
  const to = fmtDate(o.validTo);
  if (from && to) return `Valid ${from} – ${to}`;
  if (to) return `Valid until ${to}`;
  if (from) return `Valid from ${from}`;
  return null;
}

export function OffersInboxPage() {
  const { ownerId, ownerName } = useStorefront();

  const [offers, setOffers] = useState<OfferInboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ownerId) {
      setOffers([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .offersInbox(ownerId)
      .then((rows) => alive && setOffers(rows))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [ownerId]);

  return (
    <div className="container">
      <PageHeader
        title="Offers"
        subtitle={
          ownerName
            ? `Deals available at ${ownerName}`
            : 'Discounts and promo codes available in this store'
        }
        badge={
          ownerId && !loading && offers.length > 0 ? (
            <StatusPill status="active">{offers.length} live</StatusPill>
          ) : undefined
        }
      />

      {!ownerId ? (
        // No operator scoped — offers are per-store, so prompt the player to
        // enter one (the marketplace root has no single offers list).
        <Card title="Pick a store" topAccent="primary">
          <EmptyState
            title="No store selected"
            hint="Offers are specific to each operator. Open a ground to view its store and the deals on offer there."
          />
          <div className="flex justify-center">
            <Button asChild variant="outline">
              <Link to="/browse">
                <Search className="h-4 w-4" /> Browse grounds
              </Link>
            </Button>
          </div>
        </Card>
      ) : (
        <Card
          title={
            <span className="flex items-center gap-2">
              <Store className="h-5 w-5 text-primary" />
              {ownerName ?? 'Store'} offers
            </span>
          }
          topAccent="primary"
        >
          <Msg text={error} />

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-xl" />
              ))}
            </div>
          ) : offers.length === 0 ? (
            <EmptyState
              title="No offers right now"
              hint="There are no active deals at this store at the moment. Check back soon."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {offers.map((o) => {
                const value =
                  o.type === 'percent' ? `${o.value}% off` : `₹${o.value} off`;
                const validity = validityLabel(o);
                return (
                  <div
                    key={o.id}
                    className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-display text-base font-semibold text-foreground">
                          {o.name}
                        </p>
                        <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                          <BadgePercent className="h-4 w-4" />
                          {value}
                        </p>
                      </div>
                      {o.autoApply && (
                        <StatusPill status="active">
                          <Sparkles className="h-3.5 w-3.5" /> Auto-applied
                        </StatusPill>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {o.code ? (
                        <span className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-2.5 py-1 font-mono text-sm font-semibold tracking-wide text-foreground">
                          <Tag className="h-3.5 w-3.5 text-primary" />
                          {o.code}
                        </span>
                      ) : !o.autoApply ? (
                        <span className="text-xs text-muted-foreground">
                          Applies automatically at checkout.
                        </span>
                      ) : null}
                    </div>

                    {validity && (
                      <p className="text-xs text-muted-foreground">{validity}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
