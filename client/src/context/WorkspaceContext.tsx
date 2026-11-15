import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '@/context/AuthContext';
import { api, tokenStore } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { applyPrinterState, clearPrinterStates } from '@/lib/printerStore';
import { refreshAll, useQuery } from '@/lib/store';
import type { Workspace } from '@/lib/types';

const CURRENT_KEY = 'filament-tracker.workspace';

interface WorkspaceValue {
  workspaces: Workspace[];
  /** Null while loading, or when the user has no workspace yet. */
  workspace: Workspace | null;
  loading: boolean;
  /** Set when the workspace list could not be loaded (as opposed to being empty). */
  error: string | null;
  retry: () => void;
  select: (id: string) => void;
  reload: () => Promise<Workspace[]>;
  /** Admins and owners: change the inventory, set-up and records, and delete things. */
  canEdit: boolean;
  /** Operators and up: run jobs, log usage and maintenance, load slots, reply to requests. */
  canOperate: boolean;
  isOwner: boolean;
  /** Prefix a path with the current workspace: wsPath('/items') -> '/workspaces/<id>/items'. Null when there is none. */
  wsPath: (path: string) => string | null;
  money: (value: number) => string;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
}

/** Read a workspace-scoped collection. Shares one cache entry per path across the app. */
export function useWsQuery<T>(path: string) {
  const { wsPath } = useWorkspace();
  return useQuery<T>(wsPath(path));
}

const readStored = () => {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
};

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  // Which user the list was loaded for: guards against showing "no workspaces" for a split second after sign-in.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(readStored);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const userId = user?.id ?? null;
  const loading = userId !== null && loadedFor !== userId;

  const reload = useCallback(async () => {
    const list = await api.get<Workspace[]>('/workspaces');
    setWorkspaces(list);
    return list;
  }, []);

  useEffect(() => {
    setWorkspaces([]);
    setError(null);
    if (!userId) {
      // Signed out: forget who the list was loaded for. Otherwise the same person signing back in counts as
      // "loaded, with no workspaces" until the list arrives, and is sent to first-workspace set-up.
      setLoadedFor(null);
      return;
    }
    let cancelled = false;
    reload()
      // A failed load is not the same as having no workspaces: say so rather than sending them to set-up.
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load your workspaces.');
      })
      .finally(() => {
        if (!cancelled) setLoadedFor(userId);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, reload, attempt]);

  const workspace = workspaces.find((w) => w.id === currentId) ?? workspaces[0] ?? null;
  const workspaceId = workspace?.id ?? null;

  const select = useCallback((id: string) => {
    setCurrentId(id);
    try {
      localStorage.setItem(CURRENT_KEY, id);
    } catch {
      /* selection lasts for this tab only */
    }
  }, []);

  // Live updates: when anyone changes this workspace, refresh what is on screen.
  useEffect(() => {
    if (!user || !workspaceId) return;
    const socket = io({ auth: (send) => send({ token: tokenStore.get() }), transports: ['websocket', 'polling'] });
    const join = () => socket.emit('workspace:join', workspaceId);
    socket.on('connect', join);
    socket.on('workspace:changed', () => {
      refreshAll();
      void reload().catch(() => undefined);
    });
    // Connected printers report every second or two: each message replaces that printer's entry, nothing is re-fetched.
    socket.on('printer:state', applyPrinterState);
    // Coming back to the tab (phone unlocked at the bench) should never show stale stock.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshAll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      socket.disconnect();
      clearPrinterStates();
    };
  }, [user, workspaceId, reload]);

  const value = useMemo<WorkspaceValue>(
    () => ({
      workspaces,
      workspace,
      loading,
      error,
      retry: () => {
        setLoadedFor(null);
        setAttempt((n) => n + 1);
      },
      select,
      reload,
      canEdit: workspace?.role === 'admin' || workspace?.role === 'owner',
      canOperate: workspace ? workspace.role !== 'viewer' : false,
      isOwner: workspace?.role === 'owner',
      wsPath: (path) => (workspace ? `/workspaces/${workspace.id}${path}` : null),
      money: (amount) => formatMoney(amount, workspace?.currency ?? 'GBP'),
    }),
    [workspaces, workspace, loading, error, select, reload],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
