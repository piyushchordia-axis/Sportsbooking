import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Check, type LucideIcon } from 'lucide-react';
import { EMPTY_GENERIC, initials, sportIcon } from '../lib/imagery';
import { cn } from './ui/utils';
import {
  Select as UISelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

/** Named accent → CSS colour, shared by Card rails, InfoCards and Stat icons. */
export type Accent =
  | 'primary'
  | 'emerald'
  | 'accent'
  | 'orange'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'destructive';

const ACCENT_COLOR: Record<Accent, string> = {
  primary: 'var(--primary)',
  emerald: 'var(--rail-emerald)',
  accent: 'var(--accent)',
  orange: 'var(--rail-orange)',
  blue: 'var(--rail-blue)',
  purple: 'var(--rail-purple)',
  pink: 'var(--rail-pink)',
  destructive: 'var(--destructive)',
};

/** Standard surface card. Optional title/subtitle/action header + top accent rail. */
export function Card({
  title,
  subtitle,
  action,
  topAccent,
  className,
  children,
}: {
  title?: ReactNode;
  subtitle?: string;
  action?: ReactNode;
  topAccent?: Accent;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'relative bg-card border border-primary/12 dark:border-primary/16 rounded-2xl p-5 mb-4 overflow-hidden shadow-card',
        className,
      )}
    >
      {topAccent && (
        <span
          className="absolute inset-x-0 top-0 h-1"
          style={{ backgroundColor: ACCENT_COLOR[topAccent] }}
        />
      )}
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="min-w-0">
            {title && (
              <h3 className="font-display font-semibold text-lg leading-none">{title}</h3>
            )}
            {subtitle && <p className="text-sm text-muted-foreground mt-1.5">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Detail card with an icon header + coloured top rail (Load-Details style). */
export function InfoCard({
  title,
  icon: Icon,
  accent = 'primary',
  action,
  className,
  children,
}: {
  title: ReactNode;
  icon?: LucideIcon;
  accent?: Accent;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const color = ACCENT_COLOR[accent];
  return (
    <section
      className={cn(
        'relative bg-card border border-primary/12 dark:border-primary/16 rounded-2xl overflow-hidden shadow-card',
        className,
      )}
    >
      <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color }} />
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <div className="flex items-center gap-2.5 min-w-0">
          {Icon && (
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
              style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
            >
              <Icon className="h-[18px] w-[18px]" />
            </span>
          )}
          <h3 className="font-display font-semibold text-base leading-tight truncate">{title}</h3>
        </div>
        {action}
      </div>
      <div className="p-5 pt-4">{children}</div>
    </section>
  );
}

/** Label/value row used inside InfoCards and detail panels. */
export function KeyVal({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm font-medium text-right break-words">
        {value === null || value === undefined || value === '' ? '—' : value}
      </span>
    </div>
  );
}

/** Small uppercase section eyebrow (optionally with a leading icon). */
export function SectionLabel({
  icon: Icon,
  children,
  className,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary',
        className,
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </p>
  );
}

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'muted';
const TONE_CLASS: Record<Tone, string> = {
  green: 'text-primary border-primary/30 bg-primary/10',
  amber: 'text-amber-500 border-amber-500/30 bg-amber-500/10',
  red: 'text-destructive border-destructive/30 bg-destructive/10',
  blue: 'text-blue-400 border-blue-400/30 bg-blue-400/10',
  muted: 'text-muted-foreground border-border bg-muted',
};

function toneFor(status: string): Tone {
  const s = status.toLowerCase();
  if (/(approv|active|paid|confirm|settl|live|complet|success|won|joined|earn)/.test(s)) return 'green';
  if (/(pending|post|draft|review|process|request|await|hold|partial)/.test(s)) return 'amber';
  if (/(cancel|fail|reject|suspend|expir|overdue|declin|block|lost|void)/.test(s)) return 'red';
  if (/(book|new|open|route|transit|assigned)/.test(s)) return 'blue';
  return 'muted';
}

/** Pill that colour-codes a status string (approved=green, posted=amber, …). */
export function StatusPill({
  status,
  children,
  className,
}: {
  status: string;
  children?: ReactNode;
  className?: string;
}) {
  const tone = toneFor(status);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize',
        TONE_CLASS[tone],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {children ?? status}
    </span>
  );
}

/** Horizontal step indicator for multi-step wizards (Add-Shipper style). */
export function Stepper({
  steps,
  current,
}: {
  steps: { label: string; icon?: LucideIcon }[];
  current: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const Icon = s.icon;
        return (
          <div
            key={s.label}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'border-primary/40 bg-primary/12 text-primary'
                : done
                  ? 'border-primary/25 text-primary'
                  : 'border-border text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'grid h-5 w-5 place-items-center rounded-full text-[11px]',
                active || done ? 'bg-primary text-primary-foreground' : 'bg-muted',
              )}
            >
              {done ? <Check className="h-3 w-3" /> : Icon ? <Icon className="h-3 w-3" /> : i + 1}
            </span>
            {s.label}
          </div>
        );
      })}
    </div>
  );
}

