---
name: apps/web dashboard chart
description: Why the owner dashboard chart is custom SVG instead of a chart library.
---

# apps/web owner dashboard chart

- The single bar chart on the owner dashboard is a hand-rolled SVG component
  (`apps/web/src/components/BarChart.tsx`), not a charting library.
- **Why:** recharts was the app's only heavy dependency (~714 kB / ~208 kB gzip)
  and tripped Vite's 500 kB chunk-size warning even when isolated to its own
  lazy chunk. recharts pulls in d3 internally, so importing submodules doesn't
  meaningfully shrink it. Replacing it with SVG removed the chunk entirely.
- **How to apply:** if a new chart is needed, extend the SVG component or pick a
  genuinely tiny lib — do NOT re-introduce recharts/d3-based libraries without
  weighing the bundle cost. The chart styling reads theme CSS vars
  (--primary, --border, --muted-foreground, --popover) to stay on-brand.
