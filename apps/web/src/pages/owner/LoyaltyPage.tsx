import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { api, type LoyaltyConfig, type LoyaltyHistoryItem } from '../../api/client';
import {
  Card,
  EmptyState,
  Msg,
  PageHeader,
  SectionLabel,
  useLoad,
} from '../../components/common';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';

/** Label + tone + amount-unit for each history ledger type. */
const TYPE_META: Record<
  string,
  { label: string; cls: string; unit: 'pts' | 'inr' }
> = {
  points_earn: { label: 'Earned', cls: 'bg-primary/15 text-primary', unit: 'pts' },
  points_redeem: {
    label: 'Redeemed',
    cls: 'bg-amber-500/15 text-amber-400',
    unit: 'pts',
  },
  referral_reward: {
    label: 'Referral',
    cls: 'bg-blue-500/15 text-blue-400',
    unit: 'inr',
  },
};

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** A labelled number input for the config form. */
function NumField({
  label,
  hint,
  value,
  onChange,
  step,
  prefix,
  suffix,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute inset-y-0 left-0 grid w-9 place-items-center text-muted-foreground">
            {prefix}
          </span>
        )}
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={step ?? '1'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`h-10 w-full rounded-xl border border-border bg-input-background py-1 text-sm text-foreground outline-none transition-[color,box-shadow] focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 ${prefix ? 'pl-9' : 'pl-3.5'} ${suffix ? 'pr-12' : 'pr-3.5'}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/**
 * Owner: LOYALTY & REFERRALS — the per-owner default earn rate, point value and
 * referral reward, plus a read-only points/referral activity history. (Venues
 * can override the loyalty rates in their own settings.)
 */
export function LoyaltyPage() {
  const config = useLoad<LoyaltyConfig>(() => api.getLoyaltyConfig(), []);
  const history = useLoad<LoyaltyHistoryItem[]>(() => api.loyaltyHistory(50), []);

  // Form mirrors config; earn rate is shown as "points per ₹100" (rate × 100).
  const [perHundred, setPerHundred] = useState('');
  const [pointValue, setPointValue] = useState('');
  const [referral, setReferral] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!config.data) return;
    setPerHundred(String(config.data.loyaltyEarnRate * 100));
    setPointValue(String(config.data.loyaltyRedeemValue));
    setReferral(String(config.data.referralReward));
  }, [config.data]);

  const save = async () => {
    const earn = Number(perHundred) / 100;
    const value = Number(pointValue);
    const reward = Number(referral);
    if (
      [earn, value, reward].some((n) => !Number.isFinite(n) || n < 0) ||
      earn > 1
    ) {
      setMsg('Enter valid non-negative numbers (earn rate ≤ 100 per ₹100).');
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await api.updateLoyaltyConfig({
        loyaltyEarnRate: earn,
        loyaltyRedeemValue: value,
        referralReward: reward,
      });
      setMsg('Loyalty settings saved.');
      config.reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const rows = history.data ?? [];

  return (
    <div className="container">
      <PageHeader
        title="Loyalty & referrals"
        subtitle="Set how players earn and spend points, and what a referral is worth."
      />

      <Msg text={msg} />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Card title="Programme settings" topAccent="primary">
            {config.loading && !config.data ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <div className="space-y-4">
                <NumField
                  label="Earn rate"
                  hint="Points a player earns per ₹100 spent."
                  value={perHundred}
                  onChange={setPerHundred}
                  step="0.5"
                  suffix="/ ₹100"
                />
                <NumField
                  label="Point value"
                  hint="₹ value of 1 point when redeemed."
                  value={pointValue}
                  onChange={setPointValue}
                  step="0.5"
                  prefix="₹"
                />
                <NumField
                  label="Referral reward"
                  hint="₹ credited to the referrer on a successful referral."
                  value={referral}
                  onChange={setReferral}
                  step="10"
                  prefix="₹"
                />
                <Button onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save settings'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  These are your defaults — a venue can override the earn rate and
                  point value in its own settings.
                </p>
              </div>
            )}
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Card title="Activity" subtitle="Recent points and referral rewards" topAccent="accent">
            <SectionLabel icon={History} className="mb-2">
              Latest activity
            </SectionLabel>
            {history.loading && rows.length === 0 ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : history.error ? (
              <Msg text={history.error} />
            ) : rows.length === 0 ? (
              <EmptyState
                title="No activity yet"
                hint="Points earned and redeemed, and referral rewards, will show up here."
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">When</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="pr-4 text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const meta = TYPE_META[r.type] ?? {
                        label: r.type,
                        cls: 'bg-muted text-muted-foreground',
                        unit: 'pts' as const,
                      };
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="pl-4 whitespace-nowrap text-sm text-muted-foreground">
                            {fmtWhen(r.createdAt)}
                          </TableCell>
                          <TableCell>
                            <span
                              className={
                                'inline-block rounded-md px-2 py-0.5 text-xs font-medium ' +
                                meta.cls
                              }
                            >
                              {meta.label}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.customerName ?? '—'}
                          </TableCell>
                          <TableCell className="pr-4 text-right tabular-nums text-sm">
                            {meta.unit === 'inr'
                              ? `₹${r.amount}`
                              : `${r.amount} pts`}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
