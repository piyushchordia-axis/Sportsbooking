---
name: apps/web Sportline theming
description: How the Tailwind v4 white-label theme + design tokens are wired in apps/web, and the cascade pitfalls to avoid.
---

# apps/web Sportline theming (Tailwind v4)

The web app uses a dark "Sportline" design system built on Tailwind v4 with CSS-variable design tokens. A few non-obvious decisions that future changes must respect:

- **White-label branding writes to SOURCE vars, not generated `--color-*`.** `ThemeProvider` sets `--primary` / `--secondary` / `--accent` (and `--ring`) on `:root`. Tailwind's `@theme inline` block maps `--color-primary: var(--primary)` etc. Writing to `--color-*` directly instead would collide with the token mapping and break theming. **Why:** owners re-theme at runtime via branding; the indirection lets utilities (`bg-primary`) re-theme without code changes.
- **Foregrounds are contrast-computed.** Owner brand colours are arbitrary, so `ThemeProvider` derives `--primary/secondary/accent-foreground` from WCAG luminance (threshold ~0.4 → dark ink `#070b14` else near-white `#f2f6fc`). Don't hardcode a single foreground or dark-on-dark text appears for dark brand colours.
- **`.container` is defined UNLAYERED at the bottom of `styles.css`.** This is intentional: unlayered CSS beats `@layer` rules, so it overrides Tailwind v4's built-in `.container` utility. Pages rely on `className="container"` for the centered max-w-[80rem] page width.
- **Raw elements (button/table/details/summary) are styled in `@layer base`** with `:not([class*='bg-']):not([class*='text-'])` guards so any utility class on an element still wins. This keeps un-restyled CRUD pages coherent without per-element classes.
- Shared helpers in `components/common.tsx` (`Card/Field/Select/Msg/useLoad` + `Stat/PageHeader`) keep their original signatures — they cascade to most form pages, so changing a signature ripples widely.
- Fonts: Rajdhani (`.font-display`/headings/KPIs), DM Sans (body), DM Mono (`font-mono`, numeric/labels).

## Dark/light MODE (separate from white-label branding)

- `:root` holds the LIGHT neutral tokens (default); a `.dark` block overrides ONLY neutral surface tokens (`--background/--card/--popover/--muted/--muted-foreground/--border/--border-faint/--row-hover/--input-background` + text). Brand tokens (`--primary/--secondary/--accent` + their `-foreground`s + `--ring`) are mode-independent — set at runtime by ThemeProvider — and must NEVER go in `.dark`. **Why:** the toggle flips only neutral surfaces; owner brand stays identical in both modes.
- Mode is applied by adding/removing `.dark` on `<html>`. ThemeProvider keeps React state in sync (`mode/setMode/toggleMode`) and persists to `localStorage('sportline-theme')`. First-paint flash is prevented by an inline `<head>` bootstrap script in `index.html` that sets the class before CSS loads (saved pref → `prefers-color-scheme` → dark). The two must stay in sync (same storage key + class names).
- `--secondary` (default `#162038`) is a DARK brand colour reused as a SURFACE (chips, tabs, inactive buttons). In LIGHT mode those stay dark-navy pills on a light page — intentional, brand-consistent. Text on `bg-secondary` MUST be `text-secondary-foreground` (contrast-computed near-white), never neutral `text-muted-foreground`/`text-foreground`, or it becomes unreadable / mode-dependent in light. Exception: when `bg-secondary` is hover-only (e.g. Layout nav), resting text sits on the neutral header so `text-muted-foreground` at rest is correct.
- No `dark:` Tailwind variants are used anywhere; appearance comes purely from token values, so changing a token cascades everywhere. SVG/inline styles that assumed a dark bg (hardcoded `rgba(255,255,255,…)`) must use mode-aware vars (`--border-faint`, `--row-hover`).
