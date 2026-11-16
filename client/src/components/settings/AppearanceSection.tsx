import { useEffect, useRef, useState } from 'react';
import { Check, Monitor, Moon, RotateCcw, Sun } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge, Card, Chip, ChipRow, Meter, Muted, SectionTitle } from '@/components/ui/Display';
import { useToast } from '@/components/ui/Toast';
import { useTheme } from '@/context/ThemeContext';
import {
  ACCENT_SWATCHES, DEFAULT_APPEARANCE, PRESETS, fitAccent, presetById, sameAppearance,
  type Appearance, type Scheme, type ThemeMode,
} from '@/lib/themes';
import styles from '@/components/settings/Appearance.module.css';

const MODES: Array<{ id: ThemeMode; label: string; icon: typeof Sun }> = [
  { id: 'system', label: 'Match device', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
];

/** The colour input fires on every drag step; save once the pointer settles. */
const ACCENT_SAVE_DELAY = 400;

/**
 * Mode, palette and accent for the signed-in user. Each pick applies and saves at once.
 * `compact` drops the sample card, for the setup wizard where the page itself is the preview.
 */
export function AppearanceSection({ compact = false }: { compact?: boolean }) {
  const { appearance, scheme, setAppearance } = useTheme();
  const toast = useToast();
  const [draftAccent, setDraftAccent] = useState(appearance.accent);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => setDraftAccent(appearance.accent), [appearance.accent]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Not useAction: a theme change has nothing on screen to refetch.
  const save = (next: Appearance) =>
    setAppearance(next).catch((error: unknown) => {
      setDraftAccent(appearance.accent);
      toast(error instanceof Error ? error.message : 'Could not save your theme', 'danger');
    });

  const change = (patch: Partial<Appearance>) => {
    window.clearTimeout(timer.current);
    if ('accent' in patch) setDraftAccent(patch.accent ?? null);
    void save({ ...appearance, accent: draftAccent, ...patch });
  };

  const dragAccent = (hex: string) => {
    setDraftAccent(hex);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save({ ...appearance, accent: hex }), ACCENT_SAVE_DELAY);
  };

  // While dragging, preview the colour before it is saved. The theme provider repaints after a save.
  useEffect(() => {
    if (draftAccent === appearance.accent || !draftAccent) return;
    const fit = fitAccent(draftAccent, presetById(appearance.preset)[scheme], scheme);
    const root = document.documentElement.style;
    const preview: Record<string, string> = {
      '--color-accent': fit.accent,
      '--color-accent-hover': fit.accentHover,
      '--color-accent-soft': fit.accentSoft,
      '--color-on-accent': fit.onAccent,
    };
    const before = Object.fromEntries(Object.keys(preview).map((name) => [name, root.getPropertyValue(name)]));
    for (const [name, value] of Object.entries(preview)) root.setProperty(name, value);
    return () => {
      for (const [name, value] of Object.entries(before)) {
        if (value) root.setProperty(name, value);
        else root.removeProperty(name);
      }
    };
  }, [draftAccent, appearance, scheme]);

  const preset = presetById(appearance.preset);
  const otherScheme: Scheme = scheme === 'light' ? 'dark' : 'light';
  const adjustedIn = draftAccent
    ? (['light', 'dark'] as const).filter((s) => fitAccent(draftAccent, preset[s], s).adjusted)
    : [];

  return (
    <>
      {!compact && <Muted>Your own colours. Saved to your account, so they follow you to any device.</Muted>}

      <div className={`${styles.layout} ${compact ? styles.compact : ''}`}>
        <div className={styles.controls}>
          <section className={styles.group}>
            <SectionTitle>Mode</SectionTitle>
            <ChipRow label="Light or dark">
              {MODES.map((m) => (
                <Chip key={m.id} active={appearance.mode === m.id} onClick={() => change({ mode: m.id })}>
                  <m.icon size={16} aria-hidden />
                  {m.label}
                </Chip>
              ))}
            </ChipRow>
          </section>

          <section className={styles.group}>
            <SectionTitle>Palette</SectionTitle>
            <div className={styles.presets} role="radiogroup" aria-label="Palette">
              {PRESETS.map((p) => {
                const palette = p[scheme];
                const active = p.id === preset.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`${styles.preset} ${active ? styles.presetActive : ''}`}
                    onClick={() => change({ preset: p.id })}
                  >
                    <span className={styles.presetSample} style={{ background: palette.bg, borderColor: palette.border }} aria-hidden>
                      <span className={styles.presetCard} style={{ background: palette.surface, borderColor: palette.border }}>
                        <span className={styles.presetLine} style={{ background: palette.text }} />
                        <span className={styles.presetLineShort} style={{ background: palette.textMuted }} />
                        <span className={styles.presetButton} style={{ background: draftAccent ? fitAccent(draftAccent, palette, scheme).accent : palette.accent }} />
                      </span>
                    </span>
                    <span className={styles.presetText}>
                      <span className={styles.presetName}>
                        {p.name}
                        {active && <Check size={14} aria-hidden />}
                      </span>
                      <span className={styles.presetDescription}>{p.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className={styles.group}>
            <SectionTitle>Accent</SectionTitle>
            <Muted>The colour of primary buttons and selected items. Warning and status colours never change, so stock and maintenance alerts always look the same.</Muted>
            <div className={styles.accents} role="radiogroup" aria-label="Accent colour">
              <button
                type="button"
                role="radio"
                aria-checked={!draftAccent}
                className={`${styles.accent} ${styles.accentDefault} ${!draftAccent ? styles.accentActive : ''}`}
                style={{ background: preset[scheme].accent }}
                onClick={() => change({ accent: null })}
                title={`${preset.name} default`}
              >
                <span className={styles.srOnly}>{preset.name} default</span>
              </button>
              {ACCENT_SWATCHES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  role="radio"
                  aria-checked={draftAccent === hex}
                  className={`${styles.accent} ${draftAccent === hex ? styles.accentActive : ''}`}
                  style={{ background: fitAccent(hex, preset[scheme], scheme).accent }}
                  onClick={() => change({ accent: hex })}
                  title={hex}
                >
                  <span className={styles.srOnly}>{hex}</span>
                </button>
              ))}
              <label className={styles.customAccent}>
                <input
                  type="color"
                  className={styles.colorInput}
                  value={draftAccent ?? preset.light.accent}
                  onChange={(event) => dragAccent(event.target.value)}
                />
                <span>Custom</span>
              </label>
            </div>
            {draftAccent && (
              <Muted>
                <span className={styles.mono}>{draftAccent}</span>
                {adjustedIn.length > 0 &&
                  ` · Shown ${adjustedIn.map((s) => (s === 'light' ? 'darker in light mode' : 'lighter in dark mode')).join(' and ')} so it stays readable.`}
              </Muted>
            )}
          </section>

          <div>
            <Button icon={RotateCcw} disabled={sameAppearance(appearance, DEFAULT_APPEARANCE)} onClick={() => change(DEFAULT_APPEARANCE)}>
              Reset to standard
            </Button>
          </div>
        </div>

        {!compact && (
        <aside className={styles.preview} aria-label="Preview">
          <SectionTitle>Preview</SectionTitle>
          <Card>
            <div className={styles.previewBody}>
              <div>
                <p className={styles.previewTitle}>PLA, Galaxy Black</p>
                <Muted>Shelf B · Bin 3</Muted>
              </div>
              <Meter value={620} max={1000} threshold={250} label="Stock" />
              <div className={styles.previewRow}>
                <Badge tone="ok">In stock</Badge>
                <Badge tone="warn">Running low</Badge>
                <Badge tone="danger">Overdue</Badge>
                <Badge tone="info">Requested</Badge>
              </div>
              <ChipRow label="Sample filter">
                <Chip active onClick={() => undefined}>Selected</Chip>
                <Chip active={false} onClick={() => undefined}>Not selected</Chip>
              </ChipRow>
              <div className={styles.previewRow}>
                <Button variant="primary">Primary</Button>
                <Button>Secondary</Button>
              </div>
            </div>
          </Card>
          <Muted>Showing {scheme} mode. Switch to {otherScheme} above to check it too.</Muted>
        </aside>
        )}
      </div>
    </>
  );
}
