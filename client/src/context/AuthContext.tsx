import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, AUTH_EXPIRED_EVENT, tokenStore } from '@/lib/api';
import { flushHeldDeletes } from '@/lib/heldDeletes';
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
  /** Also signs out every other device. */
  changePassword: (currentPassword: string, password: string) => Promise<void>;
  signOutOthers: () => Promise<void>;
  /** Finish a "forgot password" link: sets the password and signs in. */
  resetPassword: (token: string, password: string) => Promise<void>;
  /** Permanently removes the account, then signs out. */
  deleteAccount: (password: string) => Promise<void>;
  logout: () => void;
  /** Replace the signed-in user with a fresher copy from the server. */
  updateUser: (user: User) => void;
  /** Ask the server for the signed-in user again, quietly: nothing changes if it cannot be reached. */
  refreshUser: () => void;
  /** Send the "confirm your email" link again. Resolves to what to tell the user. */
  resendConfirmation: () => Promise<string>;
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
    // A delete still waiting out its Undo toast is sent while the sign-in is still there to send it with.
    flushHeldDeletes();
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

  const refreshUser = useCallback(() => {
    if (!tokenStore.get()) return;
    api
      .get<{ user: User }>('/auth/me')
      .then(({ user: current }) => setUser(current))
      .catch(() => undefined);
  }, []);

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
      refreshUser,
      resendConfirmation: async () => {
        const answer = await api.post<{ user: User; message: string }>('/auth/verify/resend');
        setUser(answer.user);
        return answer.message;
      },
      login: async (email, password) => start(await api.post<Session>('/auth/login', { email, password })),
      // A guest who registers stays the same user, so what is on screen is still theirs.
      register: async (name, email, password) =>
        start(await api.post<Session>('/auth/register', { name, email, password }), Boolean(user?.isGuest)),
      continueAsGuest: async () => start(await api.post<Session>('/auth/guest')),
      // Both replace this device's token, because the old one stops working along with every other device's.
      changePassword: async (currentPassword, password) =>
        start(await api.post<Session>('/auth/password', { currentPassword, password }), true),
      signOutOthers: async () => start(await api.post<Session>('/auth/sign-out-others'), true),
      resetPassword: async (token, password) => start(await api.post<Session>('/auth/reset', { token, password })),
      deleteAccount: async (password) => {
        await api.post('/auth/delete-account', { password });
        logout();
      },
    };
  }, [user, loading, error, restore, logout, refreshUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
