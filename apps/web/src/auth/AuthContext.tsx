import { AuthUser, LoginResponse, UserRole } from '@sportsbooking/shared';
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from '../api/client';

interface AuthContextValue {
  user: AuthUser | null;
  setSession: (res: LoginResponse) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  setSession: () => undefined,
  logout: () => undefined,
});

const USER_KEY = 'authUser';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  });

  useEffect(() => {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      setSession: (res) => {
        // Only the short-lived access token is kept in JS-accessible storage;
        // the refresh token lives in an httpOnly cookie set by the server (XSS
        // hardening — it can't be read or exfiltrated by page scripts).
        // Persist the user synchronously too (not only via the effect below) so
        // a full-page navigation immediately after login already sees the
        // session and the route guard doesn't bounce to the login screen.
        localStorage.setItem('accessToken', res.accessToken);
        localStorage.setItem(USER_KEY, JSON.stringify(res.user));
        setUser(res.user);
      },
      logout: () => {
        // Best-effort server-side revocation + cookie clear; ignore failures
        // (network/expired) — local sign-out must always succeed.
        void api.logout().catch(() => undefined);
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        setUser(null);
      },
    }),
    [user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
export const isRole = (user: AuthUser | null, ...roles: UserRole[]) =>
  !!user && roles.includes(user.role);
