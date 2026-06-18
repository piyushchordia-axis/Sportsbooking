import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface BarDatum {
  name: string;
  revenue: number;
}

const MARGIN = { top: 8, right: 8, bottom: 22, left: 44 };
const MAX_BAR = 48;
const BAR_RADIUS = 6;

/** Generate "nice" rounded axis ticks from 0 up to at least `max`. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const rawStep = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 1e-9; v += step) ticks.push(v);
  return ticks;
}

function formatTick(v: number): string {
  if (v >= 1_000_000) return `${+(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${+(v / 1_000).toFixed(1)}k`;
  return `${v}`;
}

/** Path for a rectangle with rounded top corners only. */
function roundedTopRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

/**
 * Lightweight SVG bar chart — drop-in replacement for the single recharts
 * BarChart on the owner dashboard, with no heavy dependency.
 */
export function BarChart({ data }: { data: BarDatum[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [active, setActive] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (active !== null && active >= data.length) setActive(null);
  }, [data.length, active]);

  const { width, height } = size;
  const plotW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotH = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  const maxValue = data.reduce((m, d) => Math.max(m, d.revenue), 0);
  const ticks = niceTicks(maxValue);
  const domainMax = ticks[ticks.length - 1] || 1;

  const band = data.length > 0 ? plotW / data.length : 0;
  const barWidth = Math.min(MAX_BAR, band * 0.8);
  const yOf = (v: number) => MARGIN.top + plotH - (v / domainMax) * plotH;

  return (
    <div ref={ref} className="relative h-full w-full">
      {width > 0 && height > 0 && (
        <svg width={width} height={height} role="img" aria-label="Revenue by venue">
          {ticks.map((t) => {
            const y = yOf(t);
            return (
              <g key={t}>
                <line
                  x1={MARGIN.left}
                  x2={width - MARGIN.right}
                  y1={y}
                  y2={y}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <text
                  x={MARGIN.left - 8}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="central"
                  fontSize={11}
                  fill="var(--muted-foreground)"
                >
                  {formatTick(t)}
                </text>
              </g>
            );
          })}

          {data.map((d, i) => {
            const bx = MARGIN.left + i * band + (band - barWidth) / 2;
            const by = yOf(d.revenue);
            const bh = MARGIN.top + plotH - by;
            const cx = MARGIN.left + i * band + band / 2;
            return (
              <g
                key={`${d.name}-${i}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive((cur) => (cur === i ? null : cur))}
              >
                <rect
                  x={MARGIN.left + i * band}
                  y={MARGIN.top}
                  width={band}
                  height={plotH}
                  fill={active === i ? 'rgba(255,255,255,0.04)' : 'transparent'}
                />
                <path
                  d={roundedTopRect(bx, by, barWidth, Math.max(0, bh), BAR_RADIUS)}
                  fill="var(--primary)"
                />
                <text
                  x={cx}
                  y={height - MARGIN.bottom + 14}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--muted-foreground)"
                >
                  {d.name}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      {active !== null && data[active] && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full"
          style={{
            left: MARGIN.left + active * band + band / 2,
            top: yOf(data[active].revenue) - 8,
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            color: 'var(--popover-foreground)',
            fontSize: 12,
            padding: '6px 10px',
            whiteSpace: 'nowrap',
          }}
        >
          <div className="font-medium">{data[active].name}</div>
          <div style={{ color: 'var(--primary)' }}>revenue : {data[active].revenue}</div>
        </div>
      )}
    </div>
  );
}
