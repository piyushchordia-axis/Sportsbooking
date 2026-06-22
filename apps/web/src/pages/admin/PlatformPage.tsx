import {
  BadgePercent,
  Building2,
  CalendarCheck,
  Gauge,
  IndianRupee,
  LayoutGrid,
  Repeat,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../api/client';
import {
  Card,
  Msg,
  PageHeader,
  SectionLabel,
  StatusPill,
  useLoad,
} from '../../components/common';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '../../components/ui/chart';
import {
  DateRangePicker,
  type DateRangeValue,
} from '../../components/ui/date-range-picker';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '../../components/ui/table';
import { type LucideIcon } from 'lucide-react';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const num = (n: number) => n.toLocaleString('en-IN');

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

const ACCENT: Record<string, string> = {
  primary: 'var(--primary)',
  emerald: 'var(--rail-emerald)',
  accent: 'var(--accent)',
  blue: 'var(--rail-blue)',
  purple: 'var(--rail-purple)',
};

/** Hero KPI tile with a coloured top rail, an icon chip and a display figure. */
function Kpi({
  label,
  value,
  sub,
  accent = 'primary',
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: keyof typeof ACCENT;
  icon: LucideIcon;
}) {
  const color = ACCENT[accent];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/12 dark:border-primary/16 bg-card p-5 shadow-card">
      <span
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: color }}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
          style={{
            backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
            color,
          }}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="mt-3 font-display text-3xl font-bold leading-tight text-foreground">
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

const loyaltyConfig = {
  earned: { label: 'Earned', color: 'var(--chart-1)' },
  redeemed: { label: 'Redeemed', color: 'var(--chart-2)' },
} satisfies ChartConfig;

const occupancyConfig = {
  value: { label: 'Occupancy', color: 'var(--chart-1)' },
} satisfies ChartConfig;

