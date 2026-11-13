import { describe, expect, it } from 'vitest';
import {
  ACCENT_SWATCHES, DEFAULT_APPEARANCE, MIN_TEXT_CONTRAST, MIN_UI_CONTRAST, PRESETS, contrast, fitAccent,
  normalizeAppearance, paletteFor, themeVars, type Palette,
} from '@/lib/themes';

const SCHEMES = ['light', 'dark'] as const;

function checkPalette(p: Palette) {
  return {
    text: contrast(p.text, p.surface),
    textOnBg: contrast(p.text, p.bg),
    muted: contrast(p.textMuted, p.surface),
    faintOnSunken: contrast(p.textFaint, p.surfaceSunken),
    onAccent: contrast(p.onAccent, p.accent),
    onAccentHover: contrast(p.onAccent, p.accentHover),
    accentVsSurface: contrast(p.accent, p.surface),
    textOnSoft: contrast(p.text, p.accentSoft),
  };
}

function expectReadable(p: Palette) {
  const c = checkPalette(p);
  expect(c.text).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  expect(c.textOnBg).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  expect(c.muted).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  expect(c.faintOnSunken).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  expect(c.onAccent).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  expect(c.onAccentHover).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  expect(c.accentVsSurface).toBeGreaterThanOrEqual(MIN_UI_CONTRAST);
  expect(c.textOnSoft).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
}

describe('presets', () => {
  for (const preset of PRESETS) {
    for (const scheme of SCHEMES) {
      it(`${preset.name} ${scheme} is readable`, () => expectReadable(preset[scheme]));
    }
  }

  it('graphite mirrors tokens.css, so the default needs no overrides', () => {
    expect(themeVars(DEFAULT_APPEARANCE, 'light')).toEqual({});
    expect(themeVars({ ...DEFAULT_APPEARANCE, mode: 'dark' }, 'dark')).toEqual({});
  });

  it('never sets status, tone or needle colours', () => {
    const vars = themeVars({ mode: 'system', preset: 'night', accent: '#a82c68' }, 'dark');
    for (const name of Object.keys(vars)) {
      expect(name).not.toMatch(/--color-(ok|warn|danger|info|needle|focus)|--tone-/);
    }
  });
});

describe('custom accents', () => {
  const samples = [...ACCENT_SWATCHES, '#000000', '#ffffff', '#ffff00', '#1f3a5f', '#777777', '#00ff7f', '#ff0000'];

  for (const preset of PRESETS) {
    for (const scheme of SCHEMES) {
      it(`any colour stays readable on ${preset.name} ${scheme}`, () => {
        for (const accent of samples) expectReadable(paletteFor({ mode: scheme, preset: preset.id, accent }, scheme));
      });
    }
  }

  it('reports when a colour had to be adjusted', () => {
    const graphite = PRESETS[0];
    expect(fitAccent('#2457b8', graphite.light, 'light').adjusted).toBe(false);
    expect(fitAccent('#ffff00', graphite.light, 'light').adjusted).toBe(true);
    expect(fitAccent('#1f3a5f', graphite.dark, 'dark').adjusted).toBe(true);
  });

  it('keeps a colour that already works unchanged', () => {
    expect(fitAccent('#2457b8', PRESETS[0].light, 'light').accent).toBe('#2457b8');
  });
});

describe('normalizeAppearance', () => {
  it('falls back to defaults for anything unknown', () => {
    expect(normalizeAppearance({ mode: 'sepia' as never, preset: 'nope', accent: 'red' })).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
  });

  it('keeps valid values and lowercases the accent', () => {
    expect(normalizeAppearance({ mode: 'dark', preset: 'paper', accent: '#ABCDEF' })).toEqual({ mode: 'dark', preset: 'paper', accent: '#abcdef' });
  });
});
