import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * Floodlit toast — a tiny brand-coloured flash used across the player storefront
 * (e.g. "Signed in", "Pack added", "Join request sent"). One toast at a time;
 * auto-dismisses. Rendered by the shell so it floats above the bottom nav.
 */
interface ToastValue {
  toast: string | null;
  flash: (msg: string) => void;
}

const ToastCtx = createContext<ToastValue>({ toast: null, flash: () => undefined });

export function FloodlitToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const value = useMemo(() => ({ toast, flash }), [toast, flash]);
  return <ToastCtx.Provider value={value}>{children}</ToastCtx.Provider>;
}

export const useFloodlitToast = () => useContext(ToastCtx);

/** ₹ formatter (Indian grouping), matching the design's money display. */
export const flMoney = (n: number): string =>
  '₹' + Math.round(n).toLocaleString('en-IN');
