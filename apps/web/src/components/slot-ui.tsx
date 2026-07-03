/**
 * Shared "movie-ticket" slot-picker primitives (PRD §5.2) used by BOTH the
 * consumer ground page (real booking) and the landing teaser, so the two speak
 * one visual language. Pure presentation on Floodlit tokens — it adapts to
 * light mode and any white-label brand colour automatically.
 *
 * Tiers map a slot's real dayType/timeBand onto the venue's price bands:
 *   weekend → "Weekend" · weekday evening → "Peak" · weekday earlier → "Off-peak"
 * Every price shown is the slot's real resolved price.
 */
import { DayType, type ResolvedSlot, SlotStatus, TimeBand } from '@sportsbooking/shared';
import { Check } from 'lucide-react';
import { useMemo } from 'react';
import { flMoney } from '../floodlit/toast';

export type SlotTier = 'offpeak' | 'peak' | 'weekend';

export function slotTier(s: { dayType: DayType; timeBand: TimeBand }): SlotTier {
  if (s.dayType === DayType.WEEKEND) return 'weekend';
  return s.timeBand === TimeBand.EVENING ? 'peak' : 'offpeak';
}

export const TIER_META: Record<SlotTier, { label: string; color: string }> = {
  offpeak: { label: 'Off-peak', color: 'var(--muted)' },
  peak: { label: 'Peak', color: 'var(--amber)' },
  weekend: { label: 'Weekend', color: 'var(--green)' },
};

const TIER_ORDER: SlotTier[] = ['offpeak', 'peak', 'weekend'];

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });

/** Horizontal date rail (BookMyShow style). `days` are YYYY-MM-DD strings. */
export function DateRail({
  days,
  active,
  onSelect,
}: {
  days: string[];
  active: string;
  onSelect: (iso: string) => void;
}) {
  return (
    <div className="fl-scroll flex gap-2 overflow-x-auto pb-1">
      {days.map((iso, i) => {
        const [y, m, d] = iso.split('-').map(Number);
        const js = new Date(y, (m ?? 1) - 1, d ?? 1);
        const on = active === iso;
        const wd = i === 0 ? 'TODAY' : js.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase();
        return (
          <button
            key={iso}
            type="button"
            onClick={() => onSelect(iso)}
            aria-pressed={on}
            className="flex-none rounded-xl px-3 py-2 text-center transition-colors"
            style={{
              minWidth: 56,
              background: on ? 'var(--brand)' : 'transparent',
              border: `1px solid ${on ? 'var(--brand)' : 'var(--line)'}`,
            }}
          >
            <div className="fl-mono text-[11px]" style={{ color: on ? 'var(--on-brand)' : 'var(--faint)' }}>
              {wd}
            </div>
            <div
              className="fl-display text-lg font-bold leading-tight"
              style={{ color: on ? 'var(--on-brand)' : 'var(--chalk)' }}
            >
              {js.getDate()}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** The off-peak / peak / weekend key, priced from the real slots on view. */
export function TierLegend({ slots }: { slots: ResolvedSlot[] }) {
  const byTier = useMemo(() => {
    const m: Partial<Record<SlotTier, number>> = {};
    for (const s of slots) {
      if (s.status !== SlotStatus.OPEN) continue;
      const t = slotTier(s);
      if (m[t] == null || s.price < (m[t] as number)) m[t] = s.price;
    }
    return m;
  }, [slots]);
  const tiers = TIER_ORDER.filter((t) => byTier[t] != null);
  if (tiers.length === 0) return null;
  return (
    <div className="fl-mono flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px]" style={{ color: 'var(--muted)' }}>
      {tiers.map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: TIER_META[t].color }} />
          {TIER_META[t].label} <span style={{ color: 'var(--chalk)' }}>{flMoney(byTier[t] as number)}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * One slot cell. Available = outline + tier-coloured price; Selected = solid
 * brand (teal) fill with a ring + check; Sold = dashed and dimmed (not tappable).
 */
export function SlotCell({
  slot,
  selected,
  onSelect,
}: {
  slot: ResolvedSlot;
  selected: boolean;
  onSelect?: (s: ResolvedSlot) => void;
}) {
  const open = slot.status === SlotStatus.OPEN;
  const time = fmtTime(slot.start);

  if (!open) {
    return (
      <div
        className="flex flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left"
        style={{
          border: '1px dashed var(--line-strong)',
          background: 'color-mix(in oklab, var(--chalk) 4%, transparent)',
          opacity: 0.5,
          cursor: 'not-allowed',
        }}
      >
        <span className="text-[13px] font-medium line-through" style={{ color: 'var(--faint)' }}>
          {time}
        </span>
        <span className="fl-mono text-[12px]" style={{ color: 'var(--faint)' }}>
          Taken
        </span>
      </div>
    );
  }

  const tierColor = TIER_META[slotTier(slot)].color;
  return (
    <button
      type="button"
      onClick={() => onSelect?.(slot)}
      aria-pressed={selected}
      aria-label={`${selected ? 'Remove' : 'Book'} ${time} for ${flMoney(slot.price)}`}
      className={`fl-slot flex flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left${selected ? ' is-sel' : ''}`}
      style={
        selected
          ? {
              background: 'var(--brand)',
              border: '1px solid var(--brand)',
              boxShadow: '0 0 0 3px color-mix(in oklab, var(--brand) 22%, transparent)',
            }
          : { background: 'transparent', border: '1px solid var(--line)' }
      }
    >
      <span
        className="flex items-center gap-1 text-[13px] font-semibold"
        style={{ color: selected ? 'var(--on-brand)' : 'var(--chalk)' }}
      >
        {time}
        {selected && <Check className="h-3 w-3" />}
      </span>
      <span
        className="fl-mono flex items-center gap-1.5 text-[12px]"
        style={{ color: selected ? 'var(--on-brand)' : tierColor }}
      >
        {!selected && <span className="inline-block h-2 w-2 rounded-full" style={{ background: tierColor }} />}
        {flMoney(slot.price)}
      </span>
    </button>
  );
}
