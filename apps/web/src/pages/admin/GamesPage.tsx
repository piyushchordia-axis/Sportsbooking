import { UnitLabel } from '@sportsbooking/shared';
import { useState } from 'react';
import { api } from '../../api/client';
import { Card, Field, Msg, Select, useLoad } from '../../components/common';

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
      <Card title="Add game">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
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
        <button onClick={create}>Add game</button>
        <Msg text={msg} />
      </Card>

      <Card title="Catalogue">
        {(games.data ?? []).map((g) => (
          <div key={g.id} style={{ borderBottom: '1px solid #eee', padding: '6px 0' }}>
            <strong>{g.name}</strong> — {g.unitLabel} · {g.slotGranularityMin}min ·{' '}
            {g.minPlayers}-{g.maxPlayers} players
          </div>
        ))}
      </Card>
    </div>
  );
}
