/*
 * Personal themes: a light/dark mode, a preset palette, and an optional accent colour.
 *
 * Only surfaces, text, borders and the action colour change. Status colours (ok, warn,
 * danger, info), category tones and the orange needle keep their meaning and are never
 * touched here. tokens.css stays the source of the default look: the default theme
 * resolves to no overrides at all.
 */

export type ThemeMode = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

export interface Appearance {
  mode: ThemeMode;
  preset: string;
  /** "#rrggbb", or null for the preset's own accent. */
  accent: string | null;
}

export const DEFAULT_APPEARANCE: Appearance = { mode: 'system', preset: 'graphite', accent: null };

/** The tokens a theme may set. Everything else in tokens.css is fixed. */
export interface Palette {
  bg: string;
  surface: string;
  surfaceSunken: string;
  surfaceHover: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentHover: string;
  accentSoft: string;
  onAccent: string;
}

const TOKEN_NAMES: Record<keyof Palette, string> = {
  bg: '--color-bg',
  surface: '--color-surface',
  surfaceSunken: '--color-surface-sunken',
  surfaceHover: '--color-surface-hover',
  border: '--color-border',
  borderStrong: '--color-border-strong',
  text: '--color-text',
  textMuted: '--color-text-muted',
  textFaint: '--color-text-faint',
  accent: '--color-accent',
  accentHover: '--color-accent-hover',
  accentSoft: '--color-accent-soft',
  onAccent: '--color-on-accent',
};

export interface Preset {
  id: string;
  name: string;
  description: string;
  light: Palette;
  dark: Palette;
}

// Keep the ids in step with THEME_PRESETS in server/src/routes/auth.ts.
export const PRESETS: Preset[] = [
  {
    id: 'graphite',
    name: 'Graphite',
    description: 'Cool concrete and graphite. The standard look.',
    // Mirrors tokens.css exactly.
    light: {
      bg: '#eceef0', surface: '#ffffff', surfaceSunken: '#e2e5e8', surfaceHover: '#f3f4f6',
      border: '#d3d7dc', borderStrong: '#a9afb6',
      text: '#14171a', textMuted: '#545b62', textFaint: '#5f666e',
      accent: '#14171a', accentHover: '#2c3136', accentSoft: '#dfe2e6', onAccent: '#ffffff',
    },
    dark: {
      bg: '#0f1113', surface: '#171a1d', surfaceSunken: '#22262a', surfaceHover: '#1d2124',
      border: '#2e3338', borderStrong: '#4a5057',
      text: '#eceef0', textMuted: '#9aa1a8', textFaint: '#8a9199',
      accent: '#eceef0', accentHover: '#ffffff', accentSoft: '#2a2f34', onAccent: '#0f1113',
    },
  },
  {
    id: 'slate',
    name: 'Slate',
    description: 'Blue-grey surfaces with a navy action colour.',
    light: {
      bg: '#e8ecf1', surface: '#ffffff', surfaceSunken: '#dce2e9', surfaceHover: '#f1f4f8',
      border: '#cdd5df', borderStrong: '#9fabba',
      text: '#121a24', textMuted: '#4b5868', textFaint: '#566374',
      accent: '#1f3a5f', accentHover: '#2b4a75', accentSoft: '#dbe4f0', onAccent: '#ffffff',
    },
    dark: {
      bg: '#0d1218', surface: '#151c24', surfaceSunken: '#1f2832', surfaceHover: '#1a222b',
      border: '#2a3542', borderStrong: '#46546a',
      text: '#e6edf5', textMuted: '#96a3b3', textFaint: '#8a97a8',
      accent: '#a9c4e8', accentHover: '#c4d8f2', accentSoft: '#223247', onAccent: '#0d1218',
    },
  },
  {
    id: 'paper',
    name: 'Paper',
    description: 'Warm off-white, like a job sheet on the bench.',
    light: {
      bg: '#f1ede6', surface: '#fffdf9', surfaceSunken: '#e7e1d7', surfaceHover: '#f7f3ec',
      border: '#d9d1c4', borderStrong: '#aca290',
      text: '#1c1712', textMuted: '#5a5146', textFaint: '#605649',
      accent: '#2b241c', accentHover: '#42382c', accentSoft: '#e6dfd3', onAccent: '#fffdf9',
    },
    dark: {
      bg: '#14110d', surface: '#1c1813', surfaceSunken: '#28221b', surfaceHover: '#221d17',
      border: '#352e25', borderStrong: '#574d40',
      text: '#f0ebe3', textMuted: '#a89e91', textFaint: '#9b9184',
      accent: '#f0ebe3', accentHover: '#ffffff', accentSoft: '#2f2820', onAccent: '#14110d',
    },
  },
  {
    id: 'night',
    name: 'Night',
    description: 'Crisp light, near-black dark, with an indigo action colour.',
    light: {
      bg: '#e9ebf0', surface: '#ffffff', surfaceSunken: '#dfe2e9', surfaceHover: '#f2f3f7',
      border: '#cfd3dc', borderStrong: '#a3a9b6',
      text: '#10131a', textMuted: '#4f5563', textFaint: '#5a6070',
      accent: '#3730a3', accentHover: '#4338ca', accentSoft: '#e3e2f6', onAccent: '#ffffff',
    },
    dark: {
      bg: '#05070a', surface: '#0d1016', surfaceSunken: '#161a22', surfaceHover: '#12161d',
      border: '#222833', borderStrong: '#3c4452',
      text: '#e8ebf2', textMuted: '#98a0ae', textFaint: '#8a93a2',
      accent: '#a5b4fc', accentHover: '#c7d2fe', accentSoft: '#1e2240', onAccent: '#05070a',
    },
  },
];

