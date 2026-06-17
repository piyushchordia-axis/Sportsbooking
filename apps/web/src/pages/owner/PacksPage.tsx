import { PackExpiryMode, PackPricingMode } from '@sportsbooking/shared';
import { useState } from 'react';
import { api } from '../../api/client';
import { Card, Field, Msg, Select, useLoad } from '../../components/common';

/** Owner: membership session packs (PRD §4.4). */
export function PacksPage() {
  const packs = useLoad(() => api.listPacks());
  const [name, setName] = useState('10-Play Flat');
  const [sessions, setSessions] = useState('10');
  const [price, setPrice] = useState('5000');
  const [pricingMode, setPricingMode] = useState<PackPricingMode>(PackPricingMode.FLAT);
  const [discountPct, setDiscountPct] = useState('20');
  const [expiryMode, setExpiryMode] = useState<PackExpiryMode>(PackExpiryMode.NONE);
  const [msg, setMsg] = useState<string | null>(null);

  const create = async () => {
    setMsg(null);
    try {
      await api.createPack({
        name,
        sessions: Number(sessions),
        price: Number(price),
        pricingMode,
        discountPct: pricingMode === PackPricingMode.DISCOUNT ? Number(discountPct) : undefined,
        expiryMode,
      });
      setMsg('Pack created.');
      packs.reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="container">
      <Card title="Create pack">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <Field label="Name" value={name} onChange={setName} />
          <Field label="Sessions" value={sessions} onChange={setSessions} />
          <Field label="Price ₹" value={price} onChange={setPrice} />
          <Select
            label="Pricing"
            value={pricingMode}
            onChange={(x) => setPricingMode(x as PackPricingMode)}
            options={Object.values(PackPricingMode).map((m) => ({ value: m, label: m }))}
          />
          {pricingMode === PackPricingMode.DISCOUNT && (
            <Field label="Discount %" value={discountPct} onChange={setDiscountPct} />
          )}
          <Select
            label="Expiry"
            value={expiryMode}
            onChange={(x) => setExpiryMode(x as PackExpiryMode)}
            options={Object.values(PackExpiryMode).map((m) => ({ value: m, label: m }))}
          />
        </div>
        <button onClick={create}>Create pack</button>
        <Msg text={msg} />
      </Card>

      <Card title="Packs">
        {(packs.data ?? []).map((p) => (
          <div key={p.id} style={{ borderBottom: '1px solid #eee', padding: '6px 0' }}>
            <strong>{p.name}</strong> — {p.sessions} sessions · ₹{p.price} · {p.pricingMode}
            {p.pricingMode === 'discount' ? ` ${p.discountPct}%` : ''} · expiry {p.expiryMode}
          </div>
        ))}
      </Card>
    </div>
  );
}
