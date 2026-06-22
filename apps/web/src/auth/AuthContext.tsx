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
        localStorage.setItem('accessToken', res.accessToken);
        localStorage.setItem('refreshToken', res.refreshToken);
        setUser(res.user);
      },
      logout: () => {
        // Best-effort server-side revocation of the refresh token; ignore
        // failures (network/expired) — local sign-out must always succeed.
        const refreshToken = localStorage.getItem('refreshToken');
        if (refreshToken) {
          void api.logout(refreshToken).catch(() => undefined);
        }
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