/** A few starting points for the accent picker. Any colour works; these are just quick picks. */
export const ACCENT_SWATCHES = ['#2457b8', '#0e7372', '#1f7a4a', '#6b41b8', '#a82c68', '#b8400d'];

export function presetById(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

// ---- Colour maths ----------------------------------------------------------

type Rgb = [number, number, number];

export function isHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function toRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;
}

/** Mix `a` towards `b` by `amount` (0 = a, 1 = b). */
export function mix(a: string, b: string, amount: number): string {
  const ca = toRgb(a);
  const cb = toRgb(b);
  return toHex([0, 1, 2].map((i) => ca[i] + (cb[i] - ca[i]) * amount) as Rgb);
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ---- Accent ----------------------------------------------------------------

/** Text on an accent fill must read as body text; the fill against the page as a UI control. */
export const MIN_TEXT_CONTRAST = 4.5;
export const MIN_UI_CONTRAST = 3;

export interface AccentFit {
  accent: string;
  accentHover: string;
  accentSoft: string;
  onAccent: string;
  /** True when the picked colour was lightened or darkened to stay readable in this scheme. */
  adjusted: boolean;
}

/**
 * Turn any picked colour into a usable accent for one scheme. A colour too close to the
 * page is nudged darker (light scheme) or lighter (dark scheme) until it stands out,
 * so a navy picked in light mode still works in dark mode instead of being refused.
 */
export function fitAccent(hex: string, base: Palette, scheme: Scheme): AccentFit {
  // Text on the fill is the page surface colour: white-ish on a light page, near-black on a
  // dark one, as the presets do. Moving the fill away from the surface then raises both the
  // text contrast and the fill's contrast against the page, so one nudge fixes both.
  const onAccent = base.surface;
  const towards = scheme === 'light' ? '#000000' : '#ffffff';
  let accent = hex.toLowerCase();
  let adjusted = false;
  for (let step = 0; step < 40 && contrast(accent, onAccent) < MIN_TEXT_CONTRAST; step++) {
    accent = mix(accent, towards, 0.06);
    adjusted = true;
  }

  // Hover goes a little further the same way, so its text stays readable too.
  const accentHover = mix(accent, towards, 0.14);

  // A faint wash of the accent for selection and active rows; body text must still read on it.
  let accentSoft = mix(base.surface, accent, 0.16);
  if (contrast(base.text, accentSoft) < MIN_TEXT_CONTRAST) accentSoft = mix(base.surface, accent, 0.08);

  return { accent, accentHover, accentSoft, onAccent, adjusted };
}

// ---- Resolving -------------------------------------------------------------

export function systemScheme(): Scheme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function schemeFor(mode: ThemeMode, system: Scheme): Scheme {
  return mode === 'system' ? system : mode;
}

/** True when nothing differs from tokens.css, apart from perhaps a forced light or dark mode. */
export function usesDefaultPalette(appearance: Appearance): boolean {
  return presetById(appearance.preset).id === 'graphite' && !appearance.accent;
}

export function paletteFor(appearance: Appearance, scheme: Scheme): Palette {
  const base = presetById(appearance.preset)[scheme];
  if (!appearance.accent || !isHex(appearance.accent)) return base;
  const { adjusted: _adjusted, ...accent } = fitAccent(appearance.accent, base, scheme);
  return { ...base, ...accent };
}

/** CSS custom properties to set on <html>. Empty for the default palette, so tokens.css applies untouched. */
export function themeVars(appearance: Appearance, scheme: Scheme): Record<string, string> {
  if (usesDefaultPalette(appearance)) return {};
  const palette = paletteFor(appearance, scheme);
  return Object.fromEntries(Object.entries(palette).map(([key, value]) => [TOKEN_NAMES[key as keyof Palette], value]));
}

export function normalizeAppearance(value: Partial<Appearance> | null | undefined): Appearance {
  const mode = value?.mode === 'light' || value?.mode === 'dark' ? value.mode : 'system';
  const preset = presetById(value?.preset ?? '').id;
  const accent = value?.accent && isHex(value.accent) ? value.accent.toLowerCase() : null;
  return { mode, preset, accent };
}

export function sameAppearance(a: Appearance, b: Appearance): boolean {
  return a.mode === b.mode && a.preset === b.preset && a.accent === b.accent;
}