/** Super Admin: platform-wide aggregate (PRD §3.3). */
export function PlatformPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data, error } = useLoad(
    () => api.platformReport(from || undefined, to || undefined),
    [from, to],
  );

  const range: DateRangeValue = { from: fromIso(from), to: fromIso(to) };
  const onRangeChange = (v: DateRangeValue) => {
    setFrom(toIso(v.from));
    setTo(toIso(v.to));
  };

  const avgPerBooking =
    data && data.bookings > 0 ? Math.round(data.grossRevenue / data.bookings) : 0;
  const venuesPerOwner =
    data && data.owners > 0 ? (data.venues / data.owners).toFixed(1) : '0';
  const occupancyPct = data?.occupancyPct ?? 0;
  const repeatRatePct = data?.repeatRatePct ?? 0;
  const loyaltyEarned = data?.loyalty?.earned ?? 0;
  const loyaltyRedeemed = data?.loyalty?.redeemed ?? 0;
  const offerRedemptions = data?.offers?.redemptions ?? 0;
  const offerDiscount = data?.offers?.discountTotal ?? 0;

  const occupancyData = [{ name: 'Occupancy', value: occupancyPct }];
  const loyaltyData = [
    { name: 'Earned', value: loyaltyEarned, fill: 'var(--color-earned)' },
    { name: 'Redeemed', value: loyaltyRedeemed, fill: 'var(--color-redeemed)' },
  ];

  return (
    <div className="container">
      <PageHeader
        title="Platform overview"
        subtitle="Aggregate performance across every turf operator"
        badge={<StatusPill status="live">Live</StatusPill>}
        action={
          <div className="w-full sm:w-72">
            <DateRangePicker
              value={range}
              onChange={onRangeChange}
              placeholder="All time"
              align="end"
            />
          </div>
        }
      />
      <Msg text={error} />

      {!data && !error && (
        <div className="space-y-8">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-2xl" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-72 w-full rounded-2xl" />
            <Skeleton className="h-72 w-full rounded-2xl" />
          </div>
          <Skeleton className="h-80 w-full rounded-2xl" />
        </div>
      )}

      {data && (
        <div className="space-y-8">
          {/* Headline KPIs */}
          <section>
            <SectionLabel className="mb-3" icon={TrendingUp}>
              Key metrics
            </SectionLabel>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Kpi
                label="Owners"
                value={num(data.owners)}
                sub={`${venuesPerOwner} grounds each`}
                accent="blue"
                icon={Users}
              />
              <Kpi
                label="Grounds"
                value={num(data.venues)}
                sub="Registered across owners"
                accent="purple"
                icon={Building2}
              />
              <Kpi
                label="Bookings"
                value={num(data.bookings)}
                sub={`${inr(avgPerBooking)} avg value`}
                accent="accent"
                icon={CalendarCheck}
              />
              <Kpi
                label="Gross revenue"
                value={inr(data.grossRevenue)}
                sub="Total collected"
                accent="primary"
                icon={IndianRupee}
              />
            </div>
          </section>

          {/* Visual breakdown */}
          <section>
            <SectionLabel className="mb-3" icon={Sparkles}>
              Engagement
            </SectionLabel>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card
                title="Capacity utilisation"
                subtitle="Booked slots vs. available capacity"
                topAccent="emerald"
              >
                <ChartContainer
                  config={occupancyConfig}
                  className="mx-auto aspect-square h-56"
                >
                  <RadialBarChart
                    data={occupancyData}
                    startAngle={90}
                    endAngle={-270}
                    innerRadius="72%"
                    outerRadius="100%"
                  >
                    <PolarAngleAxis
                      type="number"
                      domain={[0, 100]}
                      tick={false}
                      axisLine={false}
                    />
                    <RadialBar
                      dataKey="value"
                      background={{ fill: 'var(--muted)' }}
                      cornerRadius={12}
                      fill="var(--color-value)"
                    />
                    <text
                      x="50%"
                      y="46%"
                      textAnchor="middle"
                      className="fill-foreground font-display text-4xl font-bold"
                    >
                      {`${occupancyPct}%`}
                    </text>
                    <text
                      x="50%"
                      y="58%"
                      textAnchor="middle"
                      className="fill-muted-foreground text-xs"
                    >
                      occupied
                    </text>
                  </RadialBarChart>
                </ChartContainer>
                <div className="mt-2 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Repeat className="h-4 w-4 text-[var(--rail-blue)]" />
                  <span>
                    {repeatRatePct}% of customers book more than once
                  </span>
                </div>
              </Card>

              <Card
                title="Loyalty & offers"
                subtitle="Points lifecycle and promotional uplift"
                topAccent="purple"
              >
                <ChartContainer
                  config={loyaltyConfig}
                  className="aspect-auto h-44 w-full"
                >
                  <BarChart
                    data={loyaltyData}
                    layout="vertical"
                    margin={{ left: 8, right: 32 }}
                  >
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      width={72}
                    />
                    <XAxis type="number" hide />
                    <ChartTooltip
                      cursor={false}
                      content={<ChartTooltipContent hideLabel />}
                    />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={28}>
                      {loyaltyData.map((d) => (
                        <Cell key={d.name} fill={d.fill} />
                      ))}
                      <LabelList
                        dataKey="value"
                        position="right"
                        className="fill-foreground font-medium"
                        formatter={(v: number) => num(v)}
                      />
                    </Bar>
                  </BarChart>
                </ChartContainer>
                <div className="mt-2 grid grid-cols-2 gap-3 border-t border-border pt-4">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]">
                      <BadgePercent className="h-[18px] w-[18px]" />
                    </span>
                    <div>
                      <p className="font-display text-lg font-bold leading-none text-foreground">
                        {num(offerRedemptions)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Offers redeemed
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-[var(--primary)]">
                      <IndianRupee className="h-[18px] w-[18px]" />
                    </span>
                    <div>
                      <p className="font-display text-lg font-bold leading-none text-foreground">
                        {inr(offerDiscount)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Discounts given
                      </p>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </section>

          {/* Full breakdown */}
          <section>
            <SectionLabel className="mb-3" icon={Gauge}>
              Aggregate breakdown
            </SectionLabel>
            <Card topAccent="blue" className="p-0">
              <Table>
                <TableBody>
                  <Row icon={Users} label="Active owners" value={num(data.owners)} />
                  <Row
                    icon={Building2}
                    label="Registered grounds"
                    value={num(data.venues)}
                  />
                  <Row
                    icon={LayoutGrid}
                    label="Grounds per owner"
                    value={venuesPerOwner}
                  />
                  <Row
                    icon={CalendarCheck}
                    label="Total bookings"
                    value={num(data.bookings)}
                  />
                  <Row
                    icon={IndianRupee}
                    label="Gross revenue"
                    value={inr(data.grossRevenue)}
                  />
                  <Row
                    icon={TrendingUp}
                    label="Avg revenue per booking"
                    value={inr(avgPerBooking)}
                  />
                  <Row
                    icon={Gauge}
                    label="Occupancy"
                    value={`${occupancyPct}%`}
                  />
                  <Row
                    icon={Repeat}
                    label="Repeat-booking rate"
                    value={`${repeatRatePct}%`}
                  />
                  <Row
                    icon={Sparkles}
                    label="Loyalty points earned / redeemed"
                    value={`${num(loyaltyEarned)} / ${num(loyaltyRedeemed)}`}
                  />
                  <Row
                    icon={BadgePercent}
                    label="Offer redemptions"
                    value={num(offerRedemptions)}
                  />
                  <Row
                    icon={BadgePercent}
                    label="Offer discount total"
                    value={inr(offerDiscount)}
                    last
                  />
                </TableBody>
              </Table>
            </Card>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Platform-wide totals across every owner, ground and booking.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  last,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <TableRow className={last ? 'border-0' : undefined}>
      <TableCell className="py-3 pl-5">
        <span className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <Icon className="h-4 w-4 shrink-0 opacity-70" />
          {label}
        </span>
      </TableCell>
      <TableCell className="py-3 pr-5 text-right font-medium tabular-nums text-foreground">
        {value}
      </TableCell>
    </TableRow>
  );
}
