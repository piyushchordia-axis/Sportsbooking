import { useEffect, useState } from 'react';
import { api, DiscoverVenue, Pack, WalletSummary } from '../../api/client';
import { Card, EmptyState, Msg, PageHeader, Select, Stat } from '../../components/common';

/** Customer wallet: pack balances, points, credit + buy packs (PRD §5.1). */
export function WalletPage() {
  const [owners, setOwners] = useState<{ id: string; name: string }[]>([]);
  const [ownerId, setOwnerId] = useState('');
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.discoverVenues().then((vs: DiscoverVenue[]) => {
      const uniq = Array.from(new Map(vs.map((v) => [v.ownerId, v.name.split(' — ')[0]])));
      setOwners(uniq.map(([id, name]) => ({ id, name })));
      if (uniq[0]) setOwnerId(uniq[0][0]);
    });
  }, []);

  const load = (oid: string) => {
    if (!oid) return;
    api.wallet(oid).then(setWallet).catch((e) => setMsg(e.message));
    api.listOwnerPacks(oid).then(setPacks).catch(() => setPacks([]));
  };

  useEffect(() => load(ownerId), [ownerId]);

  const buy = async (packId: string) => {
    setMsg(null);
    try {
      const res = await api.purchasePack(ownerId, packId);
      setMsg(`Purchased — ${res.sessionsAdded} sessions added (balance ${res.balance}).`);
      load(ownerId);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="container">
      <PageHeader title="My wallet" subtitle="Pack balances, points & credit" />

      <Card title="Balances">
        <Select
          label="Venue operator"
          value={ownerId}
          onChange={setOwnerId}
          options={owners.map((o) => ({ value: o.id, label: o.name }))}
        />
        {wallet &&
          (Object.entries(wallet.balances).length === 0 ? (
            <EmptyState
              title="No balances yet"
              hint="Buy a pack or earn points and your balances will show up here."
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
              {Object.entries(wallet.balances).map(([lane, bal]) => (
                <Stat
                  key={lane}
                  label={lane.startsWith('pack:') ? 'Pack sessions' : lane}
                  value={bal}
                  accent="primary"
                />
              ))}
            </div>
          ))}
      </Card>

      <Card title="Buy a pack">
        {packs.length === 0 ? (
          <EmptyState
            title="No packs offered"
            hint="This operator hasn’t published any membership packs yet."
          />
        ) : (
          <div className="divide-y divide-border">
            {packs.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                <span className="text-sm">
                  <strong className="font-display">{p.name}</strong>{' '}
                  <span className="text-muted-foreground">
                    — {p.sessions} sessions · ₹{p.price} · {p.pricingMode}
                  </span>
                </span>
                <button
                  onClick={() => buy(p.id)}
                  className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shrink-0"
                >
                  Buy
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {wallet && (
        <Card title="Ledger history">
          {wallet.history.length === 0 ? (
            <EmptyState
              title="No transactions yet"
              hint="Your pack purchases, points and credits will appear here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Type</th>
                    <th>Lane</th>
                    <th>Amount</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {wallet.history.map((h, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap text-muted-foreground">
                        {new Date(h.at).toLocaleString()}
                      </td>
                      <td>{h.type}</td>
                      <td className="font-mono text-xs">{h.lane}</td>
                      <td className="font-mono">{h.amount}</td>
                      <td className="font-mono">{h.balanceAfter}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Msg text={msg} />
    </div>
  );
}
