import { api } from '../../api/client';
import { Card, Msg, useLoad } from '../../components/common';

/** Super Admin: platform-wide aggregate (PRD §3.3). */
export function PlatformPage() {
  const { data, error } = useLoad(() => api.platformReport());
  const stat = (label: string, value: string | number) => (
    <div className="slot" key={label}>
      <div style={{ fontSize: 12, color: '#64748b' }}>{label}</div>
      <strong style={{ fontSize: 22 }}>{value}</strong>
    </div>
  );
  return (
    <div className="container">
      <Card title="Platform overview">
        <Msg text={error} />
        {data && (
          <div className="slot-grid">
            {stat('Owners', data.owners)}
            {stat('Venues', data.venues)}
            {stat('Bookings', data.bookings)}
            {stat('Gross revenue', `₹${data.grossRevenue}`)}
          </div>
        )}
      </Card>
    </div>
  );
}
