import { useEffect, useReducer } from 'react';
import { api } from '@/lib/api';

/**
 * Tiny shared query cache. Every screen reads through useQuery(path); after any write
 * (ours, or someone else's announced over the socket) refreshAll() re-fetches whatever is on screen.
 */
interface Entry {
  data?: unknown;
  error?: string;
  inflight?: Promise<void>;
  listeners: Set<() => void>;
}

const entries = new Map<string, Entry>();

function entryFor(key: string): Entry {
  let entry = entries.get(key);
  if (!entry) {
    entry = { listeners: new Set() };
    entries.set(key, entry);
  }
  return entry;
}

function load(key: string): Promise<void> {
  const entry = entryFor(key);
  if (entry.inflight) return entry.inflight;
  entry.inflight = api
    .get<unknown>(key)
    .then((data) => {
      entry.data = data;
      entry.error = undefined;
    })
    .catch((error: unknown) => {
      entry.error = error instanceof Error ? error.message : 'Could not load';
    })
    .finally(() => {
      entry.inflight = undefined;
      entry.listeners.forEach((notify) => notify());
    });
  return entry.inflight;
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

/** Re-fetch everything currently displayed; forget what is not. Calls made close together are batched. */
export function refreshAll(): void {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    for (const [key, entry] of entries) {
      if (entry.listeners.size) void load(key);
      else entries.delete(key);
    }
  }, 60);
}

/** Re-fetch one entry now, for something that must be current each time it is opened. */
export function refresh(path: string): void {
  void load(path);
}

export function clearStore(): void {
  entries.clear();
}

export interface QueryResult<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
}

export function useQuery<T>(path: string | null): QueryResult<T> {
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!path) return;
    const entry = entryFor(path);
    entry.listeners.add(rerender);
    if (entry.data === undefined && !entry.inflight) void load(path);
    else rerender();
    return () => {
      entry.listeners.delete(rerender);
    };
  }, [path]);

  const entry = path ? entries.get(path) : undefined;
  return {
    data: entry?.data as T | undefined,
    error: entry?.error,
    loading: Boolean(path) && entry?.data === undefined && !entry?.error,
  };
}
