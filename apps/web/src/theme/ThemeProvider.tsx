import { Branding } from '@sportsbooking/shared';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

/**
 * Token-based white-label theming (PRD §4.10, §7). Branding tokens are written
 * to the Sportline source CSS variables (`--primary` / `--secondary` /
 * `--accent`) which the Tailwind `@theme` mapping consumes, so the whole app
 * re-themes per owner without code changes. Defaults are the Sportline palette,
 * keeping the stadium-night look unless an owner's branding overrides it.
 * Architected subdomain-ready: a future host→owner resolver can hydrate this.
 *
 * Independently of branding, a dark/light MODE flips only the neutral surface
 * tokens (background/card/text/borders/inputs) by toggling the `.dark` class on
 * <html> (see styles.css). The initial class is set by a no-flash bootstrap
 * script in index.html; this provider keeps React state in sync and persists
 * the choice so it survives reloads.
 */
/** Platform-default branding. Exported so the consumer storefront can reset the
 *  theme when leaving an owner's white-label site back to the marketplace. */
export const DEFAULT_BRANDING: Branding = {
  logoUrl: null,
  primaryColor: '#14C8A2',
  secondaryColor: '#17211D',
  accentColor: '#F59E0B',
};

export type ThemeMode = 'dark' | 'light';

/** localStorage key — kept in sync with the bootstrap script in index.html. */
const THEME_STORAGE_KEY = 'sportline-theme';

/**
 * Relative luminance (WCAG) of a hex colour, used to pick a readable foreground
 * so owner branding (which can be any colour) keeps accessible button text.
 */
function luminance(hex: string): number {
  const c = hex.replace('#', '');
  if (c.length !== 6) return 0.5;
  const channel = (h: string) => {
    const v = parseInt(h, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const r = channel(c.slice(0, 2));
  const g = channel(c.slice(2, 4));
  const b = channel(c.slice(4, 6));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Dark ink for light/bright brand colours, near-white for dark ones. */
const foregroundFor = (hex: string) => (luminance(hex) > 0.4 ? '#070b14' : '#f2f6fc');

/**
 * Resolve the initial mode. The bootstrap script in index.html has already
 * applied the correct `.dark` class before first paint, so trust the DOM first;
 * fall back to stored preference, then the OS preference, then dark.
 */
function initialMode(): ThemeMode {
  if (typeof document !== 'undefined') {
    if (document.documentElement.classList.contains('light')) return 'light';
    if (document.documentElement.classList.contains('dark')) return 'dark';
  }
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* localStorage unavailable — fall through */
  }
  if (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  ) {
    return 'light';
  }
  return 'dark';
}

interface ThemeContextValue {
  branding: Branding;
  setBranding: (b: Branding) => void;
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  branding: DEFAULT_BRANDING,
  setBranding: () => undefined,
  mode: 'dark',
  setMode: () => undefined,
  toggleMode: () => undefined,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [mode, setMode] = useState<ThemeMode>(initialMode);

  useEffect(() => {
    const root = document.documentElement;
    const brandVars = [
      '--primary',
      '--primary-foreground',
      '--secondary',
      '--secondary-foreground',
      '--accent',
      '--accent-foreground',
      '--ring',
    ];
    // Default app uses the design-system tokens from styles.css (the exact
    // per-mode Reflex palette). Only a real owner brand overrides them at runtime.
    if (branding === DEFAULT_BRANDING) {
      brandVars.forEach((v) => root.style.removeProperty(v));
      return;
    }
    root.style.setProperty('--primary', branding.primaryColor);
    root.style.setProperty('--primary-foreground', foregroundFor(branding.primaryColor));
    root.style.setProperty('--secondary', branding.secondaryColor);
    root.style.setProperty('--secondary-foreground', foregroundFor(branding.secondaryColor));
    root.style.setProperty('--accent', branding.accentColor);
    root.style.setProperty('--accent-foreground', foregroundFor(branding.accentColor));
    root.style.setProperty('--ring', branding.primaryColor);
  }, [branding]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(mode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      /* localStorage unavailable — choice simply won't persist */
    }
  }, [mode]);

  const toggleMode = () => setMode((m) => (m === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ branding, setBranding, mode, setMode, toggleMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
