import { PayMode, ResolvedSlot, SlotStatus } from '@sportsbooking/shared';
import { useEffect, useState } from 'react';
import { api, DiscoverVenue, Pack } from '../../api/client';
import { Card, Field, Msg, Select } from '../../components/common';
import { useTheme } from '../../theme/ThemeProvider';

export function BookingPage() {
  const { setBranding } = useTheme();
  const [venues, setVenues] = useState<DiscoverVenue[]>([]);
  const [venue, setVenue] = useState<DiscoverVenue | null>(null);
  const [unitId, setUnitId] = useState('');
  const [date, setDate] = useState('2026-06-20');
  const [slots, setSlots] = useState<ResolvedSlot[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [packs, setPacks] = useState<Pack[]>([]);
  const [packId, setPackId] = useState('');
  const [points, setPoints] = useState('0');
  const [offer, setOffer] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.discoverVenues().then(setVenues).catch((e) => setMsg(e.message));
  }, []);

  const pickVenue = async (v: DiscoverVenue) => {
    setVenue(v);
    setBranding(v.branding);
    setUnitId(v.units[0]?.id ?? '');
    setSlots([]);
    setSelected(new Set());
    api.listOwnerPacks(v.ownerId).then(setPacks).catch(() => setPacks([]));
  };

  const load = async () => {
    setMsg(null);
    setSelected(new Set());
    try {
      const res = await api.availability(unitId, date);
      setSlots(res.slots);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const toggle = (s: ResolvedSlot) => {
    if (s.status !== SlotStatus.OPEN) return;
    const next = new Set(selected);
    next.has(s.start) ? next.delete(s.start) : next.add(s.start);
    setSelected(next);
  };

  const total = slots
    .filter((s) => selected.has(s.start))
    .reduce((sum, s) => sum + s.price, 0);

  const book = async (payMode: PayMode) => {
    if (!venue) return;
    setMsg(null);
    const cart = slots
      .filter((s) => selected.has(s.start))
      .map((s) => ({ unitId: s.unitId, start: s.start, end: s.end }));
    try {
      const res = await api.createBooking({
        venueId: venue.id,
        slots: cart,
        payMode,
        packId: packId || undefined,
        offerCode: offer || undefined,
        pointsToRedeem: Number(points) || undefined,
      });
      setMsg(`Booking ${res.id} — ${res.status} · paid ₹${res.total} (${res.paymentStatus})`);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="container">
      <Card title="Find a venue">
        <div className="slot-grid">
          {venues.map((v) => (
            <div
              key={v.id}
              className="slot"
              style={{ borderColor: venue?.id === v.id ? 'var(--color-accent)' : undefined }}
              onClick={() => pickVenue(v)}
            >
              <strong>{v.name}</strong>
              <div style={{ fontSize: 12 }}>{v.city}</div>
              <div style={{ fontSize: 12 }}>{v.games.map((g) => g.name).join(', ')}</div>
            </div>
          ))}
        </div>
      </Card>

      {venue && (
        <Card title={`${venue.name} — pick a court & date`}>
          <Select
            label="Court"
            value={unitId}
            onChange={setUnitId}
            options={venue.units.map((u) => ({ value: u.id, label: `${u.name} (${u.label})` }))}
          />
          <Field label="Date" type="date" value={date} onChange={setDate} />
          <button onClick={load} disabled={!unitId}>
            Load availability
          </button>
        </Card>
      )}

      {slots.length > 0 && (
        <Card title={`${date} — resolved per-court pricing`}>
          <div className="slot-grid">
            {slots.map((s) => (
              <div
                key={s.start}
                className={selected.has(s.start) ? 'slot selected' : `slot ${s.status}`}
                onClick={() => toggle(s)}
              >
                <div>
                  {new Date(s.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <strong>{s.status === SlotStatus.OPEN ? `₹${s.price}` : s.status}</strong>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
            <Select
              label="Use pack"
              value={packId}
              onChange={setPackId}
              options={[{ value: '', label: 'None' }, ...packs.map((p) => ({ value: p.id, label: p.name }))]}
            />
            <Field label="Redeem points" value={points} onChange={setPoints} />
            <Field label="Offer code" value={offer} onChange={setOffer} />
          </div>

          <p>
            Selected {selected.size} slot(s) — <strong>₹{total}</strong> before pack/points/offer
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => book(PayMode.PREPAY)} disabled={!selected.size}>
              Prepay
            </button>
            <button className="accent" onClick={() => book(PayMode.AT_VENUE)} disabled={!selected.size}>
              Pay at venue
            </button>
          </div>
        </Card>
      )}

      <Msg text={msg} />
    </div>
  );
}
