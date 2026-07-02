import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CreditCard, RefreshCw, Sparkles, Ticket } from 'lucide-react';
import { api, DiscoverVenue, Pack, WalletSummary } from '../../api/client';
import { openCheckout, razorpayEnabled } from '../../lib/razorpay';
import { useFloodlitToast, flMoney } from '../../floodlit/toast';
import { Skeleton } from '../../components/ui/skeleton';

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
      <span
        className="grid h-12 w-12 place-items-center rounded-2xl mb-4"
        style={{ background: 'color-mix(in srgb, var(--danger) 14%, transparent)', color: 'var(--danger)' }}
      >
        <AlertCircle className="h-6 w-6" />
      </span>
      <p className="fl-display text-base" style={{ color: 'var(--chalk)' }}>
        {message}
      </p>
      {detail && (
        <p className="text-sm mt-1 max-w-sm" style={{ color: 'var(--muted)' }}>
          {detail}
        </p>
      )}
      <button
        onClick={onRetry}
        disabled={retrying}
        className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
        style={{ border: '1px solid var(--line-strong)', color: 'var(--chalk)', background: 'transparent' }}
      >
        <RefreshCw className={`h-4 w-4${retrying ? ' animate-spin' : ''}`} />
        {retrying ? 'Retrying…' : 'Try again'}
      </button>
    </div>
  );
}

