import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Coins, CreditCard, Package, RefreshCw, Sparkles, Ticket } from 'lucide-react';
import { api, DiscoverVenue, Pack, WalletSummary } from '../../api/client';
import { openCheckout, razorpayEnabled } from '../../lib/razorpay';
import { Card, EmptyState, Msg, PageHeader, Select, Stat, StatusPill } from '../../components/common';
import { Button } from '../../components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Skeleton } from '../../components/ui/skeleton';
import type { Accent } from '../../components/common';

/**
 * Recoverable load failure: states what went wrong (in the interface's voice)
 * and offers a single retry, so a failed fetch never collapses to a blank page.
 */
function InlineError({
  message,
  detail,
  onRetry,
  retrying,
}: {
  message: string;
  detail?: string | null;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="flex flex-col items-center text-center py-10 px-4">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-destructive/12 text-destructive mb-4">
        <AlertCircle className="h-6 w-6" />
      </span>
      <p className="font-display font-semibold text-base text-foreground">{message}</p>
      {detail && <p className="text-sm text-muted-foreground mt-1 max-w-sm">{detail}</p>}
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry} disabled={retrying}>
        <RefreshCw className={`h-4 w-4${retrying ? ' animate-spin' : ''}`} />
        {retrying ? 'Retrying…' : 'Try again'}
      </Button>
    </div>
  );
}

