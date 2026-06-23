import { useEffect, useState } from 'react';

/**
 * Subscribe to a CSS media query. Used to pick the right modal surface — a
 * centered Dialog on desktop, a bottom Sheet on mobile. SSR-safe (defaults to
 * false until mounted) and keeps in sync if the viewport crosses the breakpoint.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
