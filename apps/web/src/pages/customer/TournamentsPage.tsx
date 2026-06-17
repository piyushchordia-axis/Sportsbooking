import { useEffect, useState } from 'react';
import { api, DiscoverVenue } from '../../api/client';
import { Card, Field, Msg, Select } from '../../components/common';

/** Customer: browse and register for tournaments (PRD §4.7, §5.4). */
export function TournamentsPage() {
  const [venues, setVenues] = useState<DiscoverVenue[]>([]);
  const [venueId, setVenueId] = useState('');
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [team, setTeam] = useState('');
  const [name, setName] = useState('Captain');
  const [mobile, setMobile] = useState('+919800000099');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.discoverVenues().then((vs) => {
      setVenues(vs);
      if (vs[0]) setVenueId(vs[0].id);
    });
  }, []);

  useEffect(() => {
    if (venueId) api.listTournaments(venueId).then(setTournaments).catch(() => setTournaments([]));
  }, [venueId]);

  const register = async (id: string) => {
    setMsg(null);
    try {
      const res = await api.registerTournament(id, {
        captainName: name,
        captainMobile: mobile,
        teamName: team || undefined,
      });
      setMsg(`Registered — pay ₹${res.fee} (order ${res.razorpayOrderId}).`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="container">
      <Card title="Tournaments">
        <Select
          label="Venue"
          value={venueId}
          onChange={setVenueId}
          options={venues.map((v) => ({ value: v.id, label: v.name }))}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Field label="Captain name" value={name} onChange={setName} />
          <Field label="Mobile" value={mobile} onChange={setMobile} />
          <Field label="Team (optional)" value={team} onChange={setTeam} />
        </div>
      </Card>

      {tournaments.length === 0 && <Card><p>No tournaments at this venue.</p></Card>}
      {tournaments.map((t) => (
        <Card key={t.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              <strong>{t.name}</strong> — {t.format} · {t.regType} · ₹{t.fee} ({t.feeBasis}) ·{' '}
              {t._count?.participants ?? 0}/{t.capacity} registered
            </span>
            <button onClick={() => register(t.id)}>Register</button>
          </div>
        </Card>
      ))}

      <Msg text={msg} />
    </div>
  );
}
