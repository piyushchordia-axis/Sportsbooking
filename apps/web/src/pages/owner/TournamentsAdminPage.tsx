import {
  FeeBasis,
  RegistrationType,
  TournamentFormat,
} from '@sportsbooking/shared';
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Card, Field, Msg, Select, useLoad } from '../../components/common';

/** Owner: create tournaments (PRD §4.7). */
export function TournamentsAdminPage() {
  const venues = useLoad(() => api.listVenues());
  const [venueId, setVenueId] = useState('');
  const [name, setName] = useState('Summer Smash');
  const [format, setFormat] = useState<TournamentFormat>(TournamentFormat.KNOCKOUT);
  const [regType, setRegType] = useState<RegistrationType>(RegistrationType.TEAM);
  const [feeBasis, setFeeBasis] = useState<FeeBasis>(FeeBasis.PER_TEAM);
  const [fee, setFee] = useState('1500');
  const [capacity, setCapacity] = useState('16');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!venueId && venues.data?.[0]) setVenueId(venues.data[0].id);
  }, [venues.data, venueId]);

  const venue = (venues.data ?? []).find((v: any) => v.id === venueId);

  const create = async () => {
    setMsg(null);
    try {
      await api.createTournament({
        venueId,
        name,
        gameId: venue?.games?.[0]?.gameId,
        format,
        regType,
        feeBasis,
        fee: Number(fee),
        capacity: Number(capacity),
        startDate: '2026-07-01',
        endDate: '2026-07-02',
      });
      setMsg('Tournament created.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="container">
      <Card title="Create tournament">
        <Select
          label="Venue"
          value={venueId}
          onChange={setVenueId}
          options={(venues.data ?? []).map((v: any) => ({ value: v.id, label: v.name }))}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <Field label="Name" value={name} onChange={setName} />
          <Select
            label="Format"
            value={format}
            onChange={(x) => setFormat(x as TournamentFormat)}
            options={Object.values(TournamentFormat).map((f) => ({ value: f, label: f }))}
          />
          <Select
            label="Registration"
            value={regType}
            onChange={(x) => setRegType(x as RegistrationType)}
            options={Object.values(RegistrationType).map((r) => ({ value: r, label: r }))}
          />
          <Select
            label="Fee basis"
            value={feeBasis}
            onChange={(x) => setFeeBasis(x as FeeBasis)}
            options={Object.values(FeeBasis).map((f) => ({ value: f, label: f }))}
          />
          <Field label="Fee ₹" value={fee} onChange={setFee} />
          <Field label="Capacity" value={capacity} onChange={setCapacity} />
        </div>
        <button onClick={create} disabled={!venueId}>
          Create tournament
        </button>
        <Msg text={msg} />
      </Card>
    </div>
  );
}
