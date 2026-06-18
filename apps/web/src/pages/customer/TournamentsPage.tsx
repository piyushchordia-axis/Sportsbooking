import { useEffect, useState } from 'react';
import { api, DiscoverVenue } from '../../api/client';
import { Card, EmptyState, Field, ImageWithFallback, Msg, PageHeader, Select } from '../../components/common';
import { EMPTY_TROPHY, FALLBACK_VENUE_PHOTO, tournamentBanner } from '../../lib/imagery';

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

  const selectedVenue = venues.find((v) => v.id === venueId);
  const sportOf = (gameId: string) =>
    selectedVenue?.games.find((g) => g.id === gameId)?.name;

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
          <EmptyState
            image={EMPTY_TROPHY}
            title="No tournaments here yet"
            hint="This venue hasn’t scheduled any tournaments. Check back soon or try another venue."
          />
        </Card>
      )}
      {tournaments.map((t) => (
        <div key={t.id} className="bg-card border border-border rounded-xl overflow-hidden mb-4">
          <div className="relative h-28">
            <ImageWithFallback
              src={tournamentBanner(sportOf(t.gameId))}
              fallback={FALLBACK_VENUE_PHOTO}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-card via-card/70 to-card/20" />
            <div className="absolute inset-0 p-4 flex flex-col justify-end">
              <p className="font-display font-semibold text-lg leading-tight">{t.name}</p>
              <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mt-0.5">
                {t.format} · {t.regType}
              </p>
            </div>
          </div>
          <div className="p-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              ₹{t.fee} ({t.feeBasis}) · {t._count?.participants ?? 0}/{t.capacity} registered
            </p>
            <button
              onClick={() => register(t.id)}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shrink-0"
            >
              Register
            </button>
          </div>
        </div>
      ))}

      <Msg text={msg} />
    </div>
  );
}
