import { OfferType } from '@sportsbooking/shared';
import { useState } from 'react';
import { api } from '../../api/client';
import { Card, Field, Msg, Select, useLoad } from '../../components/common';

/** Owner: offers & promo codes (PRD §4.8). */
export function OffersPage() {
  const offers = useLoad(() => api.listOffers());
  const [name, setName] = useState('Weekend 10% off');
  const [type, setType] = useState<OfferType>(OfferType.PERCENT);
  const [value, setValue] = useState('10');
  const [code, setCode] = useState('WEEKEND10');
  const [msg, setMsg] = useState<string | null>(null);

  const create = async () => {
    setMsg(null);
    try {
      await api.createOffer({ name, type, value: Number(value), code: code || undefined });
      setMsg('Offer created.');
      offers.reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="container">
      <Card title="Create offer">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
          <Field label="Name" value={name} onChange={setName} />
          <Select
            label="Type"
            value={type}
            onChange={(x) => setType(x as OfferType)}
            options={Object.values(OfferType).map((t) => ({ value: t, label: t }))}
          />
          <Field label={type === 'percent' ? 'Percent' : 'Amount ₹'} value={value} onChange={setValue} />
          <Field label="Code" value={code} onChange={setCode} />
        </div>
        <button onClick={create}>Create offer</button>
        <Msg text={msg} />
      </Card>

      <Card title="Offers">
        {(offers.data ?? []).map((o) => (
          <div key={o.id} style={{ borderBottom: '1px solid #eee', padding: '6px 0' }}>
            <strong>{o.name}</strong> — {o.type === 'percent' ? `${o.value}%` : `₹${o.value}`} ·
            code {o.code ?? '—'} {o.autoApply ? '· auto' : ''}
          </div>
        ))}
      </Card>
    </div>
  );
}
