import { useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  CalendarCheck,
  Clock,
  Download,
  Gauge,
  IndianRupee,
  LayoutGrid,
  Layers,
  PackageCheck,
  Repeat,
  Tag,
  Timer,
  TrendingUp,
  Trophy,
  Users,
  XCircle,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart as ReBarChart,
  CartesianGrid,
  LabelList,
  XAxis,
  YAxis,
} from 'recharts';
import { api, type OwnerReport } from '../../api/client';
import { Card, EmptyState, Msg, PageHeader, SectionLabel, useLoad } from '../../components/common';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import {
  DateRangePicker,
  type DateRangeValue,
} from '../../components/ui/date-range-picker';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '../../components/ui/chart';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';

const ACCENT: Record<string, string> = {
  primary: 'var(--primary)',
  emerald: 'var(--rail-emerald)',
  accent: 'var(--accent)',
  orange: 'var(--rail-orange)',
  blue: 'var(--rail-blue)',
  purple: 'var(--rail-purple)',
  pink: 'var(--rail-pink)',
  destructive: 'var(--destructive)',
};

const revenueChartConfig = {
  revenue: { label: 'Revenue', color: 'var(--chart-1)' },
} satisfies ChartConfig;

const hourChartConfig = {
  count: { label: 'Bookings', color: 'var(--chart-2)' },
} satisfies ChartConfig;

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** ISO date string (YYYY-MM-DD) ⇄ Date helpers for the shared range picker. */
function toIso(d?: Date): string {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fromIso(s: string): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

/** Build a CSV string from the loaded report and trigger a client-side download. */
function exportCsv(data: OwnerReport, from: string, to: string) {
  const rows: (string | number)[][] = [];
  const win = `${from || 'all'} to ${to || 'now'}`;
  rows.push(['Metric', 'Value']);
  rows.push(['Date range', win]);
  rows.push(['Revenue (paid)', data.revenue]);
  rows.push(['Add-on revenue', data.addonRevenue]);
  rows.push(['Total bookings', data.bookings.total]);
  rows.push(['Cancelled bookings', data.bookings.cancelled]);
  rows.push(['Booked slots', data.bookedSlots]);
  rows.push(['Occupancy %', data.occupancyPct ?? '']);
  rows.push(['Peak hour', data.peakHour ?? '']);
  rows.push(['Repeat rate %', data.repeatRatePct ?? '']);
  rows.push(['Packs sold', data.membership.packsSold]);
  rows.push(['Outstanding sessions', data.membership.outstandingSessions]);
  rows.push(['Players (CRM)', data.players]);
  rows.push(['Loyalty earned', data.loyalty?.earned ?? '']);
  rows.push(['Loyalty redeemed', data.loyalty?.redeemed ?? '']);
  rows.push(['Offer redemptions', data.offers?.redemptions ?? '']);
  rows.push(['Offer discount total', data.offers?.discountTotal ?? '']);
  rows.push(['Tournament count', data.tournaments?.count ?? '']);
  rows.push(['Tournament fee revenue', data.tournaments?.feeRevenue ?? '']);
  rows.push([]);
  rows.push(['Ground', 'Revenue', 'Bookings']);
  for (const v of data.perVenue) {
    rows.push([v.venueName ?? v.venueId, v.revenue, v.bookings]);
  }

  const esc = (cell: string | number) => {
    const s = String(cell);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `owner-report-${from || 'all'}-${to || 'now'}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Headline metric — the two figures the owner checks first. Big, with depth. */
function HeroMetric({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon: typeof IndianRupee;
  accent: keyof typeof ACCENT;
}) {
  const color = ACCENT[accent];
  return (
    <div className="flex items-center gap-4">
      <span
        className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl ring-1 ring-inset"
        style={{
          backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
          color,
          // @ts-expect-error CSS custom prop is valid here
          '--tw-ring-color': `color-mix(in srgb, ${color} 30%, transparent)`,
        }}
      >
        <Icon className="h-6 w-6" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 font-display text-4xl font-bold leading-none tracking-tight text-foreground">
          {value}
        </p>
      </div>
    </div>
  );
}

/** Secondary KPI tile — elevated surface, icon chip, optional sub-line. */
function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: typeof IndianRupee;
  accent: keyof typeof ACCENT;
}) {
  const color = ACCENT[accent];
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-primary/12 dark:border-primary/16 bg-elevated p-4 shadow-card transition-shadow sm:p-5">
      <span
        className="absolute inset-x-0 top-0 h-0.5 opacity-70"
        style={{ backgroundColor: color }}
      />
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-xl"
          style={{
            backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
            color,
          }}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 font-display text-3xl font-bold leading-none tracking-tight text-foreground">
        {value}
      </p>
      {sub && <p className="mt-1.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Skeleton stand-in for the KPI grid while the report loads. */
function KpiSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-primary/12 dark:border-primary/16 bg-elevated p-5 shadow-card">
          <div className="flex items-start justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-8 rounded-xl" />
          </div>
          <Skeleton className="mt-4 h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

/** Owner dashboard — consolidated reports (PRD §4.11). */
export function DashboardPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data, error, loading } = useLoad(
    () => api.ownerReport(from || undefined, to || undefined),
    [from, to],
  );

  const range: DateRangeValue = { from: fromIso(from), to: fromIso(to) };
  const hasRange = Boolean(from || to);

  const onRangeChange = (v: DateRangeValue) => {
    setFrom(toIso(v.from));
    setTo(toIso(v.to));
  };

  const chartData =
    data?.perVenue.map((v) => ({
      name: v.venueName ?? v.venueId.slice(0, 6),
      revenue: v.revenue,
      bookings: v.bookings,
    })) ?? [];

  const histData =
    data?.hourHistogram?.map((h) => ({ hour: h.hour, count: h.count })) ?? [];

  // Top three grounds by revenue — drives the compact "where money comes from" list.
  const topGrounds = useMemo(
    () =>
      [...(data?.perVenue ?? [])]
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5),
    [data],
  );
  const maxVenueRevenue = topGrounds.reduce((m, v) => Math.max(m, v.revenue), 0);

  return (
    <div className="container">
      <PageHeader
        title="Dashboard"
        subtitle="See how your turf grounds are performing across revenue, bookings, and players."
        badge={
          <Badge variant="outline" className="font-mono">
            {hasRange ? `${from || '…'} → ${to || 'now'}` : 'All time'}
          </Badge>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker
              value={range}
              onChange={onRangeChange}
              placeholder="All time"
              align="end"
              className="w-[15rem]"
            />
            {hasRange && (
              <Button
                variant="ghost"
                onClick={() => {
                  setFrom('');
                  setTo('');
                }}
              >
                Reset
              </Button>
            )}
            <Button
              variant="outline"
              disabled={!data}
              onClick={() => data && exportCsv(data, from, to)}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
          </div>
        }
      />
      <Msg text={error} />

      {/* Loading: hero + KPI skeletons keep the layout stable. */}
      {loading && !data && (
        <div className="space-y-4">
          <Card className="bg-card">
            <div className="flex flex-wrap gap-10">
              <Skeleton className="h-14 w-48" />
              <Skeleton className="h-14 w-48" />
            </div>
          </Card>
          <KpiSkeleton count={8} />
        </div>
      )}

      {!loading && !error && !data && (
        <Card className="bg-card">
          <EmptyState
            title="No report yet"
            hint="Once bookings start coming in, your revenue and activity will show up here."
          />
        </Card>
      )}

      {data && (
        <div className="space-y-8">
          {/* Hero band — the two headline figures, with supporting context. */}
          <Card topAccent="primary" className="bg-card">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <SectionLabel icon={BarChart3}>Owner overview</SectionLabel>
                <h2 className="mt-2.5 font-display text-2xl font-bold tracking-tight text-foreground">
                  Welcome back
                </h2>
                <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
                  A consolidated snapshot of revenue, bookings, and player activity across all your
                  turf grounds.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-8 sm:gap-12">
                <HeroMetric
                  label="Revenue (paid)"
                  value={inr(data.revenue)}
                  icon={IndianRupee}
                  accent="primary"
                />
                <HeroMetric
                  label="Occupancy"
                  value={data.occupancyPct != null ? `${data.occupancyPct}%` : '—'}
                  icon={Gauge}
                  accent="blue"
                />
              </div>
            </div>
          </Card>

          {/* Primary KPIs */}
          <section>
            <SectionLabel icon={LayoutGrid} className="mb-3">
              At a glance
            </SectionLabel>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiTile
                label="Bookings"
                value={data.bookings.total}
                sub={`${data.bookings.cancelled} cancelled`}
                accent="blue"
                icon={CalendarCheck}
              />
              <KpiTile
                label="Cancelled"
                value={data.bookings.cancelled}
                accent="destructive"
                icon={XCircle}
              />
              <KpiTile
                label="Booked slots"
                value={data.bookedSlots}
                accent="accent"
                icon={LayoutGrid}
              />
              <KpiTile
                label="Add-on revenue"
                value={inr(data.addonRevenue)}
                accent="emerald"
                icon={Layers}
              />
              <KpiTile
                label="Packs sold"
                value={data.membership.packsSold}
                accent="purple"
                icon={PackageCheck}
              />
              <KpiTile
                label="Outstanding sessions"
                value={data.membership.outstandingSessions}
                sub="Unused pack credits"
                accent="orange"
                icon={Timer}
              />
              <KpiTile
                label="Players (CRM)"
                value={data.players}
                accent="pink"
                icon={Users}
              />
              <KpiTile
                label="Peak hour"
                value={data.peakHour ?? '—'}
                sub="Busiest time of day"
                accent="orange"
                icon={Clock}
              />
            </div>
          </section>

          {/* Charts — revenue by ground + daily booking rhythm, side by side. */}
          <section className="grid gap-4 xl:grid-cols-2">
            {chartData.length > 0 ? (
              <Card
                title="Revenue by ground"
                subtitle="Paid revenue per ground over the selected range"
                className="bg-card"
              >
                <ChartContainer config={revenueChartConfig} className="aspect-auto h-72 w-full">
                  <ReBarChart
                    accessibilityLayer
                    data={chartData}
                    margin={{ top: 20, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      tickFormatter={(v) => `₹${v}`}
                    />
                    <ChartTooltip
                      cursor={false}
                      content={
                        <ChartTooltipContent
                          formatter={(value, name) => (
                            <div className="flex w-full items-center justify-between gap-3">
                              <span className="text-muted-foreground">
                                {revenueChartConfig[name as keyof typeof revenueChartConfig]
                                  ?.label ?? name}
                              </span>
                              <span className="font-mono font-medium text-foreground tabular-nums">
                                {inr(Number(value))}
                              </span>
                            </div>
                          )}
                        />
                      }
                    />
                    <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[6, 6, 0, 0]}>
                      <LabelList
                        dataKey="revenue"
                        position="top"
                        offset={8}
                        className="fill-muted-foreground"
                        fontSize={11}
                        formatter={(v: number) => `₹${v}`}
                      />
                    </Bar>
                  </ReBarChart>
                </ChartContainer>
              </Card>
            ) : (
              <Card title="Revenue by ground" className="bg-card">
                <EmptyState
                  title="No revenue yet"
                  hint="Revenue will appear here once paid bookings are recorded for your grounds."
                />
              </Card>
            )}

            {histData.length > 0 ? (
              <Card
                title="Booking rhythm"
                subtitle="How bookings spread across the hours of the day"
                className="bg-card"
              >
                <ChartContainer config={hourChartConfig} className="aspect-auto h-72 w-full">
                  <AreaChart
                    accessibilityLayer
                    data={histData}
                    margin={{ top: 12, right: 8, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="fillBookings" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-count)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--color-count)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="hour"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      interval={2}
                    />
                    <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="var(--color-count)"
                      strokeWidth={2}
                      fill="url(#fillBookings)"
                    />
                  </AreaChart>
                </ChartContainer>
              </Card>
            ) : (
              <Card title="Booking rhythm" className="bg-card">
                <EmptyState
                  title="No bookings to chart"
                  hint="Once players start booking slots, you'll see the busiest hours here."
                />
              </Card>
            )}
          </section>

          {/* Engagement metrics — loyalty, offers, tournaments, repeat play. */}
          <section>
            <SectionLabel icon={TrendingUp} className="mb-3">
              Performance & engagement
            </SectionLabel>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiTile
                label="Repeat rate"
                value={data.repeatRatePct != null ? `${data.repeatRatePct}%` : '—'}
                sub="Customers who book again"
                accent="pink"
                icon={Repeat}
              />
              <KpiTile
                label="Loyalty points"
                value={`${data.loyalty?.earned ?? 0} / ${data.loyalty?.redeemed ?? 0}`}
                sub="Earned / redeemed"
                accent="purple"
                icon={Award}
              />
              <KpiTile
                label="Offer redemptions"
                value={data.offers?.redemptions ?? 0}
                sub={
                  data.offers?.discountTotal != null
                    ? `${inr(data.offers.discountTotal)} discounted`
                    : undefined
                }
                accent="emerald"
                icon={Tag}
              />
              <KpiTile
                label="Tournament revenue"
                value={inr(data.tournaments?.feeRevenue ?? 0)}
                sub={
                  data.tournaments?.count != null
                    ? `${data.tournaments.count} tournaments`
                    : undefined
                }
                accent="accent"
                icon={Trophy}
              />
            </div>
          </section>

          {/* Per-ground breakdown — top earners highlighted, full table below. */}
          {data.perVenue.length > 0 && (
            <section className="grid gap-4 xl:grid-cols-5">
              <Card
                title="Top grounds"
                subtitle="Your highest-earning grounds"
                className="bg-card xl:col-span-2"
              >
                <ul className="space-y-3">
                  {topGrounds.map((v, i) => (
                    <li key={v.venueId} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted font-mono text-[11px] text-muted-foreground">
                            {i + 1}
                          </span>
                          <span className="truncate text-foreground">
                            {v.venueName ?? (
                              <span className="font-mono text-xs text-muted-foreground">
                                {v.venueId.slice(0, 8)}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono font-medium text-primary tabular-nums">
                          {inr(v.revenue)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-primary/70"
                          style={{
                            width: `${
                              maxVenueRevenue > 0 ? (v.revenue / maxVenueRevenue) * 100 : 0
                            }%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card
                title="Per-ground revenue"
                subtitle="Full breakdown of revenue and bookings by ground"
                className="bg-card xl:col-span-3"
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ground</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Bookings</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.perVenue.map((v) => (
                      <TableRow key={v.venueId}>
                        <TableCell className="text-foreground">
                          {v.venueName ?? (
                            <span className="font-mono text-xs text-muted-foreground">
                              {v.venueId}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-primary tabular-nums">
                          {inr(v.revenue)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {v.bookings}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
