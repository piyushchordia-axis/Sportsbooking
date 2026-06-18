import { PayMode, ResolvedSlot, SlotStatus } from '@sportsbooking/shared';
import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { api, DiscoverVenue, Pack } from '../../api/client';
import { Field, Msg, PageHeader, Select } from '../../components/common';
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
      // Refresh availability first (load() clears the message), then surface
      // the confirmation so it persists for the customer.
      await load();
      setMsg(`Booking ${res.id} — ${res.status} · paid ₹${res.total} (${res.paymentStatus})`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="container">
      <PageHeader title="Book a court" subtitle="Find a venue, pick your slots, lock it in" />

      {/* Venue discovery */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {venues.map((v) => {
          const active = venue?.id === v.id;
          return (
            <button
              key={v.id}
              onClick={() => pickVenue(v)}
              aria-pressed={active}
              className={`text-left bg-card border rounded-xl p-4 transition-colors ${
                active
                  ? 'border-primary ring-1 ring-primary/40'
                  : 'border-border hover:border-primary/40'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display font-semibold text-lg leading-tight">{v.name}</h3>
                {active && (
                  <span className="text-[10px] font-mono uppercase tracking-widest text-primary mt-1">
                    Selected
                  </span>
                )}
              </div>
              <p className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                <MapPin className="h-3.5 w-3.5" /> {v.city}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {v.games.map((g) => (
                  <span
                    key={g.id}
                    className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground"
                  >
                    {g.name}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {venue && (
        <div className="bg-card border border-border rounded-xl p-5 mb-6">
          <h3 className="font-display font-semibold text-lg mb-4">
            {venue.name} — pick a court &amp; date
          </h3>

          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
            Court
          </p>
          <div className="flex flex-wrap gap-2 mb-4">
            {venue.units.map((u) => {
              const active = unitId === u.id;
              return (
                <button
                  key={u.id}
                  onClick={() => setUnitId(u.id)}
                  aria-pressed={active}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {u.name} <span className="opacity-70">({u.label})</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="w-48">
              <Field label="Date" type="date" value={date} onChange={setDate} />
            </div>
            <button
              onClick={load}
              disabled={!unitId}
              className="mb-3 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-40 hover:bg-primary/90 transition-colors"
            >
              Load availability
            </button>
          </div>
        </div>
      )}

      {slots.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Slot grid */}
          <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
            <h3 className="font-display font-semibold text-lg mb-1">{date}</h3>
            <p className="text-xs text-muted-foreground mb-4">Resolved per-court dynamic pricing</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {slots.map((s) => {
                const isOpen = s.status === SlotStatus.OPEN;
                const isSel = selected.has(s.start);
                const time = new Date(s.start).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                let cls =
                  'border-border bg-input-background hover:border-primary/50 cursor-pointer';
                if (isSel) cls = 'border-primary bg-primary/15 ring-1 ring-primary/40 cursor-pointer';
                else if (!isOpen)
                  cls = 'border-transparent bg-secondary/40 opacity-50 cursor-not-allowed';
                return (
                  <button
                    key={s.start}
                    onClick={() => toggle(s)}
                    disabled={!isOpen}
                    aria-pressed={isSel}
                    className={`flex flex-col items-center justify-center gap-1 rounded-lg border py-3 transition-colors ${cls}`}
                  >
                    <span className="text-xs font-mono text-muted-foreground">{time}</span>
                    <span
                      className={`font-display font-semibold ${
                        isSel ? 'text-primary' : isOpen ? 'text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {isOpen ? `₹${s.price}` : s.status}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Summary */}
          <div className="bg-card border border-border rounded-xl p-5 lg:sticky lg:top-20">
            <h3 className="font-display font-semibold text-lg mb-4">Order summary</h3>
            <Select
              label="Use pack"
              value={packId}
              onChange={setPackId}
              options={[
                { value: '', label: 'None' },
                ...packs.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
            <Field label="Redeem points" value={points} onChange={setPoints} />
            <Field label="Offer code" value={offer} onChange={setOffer} />

            <div className="flex items-center justify-between border-t border-border mt-2 pt-4">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  {selected.size} slot(s)
                </p>
                <p className="text-xs text-muted-foreground">before pack / points / offer</p>
              </div>
              <span className="font-display font-bold text-2xl">₹{total}</span>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-4">
              <button
                onClick={() => book(PayMode.PREPAY)}
                disabled={!selected.size}
                className="px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-40 hover:bg-primary/90 transition-colors"
              >
                Prepay
              </button>
              <button
                onClick={() => book(PayMode.AT_VENUE)}
                disabled={!selected.size}
                className="px-4 py-2.5 rounded-lg border border-accent text-accent font-semibold disabled:opacity-40 hover:bg-accent/10 transition-colors"
              >
                Pay at venue
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4">
        <Msg text={msg} />
      </div>
    </div>
  );
}
