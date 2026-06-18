import { useEffect, useState } from 'react';
import { api, DiscoverVenue } from '../../api/client';
import { Card, Field, Msg, PageHeader, Select } from '../../components/common';

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
      <PageHeader title="Tournaments" subtitle="Browse & register your team" />
      <Card title="Your details">
        <Select
          label="Venue"
          value={venueId}
          onChange={setVenueId}
          options={venues.map((v) => ({ value: v.id, label: v.name }))}
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Captain name" value={name} onChange={setName} />
          <Field label="Mobile" value={mobile} onChange={setMobile} />
          <Field label="Team (optional)" value={team} onChange={setTeam} />
        </div>
      </Card>

      {tournaments.length === 0 && (
        <Card>
          <p className="text-muted-foreground text-sm">No tournaments at this venue.</p>
        </Card>
      )}
      {tournaments.map((t) => (
        <Card key={t.id}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-display font-semibold text-base">{t.name}</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t.format} · {t.regType} · ₹{t.fee} ({t.feeBasis}) ·{' '}
                {t._count?.participants ?? 0}/{t.capacity} registered
              </p>
            </div>
            <button
              onClick={() => register(t.id)}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shrink-0"
            >
              Register
            </button>
          </div>
        </Card>
      ))}

      <Msg text={msg} />
    </div>
  );
}
