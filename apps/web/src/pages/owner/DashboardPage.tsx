import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../api/client';
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
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="name"
                      stroke="var(--muted-foreground)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: 'var(--border)' }}
                    />
                    <YAxis
                      stroke="var(--muted-foreground)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                      contentStyle={{
                        background: 'var(--popover)',
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        color: 'var(--popover-foreground)',
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="revenue" fill="var(--primary)" radius={[6, 6, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ResponsiveContainer>
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