/** A single Floodlit card surface. */
function Surface({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl p-5 ${className}`}
      style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
    >
      {children}
    </div>
  );
}

/** A mono "kicker" section label, e.g. BUY A SESSION PACK. */
function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fl-mono"
      style={{
        fontSize: '11px',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--faint)',
      }}
    >
      {children}
    </div>
  );
}

/**
 * PACK-6) Human-readable labels for the raw ledger enum (LedgerTxnType). Unknown
 * types fall back to a de-snake-cased title so the row never shows a bare enum.
 */
const LEDGER_LABELS: Record<string, string> = {
  pack_buy: 'Pack purchased',
  pack_debit: 'Session used',
  pack_refund: 'Session refunded',
  points_earn: 'Points earned',
  points_redeem: 'Points redeemed',
  referral_reward: 'Referral reward',
  no_show_fee: 'No-show fee',
  cash_refund: 'Refund',
  open_match_settle: 'Open match settled',
  pack_expire: 'Pack expired',
};

const ledgerLabel = (type: string): string =>
  LEDGER_LABELS[type] ??
  type
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');

/** PACK-5) Human-readable one-liner for a pack's pricing mode. */
const pricingLabel = (p: Pack): string => {
  if (p.pricingMode === 'discount') {
    const pct = p.discountPct == null ? null : Number(p.discountPct);
    return pct ? `${pct}% off sessions` : 'Discounted sessions';
  }
  if (p.pricingMode === 'flat') {
    const rate = p.flatRate == null ? null : Number(p.flatRate);
    return rate ? `${flMoney(rate)} per session` : 'Flat-rate sessions';
  }
  return p.pricingMode;
};

/** PACK-5) Human-readable one-liner for a pack's validity / expiry policy. */
const expiryLabel = (p: Pack): string => {
  const days = p.validityDays == null ? null : Number(p.validityDays);
  if (!days) return 'No expiry';
  const window = `Valid ${days} day${days === 1 ? '' : 's'}`;
  if (p.expiryMode === 'forfeit') return `${window} · unused sessions forfeited`;
  if (p.expiryMode === 'rollover') return `${window} · unused sessions roll over`;
  return window;
};

/** Customer wallet: pack balances, points, credit + buy packs (PRD §5.1). */
export function WalletPage() {
  const { flash } = useFloodlitToast();
  const [owners, setOwners] = useState<{ id: string; name: string }[]>([]);
  const [ownerId, setOwnerId] = useState('');
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  // PACK-1fe) The pack id currently being purchased — disables its Buy button so
  // a double-tap can't fire two purchases.
  const [buying, setBuying] = useState<string | null>(null);

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
    if (buying) return;
    setBuying(packId);
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
              const confirmed = await api.purchasePack(ownerId, packId, {
                razorpayOrderId: sig.razorpay_order_id,
                razorpayPaymentId: sig.razorpay_payment_id,
                razorpaySignature: sig.razorpay_signature,
              });
              flash(
                `Purchased — ${confirmed.sessionsAdded} sessions added (balance ${confirmed.balance}).`,
              );
              load(ownerId);
            } catch (e) {
              flash((e as Error).message);
            } finally {
              setBuying(null);
            }
          },
          // Modal closed without paying — re-enable the Buy button.
          onDismiss: () => setBuying(null),
        });
        return;
      }

      flash(`Purchased — ${res.sessionsAdded} sessions added (balance ${res.balance}).`);
      load(ownerId);
      setBuying(null);
    } catch (e) {
      flash((e as Error).message);
      setBuying(null);
    }
  };

  const balances = wallet ? Object.entries(wallet.balances) : [];

  // The three balance tiles always render as a 3-up, even when a value is 0:
  // sessions sums every pack: lane; points/credit pull from their matching lanes.
  const sumLanes = (match: (lane: string) => boolean): number =>
    balances.reduce((acc, [lane, bal]) => (match(lane) ? acc + Number(bal) : acc), 0);
  const tiles: { label: string; icon: typeof Ticket; color: string; value: number }[] = [
    {
      label: 'sessions',
      icon: Ticket,
      color: 'var(--brand)',
      value: sumLanes((l) => l.startsWith('pack:')),
    },
    {
      label: 'points',
      icon: Sparkles,
      color: 'var(--amber)',
      value: sumLanes((l) => {
        const x = l.toLowerCase();
        return x.includes('point') || x.includes('loyalty');
      }),
    },
    {
      label: 'credit',
      icon: CreditCard,
      color: 'var(--chalk)',
      value: sumLanes((l) => l.toLowerCase().includes('credit')),
    },
  ];

  const selectedOwnerName = owners.find((o) => o.id === ownerId)?.name ?? 'this operator';

  const heading = (
    <div>
      <h1 className="fl-display" style={{ fontSize: '28px', lineHeight: 1.05 }}>
        My wallet
      </h1>
      <p className="text-sm mt-1" style={{ color: 'var(--faint)' }}>
        Balances are separate for each operator you play with.
      </p>
    </div>
  );

  // Page-level guard: a failed owner-list load (or an empty operator list) must
  // never leave the page blank — show a recoverable error / empty state instead.
  if (ownersError) {
    return (
      <div className="space-y-5">
        {heading}
        <Surface>
          <InlineError
            message="We couldn’t load your venue operators."
            detail={ownersError}
            onRetry={loadOwners}
            retrying={ownersLoading}
          />
        </Surface>
      </div>
    );
  }

  if (!ownersLoading && owners.length === 0) {
    return (
      <div className="space-y-5">
        {heading}
        <div
          className="text-center rounded-2xl px-5 py-10"
          style={{ background: 'var(--surface)', border: '1px dashed var(--line-strong)' }}
        >
          <div style={{ fontSize: '30px' }}>🎟️</div>
          <div className="fl-display mt-3" style={{ fontSize: '18px' }}>
            No venue operators yet
          </div>
          <p className="text-sm mt-1.5 max-w-sm mx-auto" style={{ color: 'var(--muted)' }}>
            Once you book or buy a pack with a venue operator, your wallet with them shows up here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {heading}

      {/* operator selector — chips */}
      <div className="flex flex-wrap gap-2">
        {owners.map((o) => {
          const active = o.id === ownerId;
          return (
            <button
              key={o.id}
              onClick={() => setOwnerId(o.id)}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors"
              style={{
                color: 'var(--chalk)',
                border: `1px solid ${active ? 'var(--brand)' : 'var(--line)'}`,
                background: active
                  ? 'color-mix(in srgb, var(--brand) 16%, transparent)'
                  : 'var(--surface)',
              }}
            >
              {o.name}
            </button>
          );
        })}
      </div>

      {/* balances + packs side by side on desktop */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* balances */}
        <div className="space-y-3">
          {walletError ? (
            <Surface>
              <InlineError
                message="We couldn’t load this operator’s balances."
                detail={walletError}
                onRetry={() => load(ownerId)}
                retrying={walletLoading}
              />
            </Surface>
          ) : walletLoading || !wallet ? (
            <div className="grid grid-cols-3 gap-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2.5">
              {tiles.map((t) => (
                <div
                  key={t.label}
                  className="rounded-2xl px-3 py-3.5"
                  style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
                >
                  <div
                    className="fl-mono"
                    style={{ fontSize: '26px', fontWeight: 600, color: t.color }}
                  >
                    {t.value}
                  </div>
                  <div className="mt-1" style={{ fontSize: '11px', color: 'var(--faint)' }}>
                    {t.label}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* buy a pack */}
        <div className="space-y-2.5">
          <Kicker>Buy a session pack</Kicker>
          {packs.length === 0 ? (
            <div
              className="text-center rounded-2xl px-5 py-8 text-sm"
              style={{ background: 'var(--surface)', border: '1px dashed var(--line-strong)', color: 'var(--muted)' }}
            >
              This operator hasn’t published any membership packs yet.
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {packs.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl p-3.5"
                  style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="fl-display truncate" style={{ fontSize: '16px' }}>
                      {p.name}
                    </div>
                    <div className="mt-0.5" style={{ fontSize: '12px', color: 'var(--muted)' }}>
                      {p.sessions} sessions · {pricingLabel(p)}
                    </div>
                    <div className="mt-0.5" style={{ fontSize: '11.5px', color: 'var(--faint)' }}>
                      {expiryLabel(p)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="fl-mono" style={{ fontSize: '17px', fontWeight: 600 }}>
                      {flMoney(Number(p.price))}
                    </div>
                    <button
                      onClick={() => buy(p.id)}
                      disabled={buying !== null}
                      className="mt-1.5 rounded-lg px-4 py-1.5 font-bold disabled:opacity-50"
                      style={{
                        background: 'var(--brand)',
                        color: 'var(--on-brand)',
                        border: 'none',
                        fontSize: '12px',
                        cursor: buying !== null ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {buying === p.id ? 'Buying…' : 'Buy'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ledger */}
      {wallet && (
        <div className="space-y-2.5">
          <Kicker>Transaction history</Kicker>
          {wallet.history.length === 0 ? (
            <div
              className="text-center rounded-2xl px-5 py-6 text-sm"
              style={{ background: 'var(--surface)', border: '1px dashed var(--line-strong)', color: 'var(--muted)' }}
            >
              No transactions with {selectedOwnerName} yet.
            </div>
          ) : (
            <div
              className="rounded-2xl px-4"
              style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
            >
              {wallet.history.map((h, i) => (
                <div
                  key={i}
                  className="flex justify-between items-start py-3.5"
                  style={{
                    borderBottom:
                      i === wallet.history.length - 1 ? 'none' : '1px solid var(--line)',
                  }}
                >
                  <div className="flex-1 min-w-0 pr-3">
                    <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--chalk)' }}>
                      {ledgerLabel(h.type)}
                    </div>
                    <div
                      className="mt-0.5 truncate"
                      style={{ fontSize: '11.5px', color: 'var(--faint)' }}
                    >
                      {[h.note, h.lane].filter(Boolean).join(' · ')} ·{' '}
                      {new Date(h.at).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className="fl-mono"
                      style={{
                        fontSize: '13.5px',
                        fontWeight: 600,
                        color: h.amount < 0 ? 'var(--danger)' : 'var(--green)',
                      }}
                    >
                      {h.amount > 0 ? `+${h.amount}` : h.amount}
                    </div>
                    <div
                      className="fl-mono mt-0.5"
                      style={{ fontSize: '11px', color: 'var(--faint)' }}
                    >
                      {h.balanceAfter}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
