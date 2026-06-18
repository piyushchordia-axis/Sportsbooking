import { UnitLabel } from '@sportsbooking/shared';
import { useState } from 'react';
import { api } from '../../api/client';
import { Card, Field, Msg, PageHeader, Select, useLoad } from '../../components/common';

/** Super Admin: global game catalogue (PRD §3.1). */
export function GamesPage() {
  const games = useLoad(() => api.listGames());
  const [name, setName] = useState('Badminton');
  const [unitLabel, setUnitLabel] = useState<UnitLabel>(UnitLabel.COURT);
  const [granularity, setGranularity] = useState('60');
  const [minP, setMinP] = useState('2');
  const [maxP, setMaxP] = useState('4');
  const [msg, setMsg] = useState<string | null>(null);

  const create = async () => {
    setMsg(null);
    try {
      await api.createGame({
        name,
        unitLabel,
        slotGranularityMin: Number(granularity),
        minPlayers: Number(minP),
        maxPlayers: Number(maxP),
      });
      setMsg('Game added.');
      games.reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="container">
      <PageHeader title="Games" subtitle="Global game catalogue" />
      <Card title="Add game">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label="Name" value={name} onChange={setName} />
          <Select
            label="Unit label"
            value={unitLabel}
            onChange={(x) => setUnitLabel(x as UnitLabel)}
            options={Object.values(UnitLabel).map((l) => ({ value: l, label: l }))}
          />
          <Select
            label="Slot mins"
            value={granularity}
            onChange={setGranularity}
            options={['30', '60', '90'].map((g) => ({ value: g, label: g }))}
          />
          <Field label="Min players" value={minP} onChange={setMinP} />
          <Field label="Max players" value={maxP} onChange={setMaxP} />
        </div>
        <button
          onClick={create}
          className="mt-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
        >
          Add game
        </button>
        <Msg text={msg} />
      </Card>

      <Card title="Catalogue">
        <div className="divide-y divide-border">
          {(games.data ?? []).map((g) => (
            <div key={g.id} className="py-3 first:pt-0 text-sm">
              <strong className="font-display">{g.name}</strong>{' '}
              <span className="text-muted-foreground">
                — {g.unitLabel} · {g.slotGranularityMin}min · {g.minPlayers}-{g.maxPlayers} players
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