/** Customer wallet: pack balances, points, credit + buy packs (PRD §5.1). */
export function WalletPage() {
  const [owners, setOwners] = useState<{ id: string; name: string }[]>([]);
  const [ownerId, setOwnerId] = useState('');
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  // Owner-list load (drives the whole page) — tracked so a failed discover call
  // shows a visible error + retry instead of a blank page.
  const [ownersLoading, setOwnersLoading] = useState(true);
  const [ownersError, setOwnersError] = useState<string | null>(null);

  // Per-owner wallet load — tracked separately so a wallet fetch failure shows an
  // inline error + retry rather than leaving the skeleton spinning forever.
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  const loadOwners = useCallback(() => {
    setOwnersLoading(true);
    setOwnersError(null);
    api
      .discoverVenues()
      .then((vs: DiscoverVenue[]) => {
        const uniq = Array.from(new Map(vs.map((v) => [v.ownerId, v.name.split(' — ')[0]])));
        setOwners(uniq.map(([id, name]) => ({ id, name })));
        if (uniq[0]) setOwnerId(uniq[0][0]);
      })
      .catch((e: Error) => setOwnersError(e.message))
      .finally(() => setOwnersLoading(false));
  }, []);

  useEffect(() => loadOwners(), [loadOwners]);

  const load = useCallback((oid: string) => {
    if (!oid) return;
    setWalletLoading(true);
    setWalletError(null);
    setWallet(null);
    api
      .wallet(oid)
      .then(setWallet)
      .catch((e: Error) => setWalletError(e.message))
      .finally(() => setWalletLoading(false));
    api.listOwnerPacks(oid).then(setPacks).catch(() => setPacks([]));
  }, []);

  useEffect(() => load(ownerId), [ownerId, load]);

  const buy = async (packId: string) => {
    setMsg(null);
    try {
      const res = await api.purchasePack(ownerId, packId);

      // The purchase response may carry a Razorpay order (orderId/amount/currency)
      // for the live checkout flow. In dev the order self-verifies server-side, so
      // `razorpayEnabled` is false and we keep the existing behavior exactly.
      const order = res as typeof res & {
        orderId?: string;
        amount?: number;
        currency?: string;
      };
      if (razorpayEnabled && order.orderId && order.amount) {
        await openCheckout({
          orderId: order.orderId,
          amount: order.amount,
          name: 'Pack purchase',
          onSuccess: async (sig) => {
            try {
              // Confirm the purchase with the verified Razorpay signature.
              const confirmed = await (
                api.purchasePack as unknown as (
                  ownerId: string,
                  packId: string,
                  payment: {
                    razorpayOrderId: string;
                    razorpayPaymentId: string;
                    razorpaySignature: string;
                  },
                ) => Promise<typeof res>
              )(ownerId, packId, {
                razorpayOrderId: sig.razorpay_order_id,
                razorpayPaymentId: sig.razorpay_payment_id,
                razorpaySignature: sig.razorpay_signature,
              });
              setMsg(
                `Purchased — ${confirmed.sessionsAdded} sessions added (balance ${confirmed.balance}).`,
              );
              load(ownerId);
            } catch (e) {
              setMsg((e as Error).message);
            }
          },
        });
        return;
      }

      setMsg(`Purchased — ${res.sessionsAdded} sessions added (balance ${res.balance}).`);
      load(ownerId);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  // Map a wallet "lane" to a friendly label + icon + accent for the Stat row.
  const laneMeta = (lane: string): { label: string; icon: typeof Ticket; accent: Accent } => {
    if (lane.startsWith('pack:')) return { label: 'Pack sessions', icon: Ticket, accent: 'primary' };
    const l = lane.toLowerCase();
    if (l.includes('point') || l.includes('loyalty'))
      return { label: 'Loyalty points', icon: Sparkles, accent: 'purple' };
    if (l.includes('credit')) return { label: 'Credit', icon: CreditCard, accent: 'blue' };
    return { label: lane, icon: Coins, accent: 'emerald' };
  };

  const balances = wallet ? Object.entries(wallet.balances) : [];

  // Page-level guard: a failed owner-list load (or an empty operator list) must
  // never leave the page blank — show a recoverable error / empty state instead.
  if (ownersError) {
    return (
      <div className="container">
        <PageHeader
          title="My wallet"
          subtitle="Pack balances, loyalty points & credit"
          badge={<StatusPill status="active">Active</StatusPill>}
        />
        <Card title="Balances" topAccent="primary">
          <InlineError
            message="We couldn’t load your venue operators."
            detail={ownersError}
            onRetry={loadOwners}
            retrying={ownersLoading}
          />
        </Card>
      </div>
    );
  }

  if (!ownersLoading && owners.length === 0) {
    return (
      <div className="container">
        <PageHeader
          title="My wallet"
          subtitle="Pack balances, loyalty points & credit"
          badge={<StatusPill status="active">Active</StatusPill>}
        />
        <Card title="Balances" topAccent="primary">
          <EmptyState
            title="No venue operators yet"
            hint="Once you book or buy a pack with a venue operator, your wallet with them shows up here."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="container">
      <PageHeader
        title="My wallet"
        subtitle="Pack balances, loyalty points & credit"
        badge={<StatusPill status="active">Active</StatusPill>}
      />

      <Card
        title="Balances"
        subtitle="Choose a venue operator to see what you have with them."
        topAccent="primary"
        action={
          <div className="w-56 shrink-0">
            <Select
              label="Venue operator"
              value={ownerId}
              onChange={setOwnerId}
              options={owners.map((o) => ({ value: o.id, label: o.name }))}
            />
          </div>
        }
      >
        {walletError ? (
          <InlineError
            message="We couldn’t load this operator’s balances."
            detail={walletError}
            onRetry={() => load(ownerId)}
            retrying={walletLoading}
          />
        ) : walletLoading || !wallet ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : balances.length === 0 ? (
            <EmptyState
              title="No balances yet"
              hint="Buy a pack or earn points and your balances will show up here."
            />
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {balances.map(([lane, bal]) => {
                const meta = laneMeta(lane);
                return (
                  <Stat
                    key={lane}
                    label={meta.label}
                    value={bal}
                    accent={meta.accent}
                    icon={meta.icon}
                  />
                );
              })}
            </div>
          )}
      </Card>

      <Card
        title="Buy a pack"
        subtitle="Top up sessions with a membership pack from this operator."
        topAccent="emerald"
      >
        {packs.length === 0 ? (
          <EmptyState
            title="No packs offered"
            hint="This operator hasn’t published any membership packs yet."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {packs.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
                    <Package className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-display font-semibold text-sm leading-tight truncate">
                      {p.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {p.sessions} sessions · ₹{p.price} · {p.pricingMode}
                    </p>
                  </div>
                </div>
                <Button size="sm" onClick={() => buy(p.id)} className="shrink-0">
                  Buy
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {wallet && (
        <Card
          title="Ledger history"
          subtitle="Every pack purchase, point and credit movement."
          topAccent="blue"
        >
          {wallet.history.length === 0 ? (
            <EmptyState
              title="No transactions yet"
              hint="Your pack purchases, points and credits will appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Lane</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wallet.history.map((h, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {new Date(h.at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <StatusPill status={h.type} />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {h.lane}
                    </TableCell>
                    <TableCell
                      className={`font-mono font-medium ${
                        h.amount < 0 ? 'text-destructive' : 'text-primary'
                      }`}
                    >
                      {h.amount > 0 ? `+${h.amount}` : h.amount}
                    </TableCell>
                    <TableCell className="font-mono">{h.balanceAfter}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      <Msg text={msg} />
    </div>
  );
}
