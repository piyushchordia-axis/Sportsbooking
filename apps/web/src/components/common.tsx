import { ReactNode, useCallback, useEffect, useState } from 'react';

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
