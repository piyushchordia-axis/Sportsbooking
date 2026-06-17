import { PayMode, ResolvedSlot, SlotStatus } from '@sportsbooking/shared';
import { useState } from 'react';
import { api } from '../api/client';

/**
 * Customer discovery + booking (PRD §5.2, §6.1): load a unit/day calendar with
 * resolved per-court pricing, multi-select slots, and book (pay-at-venue here;
 * prepay returns a Razorpay order id to hand to checkout).
 */
export function BookingPage() {
  const [unitId, setUnitId] = useState('');
  const [date, setDate] = useState('2026-06-20');
  const [slots, setSlots] = useState<ResolvedSlot[]>([]);
  const [venueId, setVenueId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setMessage(null);
    setSelected(new Set());
    try {
      const res = await api.availability(unitId, date);
      setSlots(res.slots);
      setVenueId(res.venueId);
    } catch (e) {
      setMessage((e as Error).message);
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

  const book = async () => {
    setMessage(null);
    const cart = slots
      .filter((s) => selected.has(s.start))
      .map((s) => ({ unitId: s.unitId, start: s.start, end: s.end }));
    try {
      const res = await api.createBooking({
        venueId,
        slots: cart,
        payMode: PayMode.AT_VENUE,
        customer: { name: 'Walk-in Player', mobile: '+919812345678', consent: true },
      });
      setMessage(`Booking ${res.id} — ${res.status} (₹${res.total})`);
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  return (
    <div className="container">
      <div className="card">
        <h2>Find & book a court</h2>
        <label>Court (unit) id</label>
        <input
          value={unitId}
          onChange={(e) => setUnitId(e.target.value)}
          placeholder="paste a unit id from seed data"
        />
        <label>Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button onClick={load} disabled={!unitId}>
          Load availability
        </button>
      </div>

      {slots.length > 0 && (
        <div className="card">
          <h3>{date} — resolved per-court pricing</h3>
          <div className="slot-grid">
            {slots.map((s) => {
              const cls = selected.has(s.start)
                ? 'slot selected'
                : `slot ${s.status}`;
              return (
                <div key={s.start} className={cls} onClick={() => toggle(s)}>
                  <div>{new Date(s.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  <strong>{s.status === SlotStatus.OPEN ? `₹${s.price}` : s.status}</strong>
                </div>
              );
            })}
          </div>
          <p>
            Selected: {selected.size} slot(s) — <strong>₹{total}</strong>
          </p>
          <button className="accent" onClick={book} disabled={selected.size === 0}>
            Book (pay at venue)
          </button>
        </div>
      )}

      {message && (
        <div className="card">
          <p>{message}</p>
        </div>
      )}
    </div>
  );
}
