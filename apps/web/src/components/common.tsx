import { ReactNode, useCallback, useEffect, useState } from 'react';
import { EMPTY_GENERIC, initials, sportIcon } from '../lib/imagery';

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-xl p-5 mb-4">
      {title && (
        <h3 className="font-display font-semibold text-lg leading-none mb-4">{title}</h3>
      )}
      {children}
    </section>
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
      <span className="block text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">
        {label}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-9 w-full min-w-0 rounded-lg border border-border bg-input-background px-3 py-1 text-sm text-foreground transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
      />
    </label>
  );
}

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
      <span className="block text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-9 w-full min-w-0 cursor-pointer rounded-lg border border-border bg-input-background px-3 py-1 text-sm text-foreground outline-none transition-[color,box-shadow] focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-card text-foreground">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Msg({ text }: { text: string | null }) {
  if (!text) return null;
  const error = /fail|error|invalid|not |insufficient|reached|closed|full/i.test(text);
  return (
    <p
      className={`mt-2 text-sm font-medium ${error ? 'text-destructive' : 'text-primary'}`}
    >
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
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  accent?: 'primary' | 'accent' | 'blue' | 'purple' | 'destructive';
}) {
  const bar: Record<string, string> = {
    primary: 'bg-primary',
    accent: 'bg-accent',
    blue: 'bg-blue-400',
    purple: 'bg-purple-400',
    destructive: 'bg-destructive',
  };
  return (
    <div className="relative bg-card border border-border rounded-xl p-4 overflow-hidden">
      <span className={`absolute left-0 top-0 h-full w-1 ${bar[accent]}`} />
      <p className="text-muted-foreground text-[10px] font-mono uppercase tracking-widest">
        {label}
      </p>
      <p className="font-display font-bold text-3xl leading-tight mt-1 text-foreground">
        {value}
      </p>
      {sub && <p className="text-muted-foreground text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

/** Section heading used at the top of pages. */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h2 className="font-display font-bold text-2xl leading-none text-foreground">
          {title}
        </h2>
        {subtitle && (
          <p className="text-muted-foreground text-xs font-mono mt-1.5">{subtitle}</p>
        )}
      </div>
      {action}
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
        className={`${className} shrink-0 rounded-lg object-contain bg-secondary/60 p-1`}
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span
      className={`${className} shrink-0 grid place-items-center rounded-lg bg-secondary text-secondary-foreground font-display font-bold text-sm`}
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
