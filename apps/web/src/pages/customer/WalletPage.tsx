import { useEffect, useState } from 'react';
import { api, DiscoverVenue, Pack, WalletSummary } from '../../api/client';
import { Card, Msg, Select } from '../../components/common';

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
      <Card title="My wallet">
        <Select
          label="Venue operator"
          value={ownerId}
          onChange={setOwnerId}
          options={owners.map((o) => ({ value: o.id, label: o.name }))}
        />
        {wallet && (
          <div className="slot-grid" style={{ marginTop: 12 }}>
            {Object.entries(wallet.balances).length === 0 && <p>No balances yet.</p>}
            {Object.entries(wallet.balances).map(([lane, bal]) => (
              <div key={lane} className="slot">
                <div style={{ fontSize: 12 }}>{lane.startsWith('pack:') ? 'Pack sessions' : lane}</div>
                <strong>{bal}</strong>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Buy a pack">
        {packs.length === 0 && <p>No packs offered.</p>}
        {packs.map((p) => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eee', padding: '8px 0' }}>
            <span>
              <strong>{p.name}</strong> — {p.sessions} sessions · ₹{p.price} · {p.pricingMode}
            </span>
            <button onClick={() => buy(p.id)}>Buy</button>
          </div>
        ))}
      </Card>

      {wallet && (
        <Card title="Ledger history">
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748b' }}>
                <th>When</th><th>Type</th><th>Lane</th><th>Amount</th><th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {wallet.history.map((h, i) => (
                <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td>{new Date(h.at).toLocaleString()}</td>
                  <td>{h.type}</td>
                  <td>{h.lane}</td>
                  <td>{h.amount}</td>
                  <td>{h.balanceAfter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Msg text={msg} />
    </div>
  );
}
