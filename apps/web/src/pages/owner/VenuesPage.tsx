import { AddonType, DayType, TimeBand, UnitLabel } from '@sportsbooking/shared';
import { useState } from 'react';
import { api } from '../../api/client';
import { Card, Field, Msg, Select, useLoad } from '../../components/common';

/** Owner: venues, courts, per-court price grid and add-ons (PRD §4.1–4.3, §4.6). */
export function VenuesPage() {
  const games = useLoad(() => api.discoverGames());
  const venues = useLoad(() => api.listVenues());
  const [msg, setMsg] = useState<string | null>(null);

  // new venue
  const [vName, setVName] = useState('New Arena');
  const [city, setCity] = useState('Bengaluru');
  const [gameId, setGameId] = useState('');

  // new unit
  const [uName, setUName] = useState('Court 1');
  const [uLabel, setULabel] = useState<UnitLabel>(UnitLabel.COURT);

  const wrap = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      venues.reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const gameOpts = (games.data ?? []).map((g: any) => ({ value: g.id, label: g.name }));
  const firstGame = gameId || gameOpts[0]?.value || '';

  return (
    <div className="container">
      <Card title="Create venue">
        <Field label="Name" value={vName} onChange={setVName} />
        <Field label="City" value={city} onChange={setCity} />
        <Select label="Game" value={firstGame} onChange={setGameId} options={gameOpts} />
        <button
          onClick={() =>
            wrap(
              () => api.createVenue({ name: vName, city, gameIds: [firstGame] }),
              'Venue created.',
            )
          }
          disabled={!firstGame}
        >
          Create venue
        </button>
        <Msg text={msg} />
      </Card>

      {(venues.data ?? []).map((v: any) => (
        <Card key={v.id} title={`${v.name} — ${v.city ?? ''}`}>
          <div style={{ marginBottom: 8 }}>
            <strong>Courts:</strong>{' '}
            {v.units.length ? v.units.map((u: any) => u.name).join(', ') : 'none yet'}
          </div>

          <details>
            <summary>Add a court</summary>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '8px 0' }}>
              <Field label="Court name" value={uName} onChange={setUName} />
              <Select
                label="Label"
                value={uLabel}
                onChange={(x) => setULabel(x as UnitLabel)}
                options={Object.values(UnitLabel).map((l) => ({ value: l, label: l }))}
              />
            </div>
            <button
              onClick={() =>
                wrap(
                  () =>
                    api.addUnit(v.id, {
                      name: uName,
                      label: uLabel,
                      gameId: v.games[0]?.gameId ?? firstGame,
                      capacity: 4,
                    }),
                  'Court added.',
                )
              }
            >
              Add court
            </button>
          </details>

          {v.units.map((u: any) => (
            <UnitPricing key={u.id} unit={u} onMsg={setMsg} />
          ))}

          <AddAddon venueId={v.id} onMsg={setMsg} />
        </Card>
      ))}
    </div>
  );
}

function UnitPricing({ unit, onMsg }: { unit: any; onMsg: (m: string) => void }) {
  const [base, setBase] = useState('600');
  const [weekend, setWeekend] = useState('800');
  const [evening, setEvening] = useState('900');

  const save = async () => {
    onMsg('');
    try {
      await api.setPricing(unit.id, [
        { price: Number(base) },
        { dayType: DayType.WEEKEND, price: Number(weekend) },
        { timeBand: TimeBand.EVENING, price: Number(evening) },
      ]);
      onMsg(`Price grid saved for ${unit.name}.`);
    } catch (e) {
      onMsg((e as Error).message);
    }
  };

  return (
    <details style={{ marginTop: 6 }}>
      <summary>Price grid — {unit.name}</summary>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, margin: '8px 0' }}>
        <Field label="Base ₹/hr" value={base} onChange={setBase} />
        <Field label="Weekend ₹/hr" value={weekend} onChange={setWeekend} />
        <Field label="Evening ₹/hr" value={evening} onChange={setEvening} />
      </div>
      <button onClick={save}>Save grid</button>
    </details>
  );
}

function AddAddon({ venueId, onMsg }: { venueId: string; onMsg: (m: string) => void }) {
  const [name, setName] = useState('Racket rental');
  const [type, setType] = useState<AddonType>(AddonType.RENTAL);
  const [price, setPrice] = useState('100');

  const add = async () => {
    onMsg('');
    try {
      await api.createAddon(venueId, { name, type, price: Number(price) });
      onMsg('Add-on created.');
    } catch (e) {
      onMsg((e as Error).message);
    }
  };

  return (
    <details style={{ marginTop: 6 }}>
      <summary>Add an add-on</summary>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, margin: '8px 0' }}>
        <Field label="Name" value={name} onChange={setName} />
        <Select
          label="Type"
          value={type}
          onChange={(x) => setType(x as AddonType)}
          options={Object.values(AddonType).map((t) => ({ value: t, label: t }))}
        />
        <Field label="Price ₹" value={price} onChange={setPrice} />
      </div>
      <button onClick={add}>Create add-on</button>
    </details>
  );
}
