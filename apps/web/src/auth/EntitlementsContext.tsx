import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { FeatureFlag, UserRole } from '@sportsbooking/shared';
import { api } from '../api/client';
import { useAuth } from './AuthContext';

interface EntitlementsValue {
  /** Enabled feature flags, or null until loaded (or for non owner/staff). */
  flags: FeatureFlag[] | null;
  loaded: boolean;
  /** True while loading (fail-open for UX) or when the flag is enabled. */
  hasFlag: (f: FeatureFlag) => boolean;
}

const EntitlementsCtx = createContext<EntitlementsValue>({
  flags: null,
  loaded: false,
  hasFlag: () => true,
});

/**
 * Loads the owner's feature entitlements once for the console shell and shares
 * them (nav gating in Layout + route guards in App). Fetched from
 * GET /me/entitlements — not from the JWT — so a super-admin flag change takes
 * effect on the owner's next load without re-login. Only owner/staff fetch;
 * other roles get null (hasFlag → true, i.e. no gating).
 */
export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);

  useEffect(() => {
    if (user?.role === UserRole.OWNER || user?.role === UserRole.STAFF) {
      api
        .getEntitlements()
        .then((e) => setFlags(e.featureFlags))
        .catch(() => setFlags([])); // fail-closed on error: hide gated features
    } else {
      setFlags(null);
    }
  }, [user?.id, user?.role]);

  const loaded = flags !== null;
  const hasFlag = (f: FeatureFlag) => flags === null || flags.includes(f);

  return (
    <EntitlementsCtx.Provider value={{ flags, loaded, hasFlag }}>
      {children}
    </EntitlementsCtx.Provider>
  );
}

export const useEntitlements = () => useContext(EntitlementsCtx);
