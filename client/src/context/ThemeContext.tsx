import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import {
  DEFAULT_APPEARANCE, normalizeAppearance, sameAppearance, schemeFor, systemScheme, themeVars,
  type Appearance, type Scheme,
} from '@/lib/themes';
import type { User } from '@/lib/types';

/** Read by public/theme-boot.js before the app loads. Keep the shape in step with it. */
const CACHE_KEY = 'wrkbench.theme';

interface ThemeValue {
  appearance: Appearance;
  /** The scheme on screen right now, after resolving "system". */
  scheme: Scheme;
  /** Applies at once, then saves to the account. Reverts and rethrows if saving fails. */
  setAppearance: (next: Appearance) => Promise<void>;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}

function readCache(): Appearance | null {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Partial<Appearance> | null;
    return saved ? normalizeAppearance(saved) : null;
  } catch {
    return null;
  }
}

function writeCache(appearance: Appearance) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ ...appearance, light: themeVars(appearance, 'light'), dark: themeVars(appearance, 'dark') }),
    );
  } catch {
    /* storage unavailable: the theme still comes from the account after sign-in */
  }
}

function applyTheme(appearance: Appearance, scheme: Scheme) {
  const root = document.documentElement;
  if (appearance.mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', appearance.mode);

  const vars = themeVars(appearance, scheme);
  // Clear every inline colour first: from an earlier theme, theme-boot.js, or a live preview.
  const stale = Array.from(root.style).filter((name) => name.startsWith('--color-') && !(name in vars));
  for (const name of stale) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);

  // The browser chrome follows the page background.
  const bg = getComputedStyle(root).getPropertyValue('--color-bg').trim();
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    if (!meta.dataset.original) meta.dataset.original = meta.content;
    const isDefault = appearance.mode === 'system' && Object.keys(vars).length === 0;
    meta.content = isDefault ? meta.dataset.original : bg;
  }
}

function useSystemScheme(): Scheme {
  const [scheme, setScheme] = useState<Scheme>(systemScheme);
  useEffect(() => {
    let query: MediaQueryList;
    try {
      query = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const update = () => setScheme(query.matches ? 'dark' : 'light');
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return scheme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user, updateUser } = useAuth();
  const system = useSystemScheme();
  // Signed out (the login page), the last theme used in this browser applies.
  const [local, setLocal] = useState<Appearance>(() => readCache() ?? DEFAULT_APPEARANCE);
  const pending = useRef(0);

  // The account is the source of truth once it is known, unless a save is still on its way.
  useEffect(() => {
    if (user?.appearance && pending.current === 0) setLocal(normalizeAppearance(user.appearance));
  }, [user?.appearance]);

  const scheme = schemeFor(local.mode, system);

  useEffect(() => {
    applyTheme(local, scheme);
    writeCache(local);
  }, [local, scheme]);

  const setAppearance = useCallback(
    async (next: Appearance) => {
      const previous = local;
      if (sameAppearance(previous, next)) return;
      setLocal(next);
      if (!user) return;
      pending.current += 1;
      try {
        const { user: saved } = await api.patch<{ user: User }>('/auth/me/appearance', next);
        pending.current -= 1;
        updateUser(saved);
      } catch (error) {
        pending.current -= 1;
        setLocal(previous);
        throw error;
      }
    },
    [local, user, updateUser],
  );

  const value = useMemo<ThemeValue>(() => ({ appearance: local, scheme, setAppearance }), [local, scheme, setAppearance]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
