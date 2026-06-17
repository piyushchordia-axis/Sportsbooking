/**
 * Shared themed component library (white-label, PRD §4.10). Components here
 * consume the CSS theme tokens (--color-primary, etc.) set by the web app's
 * ThemeProvider so they re-skin per owner without code changes. Populated as
 * shared widgets emerge across roles; intentionally minimal in Stage 0.
 */
export const THEME_TOKENS = [
  '--color-primary',
  '--color-secondary',
  '--color-accent',
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];
