import { api } from '../../api/client';
import { Msg, PageHeader, Stat, useLoad } from '../../components/common';

/** Super Admin: platform-wide aggregate (PRD §3.3). */
export function PlatformPage() {
  const { data, error } = useLoad(() => api.platformReport());
  return (
    <div className="container">
      <PageHeader title="Platform overview" subtitle="Aggregate metrics across all operators" />
      <Msg text={error} />
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Owners" value={data.owners} accent="blue" />
          <Stat label="Venues" value={data.venues} accent="purple" />
          <Stat label="Bookings" value={data.bookings} accent="accent" />
          <Stat label="Gross revenue" value={`₹${data.grossRevenue}`} accent="primary" />
        </div>
      )}
    </div>
  );
}
