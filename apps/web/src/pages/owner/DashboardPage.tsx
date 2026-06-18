import { api } from '../../api/client';
import { BarChart } from '../../components/BarChart';
import { Card, Msg, PageHeader, Stat, useLoad } from '../../components/common';

/** Owner dashboard — consolidated reports (PRD §4.11). */
export function DashboardPage() {
  const { data, error } = useLoad(() => api.ownerReport());

  const chartData =
    data?.perVenue.map((v) => ({
      name: v.venueId.slice(0, 6),
      revenue: v.revenue,
      bookings: v.bookings,
    })) ?? [];

  return (
    <div className="container">
      <PageHeader title="Dashboard" subtitle="Consolidated performance across your venues" />
      <Msg text={error} />

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Stat label="Revenue (paid)" value={`₹${data.revenue}`} accent="primary" />
            <Stat label="Bookings" value={data.bookings.total} accent="blue" />
            <Stat label="Cancelled" value={data.bookings.cancelled} accent="destructive" />
            <Stat label="Booked slots" value={data.bookedSlots} accent="accent" />
            <Stat label="Packs sold" value={data.membership.packsSold} accent="purple" />
            <Stat
              label="Outstanding sessions"
              value={data.membership.outstandingSessions}
              accent="accent"
            />
            <Stat label="Add-on revenue" value={`₹${data.addonRevenue}`} accent="primary" />
            <Stat label="Players (CRM)" value={data.players} accent="blue" />
          </div>

          {chartData.length > 0 && (
            <Card title="Revenue by venue">
              <div className="h-72 w-full">
                <BarChart data={chartData} />
              </div>
            </Card>
          )}

          {data.perVenue.length > 0 && (
            <Card title="Per-venue revenue">
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Venue</th>
                      <th>Revenue</th>
                      <th>Bookings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perVenue.map((v) => (
                      <tr key={v.venueId}>
                        <td className="font-mono text-xs text-muted-foreground">{v.venueId}</td>
                        <td className="font-mono">₹{v.revenue}</td>
                        <td className="font-mono">{v.bookings}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
