import { Branding } from '@sportsbooking/shared';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

/**
 * Token-based white-label theming (PRD §4.10, §7). Branding tokens are written
 * to CSS variables so the whole app re-themes per owner without code changes.
 * Architected subdomain-ready: a future host→owner resolver can hydrate this.
 */
const DEFAULT_BRANDING: Branding = {
  logoUrl: null,
  primaryColor: '#0EA5E9',
  secondaryColor: '#0F172A',
  accentColor: '#22C55E',
};

interface ThemeContextValue {
  branding: Branding;
  setBranding: (b: Branding) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  branding: DEFAULT_BRANDING,
  setBranding: () => undefined,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--color-primary', branding.primaryColor);
    root.style.setProperty('--color-secondary', branding.secondaryColor);
    root.style.setProperty('--color-accent', branding.accentColor);
  }, [branding]);

  return (
    <ThemeContext.Provider value={{ branding, setBranding }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
