import { api } from '../../api/client';
import { Card, Msg, useLoad } from '../../components/common';

/** Owner dashboard — consolidated reports (PRD §4.11). */
export function DashboardPage() {
  const { data, error } = useLoad(() => api.ownerReport());

  const stat = (label: string, value: string | number) => (
    <div className="slot" key={label}>
      <div style={{ fontSize: 12, color: '#64748b' }}>{label}</div>
      <strong style={{ fontSize: 20 }}>{value}</strong>
    </div>
  );

  return (
    <div className="container">
      <Card title="Dashboard">
        <Msg text={error} />
        {data && (
          <div className="slot-grid">
            {stat('Revenue (paid)', `₹${data.revenue}`)}
            {stat('Bookings', data.bookings.total)}
            {stat('Cancelled', data.bookings.cancelled)}
            {stat('Booked slots', data.bookedSlots)}
            {stat('Packs sold', data.membership.packsSold)}
            {stat('Outstanding sessions', data.membership.outstandingSessions)}
            {stat('Add-on revenue', `₹${data.addonRevenue}`)}
            {stat('Players (CRM)', data.players)}
          </div>
        )}
      </Card>

      {data && data.perVenue.length > 0 && (
        <Card title="Per-venue revenue">
          <table style={{ width: '100%', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748b' }}>
                <th>Venue</th><th>Revenue</th><th>Bookings</th>
              </tr>
            </thead>
            <tbody>
              {data.perVenue.map((v) => (
                <tr key={v.venueId}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{v.venueId}</td>
                  <td>₹{v.revenue}</td>
                  <td>{v.bookings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
