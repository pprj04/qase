import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, setSignedIn } from '../api/client';

export interface User {
  email: string;
  displayName?: string;
  profile?: { timezone?: string };
  [key: string]: unknown;
}

export type AuthStatus = 'checking' | 'signed-in' | 'signed-out' | 'unavailable';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  pilotMode: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string, inviteCode?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [user, setUser] = useState<User | null>(null);
  const [pilotMode, setPilotMode] = useState(false);

  const applyUser = useCallback((next: User | null) => {
    setUser(next);
    setSignedIn(Boolean(next));
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const next = await api<User>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      applyUser(next);
      setStatus('signed-in');
    },
    [applyUser],
  );

  const register = useCallback(
    async (email: string, password: string, displayName?: string, inviteCode?: string) => {
      const next = await api<User>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          password,
          displayName,
          inviteCode: inviteCode || undefined,
        }),
      });
      applyUser(next);
      setStatus('signed-in');
    },
    [applyUser],
  );

  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    localStorage.removeItem('qase.session');
    window.location.reload();
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await api<User>('/auth/me');
    applyUser(me);
  }, [applyUser]);

  // Boot: pilot status first (decorative), then session resolution.
  // 401 → signed out; 404 → older embedded hosts without the first-party auth
  // adapter stay usable (legacy behavior).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pilot = await api<{ pilot?: boolean }>('/pilot-status').catch(() => undefined);
        if (!cancelled && pilot?.pilot) setPilotMode(true);
      } catch {
        /* pilot status is decorative */
      }
      try {
        const me = await api<User>('/auth/me');
        if (cancelled) return;
        applyUser(me);
        setStatus('signed-in');
      } catch (error) {
        if (cancelled) return;
        const code = (error as { status?: number })?.status;
        if (code === 404) {
          setStatus('unavailable');
          return;
        }
        setSignedIn(false);
        setStatus('signed-out');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyUser]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, pilotMode, signIn, register, signOut, refreshUser }),
    [status, user, pilotMode, signIn, register, signOut, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside AuthProvider');
  return auth;
}
