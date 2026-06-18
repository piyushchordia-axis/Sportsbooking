import {
  BookingResponse,
  PaymentStatus,
  PayMode,
  ResolvedSlot,
  SlotStatus,
} from '@sportsbooking/shared';
import { useEffect, useState } from 'react';
import { api, OwnerVenue } from '../../api/client';
import { Field, Msg, PageHeader, Select } from '../../components/common';

const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * Owner/staff offline booking — create a booking on behalf of a phone/walk-in
 * customer (PRD §6.1). Reuses the public availability + booking endpoints; the
 * owner JWT + customer payload attributes the booking and captures them in CRM.
 */
export function NewBookingPage() {
  const [venues, setVenues] = useState<OwnerVenue[]>([]);
  const [venueId, setVenueId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [slots, setSlots] = useState<ResolvedSlot[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [consent, setConsent] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [booking, setBooking] = useState<BookingResponse | null>(null);

  useEffect(() => {
    api
      .listVenues()
      .then((vs) => {
        const list = vs as OwnerVenue[];
        setVenues(list);
        if (list[0]) {
          setVenueId(list[0].id);
          setUnitId(list[0].units[0]?.id ?? '');
        }
      })
      .catch((e) => setMsg((e as Error).message));
  }, []);

  const venue = venues.find((v) => v.id === venueId) ?? null;
  const units = venue?.units ?? [];

  const pickVenue = (id: string) => {
    setVenueId(id);
    setUnitId(venues.find((v) => v.id === id)?.units[0]?.id ?? '');
    setSlots([]);
    setSelected(new Set());
  };

  const load = async () => {
    setMsg(null);
    setBooking(null);
    setSelected(new Set());
    if (!unitId) return;
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
    if (!name.trim() || !mobile.trim()) {
      setMsg('Customer name and mobile are required');
      return;
    }
    const cart = slots
      .filter((s) => selected.has(s.start))
      .map((s) => ({ unitId: s.unitId, start: s.start, end: s.end }));
    setBusy(true);
    try {
      const res = await api.createBooking({
        venueId: venue.id,
        slots: cart,
        payMode,
        customer: { name: name.trim(), mobile: mobile.trim(), consent },
      });
      setBooking(res);
      await load();
      setBooking(res);
      setMsg(
        `Booking ${res.id} confirmed for ${name.trim()} — ${res.status} · ₹${res.total} (${res.paymentStatus})`,
      );
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const settle = async () => {
    if (!booking) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.settleBooking(booking.id);
      setBooking({ ...booking, paymentStatus: PaymentStatus.PAID });
      setMsg(`Booking ${booking.id} marked settled — paid at venue`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const awaitingSettlement =
    booking?.payMode === PayMode.AT_VENUE &&
    booking.paymentStatus !== PaymentStatus.PAID &&
    booking.paymentStatus !== PaymentStatus.SETTLED_AT_VENUE;

  return (
    <div className="container">
      <PageHeader
        title="New booking"
        subtitle="Book on behalf of a phone or walk-in customer"
      />

      {venues.length === 0 ? (
        <Msg text={msg ?? 'Loading your venues…'} />
      ) : (
        <>
          <div className="bg-card border border-border rounded-xl p-5 mb-6">
            <Select
              label="Venue"
              value={venueId}
              onChange={pickVenue}
              options={venues.map((v) => ({ value: v.id, label: v.name }))}
            />

            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
              Court / turf
            </p>
            <div className="flex flex-wrap gap-2 mb-4">
              {units.map((u) => {
                const active = unitId === u.id;
                return (
                  <button
                    key={u.id}
                    onClick={() => setUnitId(u.id)}
                    aria-pressed={active}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground/70 hover:text-secondary-foreground'
                    }`}
                  >
                    {u.name} <span className="opacity-70">({u.label})</span>
                  </button>
                );
              })}
              {units.length === 0 && (
                <span className="text-sm text-muted-foreground">
                  This venue has no courts yet — add one under Venues.
                </span>
              )}
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

          {slots.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              {/* Slot grid */}
              <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
                <h3 className="font-display font-semibold text-lg mb-1">{date}</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Tap open slots to add them to the booking
                </p>
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
                    if (isSel)
                      cls = 'border-primary bg-primary/15 ring-1 ring-primary/40 cursor-pointer';
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
                            isSel
                              ? 'text-primary'
                              : isOpen
                                ? 'text-foreground'
                                : 'text-muted-foreground'
                          }`}
                        >
                          {isOpen ? `₹${s.price}` : s.status}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Customer + summary */}
              <div className="bg-card border border-border rounded-xl p-5 lg:sticky lg:top-20">
                <h3 className="font-display font-semibold text-lg mb-4">Customer</h3>
                <Field label="Name" value={name} onChange={setName} placeholder="e.g. Priya Sharma" />
                <Field
                  label="Mobile"
                  value={mobile}
                  onChange={setMobile}
                  placeholder="e.g. 9876543210"
                />
                <label className="flex items-center gap-2 mb-4 text-sm text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  Consents to marketing messages
                </label>

                <div className="flex items-center justify-between border-t border-border pt-4">
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                      {selected.size} slot(s)
                    </p>
                  </div>
                  <span className="font-display font-bold text-2xl">₹{total}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-4">
                  <button
                    onClick={() => book(PayMode.AT_VENUE)}
                    disabled={!selected.size || busy}
                    className="px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-40 hover:bg-primary/90 transition-colors"
                  >
                    Pay at venue
                  </button>
                  <button
                    onClick={() => book(PayMode.PREPAY)}
                    disabled={!selected.size || busy}
                    className="px-4 py-2.5 rounded-lg border border-accent text-accent font-semibold disabled:opacity-40 hover:bg-accent/10 transition-colors"
                  >
                    Prepay
                  </button>
                </div>

                {booking && awaitingSettlement && (
                  <button
                    onClick={settle}
                    disabled={busy}
                    className="w-full mt-3 px-4 py-2.5 rounded-lg bg-accent text-accent-foreground font-semibold disabled:opacity-40 hover:bg-accent/90 transition-colors"
                  >
                    Mark settled (paid on the ground)
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <div className="mt-4">
        <Msg text={msg} />
      </div>
    </div>
  );
}