/** Pill tab bar (Contact / Other Contacts / Commodities). */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { id: T; label: ReactNode; icon?: LucideIcon }[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-xl border border-border bg-muted/50 p-1',
        className,
      )}
    >
      {tabs.map((t) => {
        const Icon = t.icon;
        const on = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              on
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-10 w-full min-w-0 rounded-xl border border-border bg-input-background px-3.5 py-1 text-sm text-foreground transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
      />
    </label>
  );
}

/* Radix Select forbids empty-string item values; map '' ↔ a sentinel so our
   "All …" / unset filters keep working through the shadcn Select. */
const SELECT_EMPTY = '__all__';

export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</span>
      <UISelect
        value={value === '' ? SELECT_EMPTY : value}
        onValueChange={(v) => onChange(v === SELECT_EMPTY ? '' : v)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem
              key={o.value || SELECT_EMPTY}
              value={o.value === '' ? SELECT_EMPTY : o.value}
            >
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </UISelect>
    </label>
  );
}

export function Msg({ text }: { text: string | null }) {
  if (!text) return null;
  const error = /fail|error|invalid|not |insufficient|reached|closed|full/i.test(text);
  return (
    <p className={`mt-2 text-sm font-medium ${error ? 'text-destructive' : 'text-primary'}`}>
      {text}
    </p>
  );
}

/** Compact KPI/stat tile used on dashboards and overview pages. */
export function Stat({
  label,
  value,
  sub,
  accent = 'primary',
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  accent?: Accent;
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-2xl bg-card border border-primary/12 dark:border-primary/16 p-5 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        {Icon && (
          <Icon className="h-4 w-4 shrink-0" style={{ color: ACCENT_COLOR[accent] }} />
        )}
      </div>
      <p className="font-display font-bold text-3xl leading-tight mt-3 text-foreground">{value}</p>
      {sub && <p className="text-muted-foreground text-xs mt-1">{sub}</p>}
    </div>
  );
}

/** Section heading used at the top of pages. */
export function PageHeader({
  title,
  subtitle,
  badge,
  breadcrumb,
  action,
}: {
  title: ReactNode;
  subtitle?: string;
  badge?: ReactNode;
  breadcrumb?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {breadcrumb && <div className="mb-2 text-xs text-muted-foreground">{breadcrumb}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <h1 className="font-display font-bold text-2xl sm:text-3xl leading-none text-foreground">
            {title}
          </h1>
          {badge}
        </div>
        {action}
      </div>
      {subtitle && <p className="text-muted-foreground text-sm mt-2">{subtitle}</p>}
    </div>
  );
}

/** Load data on mount (and on demand) with loading/error state. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    loader()
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => reload(), [reload]);
  return { data, error, loading, reload, setData };
}

/**
 * <img> that swaps to a fallback source once if the primary fails to load, so a
 * missing asset degrades to a branded placeholder instead of a broken image.
 * Renders nothing if the fallback also fails (parent supplies a backdrop).
 */
export function ImageWithFallback({
  src,
  fallback,
  alt = '',
  className,
}: {
  src: string;
  fallback?: string;
  alt?: string;
  className?: string;
}) {
  const [current, setCurrent] = useState(src);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setCurrent(src);
    setFailed(false);
  }, [src]);
  if (failed) return null;
  return (
    <img
      src={current}
      alt={alt}
      loading="lazy"
      className={className}
      onError={() => {
        if (fallback && current !== fallback) setCurrent(fallback);
        else setFailed(true);
      }}
    />
  );
}

/** Recognizable line icon for a sport, resolved from its name (or an explicit
 * stored `iconUrl`) with a graceful fallback to a generic court glyph, then to a
 * sized empty slot if even the generic asset fails (never a broken image). */
export function SportIcon({
  name,
  src,
  className = 'h-5 w-5',
}: {
  name?: string | null;
  src?: string | null;
  className?: string;
}) {
  const resolved = src || sportIcon(name);
  const [current, setCurrent] = useState(resolved);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setCurrent(resolved);
    setFailed(false);
  }, [resolved]);
  if (failed) return <span aria-hidden className={`${className} inline-block`} />;
  return (
    <img
      src={current}
      alt=""
      aria-hidden
      className={className}
      onError={() => {
        const generic = sportIcon(undefined);
        if (current !== generic) setCurrent(generic);
        else setFailed(true);
      }}
    />
  );
}

/** Owner/business logo: the stored logo if present, else an initials monogram. */
export function OwnerLogo({
  name,
  logoUrl,
  className = 'h-9 w-9',
}: {
  name?: string | null;
  logoUrl?: string | null;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (logoUrl && !broken) {
    return (
      <img
        src={logoUrl}
        alt={`${name ?? 'Owner'} logo`}
        className={`${className} shrink-0 rounded-xl object-contain bg-secondary/60 p-1`}
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span
      className={`${className} shrink-0 grid place-items-center rounded-xl bg-primary/15 text-primary font-display font-bold text-sm ring-1 ring-primary/25`}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** Friendly empty-state block: illustration + message, used for empty lists. */
export function EmptyState({
  title,
  hint,
  image = EMPTY_GENERIC,
}: {
  title: string;
  hint?: string;
  image?: string;
}) {
  return (
    <div className="flex flex-col items-center text-center py-10 px-4">
      <ImageWithFallback
        src={image}
        alt=""
        className="h-28 w-28 object-contain opacity-90 mb-4 drop-shadow"
      />
      <p className="font-display font-semibold text-base text-foreground">{title}</p>
      {hint && <p className="text-sm text-muted-foreground mt-1 max-w-sm">{hint}</p>}
    </div>
  );
}
