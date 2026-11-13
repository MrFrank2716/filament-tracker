import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, AUTH_EXPIRED_EVENT, tokenStore } from '@/lib/api';
import { clearStore } from '@/lib/store';
import type { User } from '@/lib/types';

interface AuthValue {
  user: User | null;
  /** True until we know whether a stored session is still valid. */
  loading: boolean;
  /** Set when a stored session could not be checked because the server was unreachable. */
  error: string | null;
  retry: () => void;
  login: (email: string, password: string) => Promise<void>;
  /** For a guest this turns the session into a real account and keeps its workspaces. */
  register: (name: string, email: string, password: string) => Promise<void>;
  /** Start a temporary session with its own example workspace. */
  continueAsGuest: () => Promise<void>;
  logout: () => void;
  /** Replace the signed-in user with a fresher copy from the server. */
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

interface Session {
  token: string;
  user: User;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => Boolean(tokenStore.get()));
  const [error, setError] = useState<string | null>(null);

  const logout = useCallback(() => {
    tokenStore.clear();
    clearStore();
    setUser(null);
  }, []);

  const restore = useCallback(() => {
    if (!tokenStore.get()) return;
    setLoading(true);
    setError(null);
    api
      .get<{ user: User }>('/auth/me')
      .then(({ user: current }) => setUser(current))
      .catch((cause: unknown) => {
        // Only a rejected session signs you out. A server that is down or restarting must not:
        // keep the session and offer a retry instead.
        if (cause instanceof ApiError && cause.status === 401) tokenStore.clear();
        else setError(cause instanceof Error ? cause.message : 'Cannot reach the server.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(restore, [restore]);

  useEffect(() => {
    window.addEventListener(AUTH_EXPIRED_EVENT, logout);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, logout);
  }, [logout]);

  const value = useMemo<AuthValue>(() => {
    const start = (session: Session, keepData = false) => {
      tokenStore.set(session.token);
      if (!keepData) clearStore();
      setUser(session.user);
    };
    return {
      user,
      loading,
      error,
      retry: restore,
      logout,
      updateUser: setUser,
      login: async (email, password) => start(await api.post<Session>('/auth/login', { email, password })),
      // A guest who registers stays the same user, so what is on screen is still theirs.
      register: async (name, email, password) =>
        start(await api.post<Session>('/auth/register', { name, email, password }), Boolean(user?.isGuest)),
      continueAsGuest: async () => start(await api.post<Session>('/auth/guest')),
    };
  }, [user, loading, error, restore, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
