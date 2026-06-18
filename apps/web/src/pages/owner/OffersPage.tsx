import { OfferType } from '@sportsbooking/shared';
import { useState } from 'react';
import { api } from '../../api/client';
import { Card, Field, Msg, PageHeader, Select, useLoad } from '../../components/common';

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
      <PageHeader title="Offers" subtitle="Promotions & discount codes" />
      <Card title="Create offer">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Name" value={name} onChange={setName} />
          <Select
            label="Type"
            value={type}
            onChange={(x) => setType(x as OfferType)}
            options={Object.values(OfferType).map((t) => ({ value: t, label: t }))}
          />
          <Field
            label={type === 'percent' ? 'Percent' : 'Amount ₹'}
            value={value}
            onChange={setValue}
          />
          <Field label="Code" value={code} onChange={setCode} />
        </div>
        <button
          onClick={create}
          className="mt-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
        >
          Create offer
        </button>
        <Msg text={msg} />
      </Card>

      <Card title="Offers">
        <div className="divide-y divide-border">
          {(offers.data ?? []).map((o) => (
            <div key={o.id} className="py-3 first:pt-0 text-sm">
              <strong className="font-display">{o.name}</strong>{' '}
              <span className="text-muted-foreground">
                — {o.type === 'percent' ? `${o.value}%` : `₹${o.value}`} · code {o.code ?? '—'}{' '}
                {o.autoApply ? '· auto' : ''}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
