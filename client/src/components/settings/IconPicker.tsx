import { ICON_NAMES, ICONS, TONES, type Tone } from '@/lib/icons';
import styles from '@/components/settings/Settings.module.css';

export function IconPicker({ label, value, onChange }: { label: string; value: string; onChange: (name: string) => void }) {
  return (
    <div className={styles.picker}>
      <span className={styles.pickerLabel}>{label}</span>
      <div className={styles.iconGrid} role="radiogroup" aria-label={label}>
        {ICON_NAMES.map((name) => {
          const Icon = ICONS[name];
          return (
            <button key={name} type="button" role="radio" aria-checked={value === name} aria-label={name} title={name} className={`${styles.iconOption} ${value === name ? styles.optionSelected : ''}`} onClick={() => onChange(name)}>
              <Icon size={18} aria-hidden />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TonePicker({ label, value, onChange }: { label: string; value: string; onChange: (tone: Tone) => void }) {
  return (
    <div className={styles.picker}>
      <span className={styles.pickerLabel}>{label}</span>
      <div className={styles.toneRow} role="radiogroup" aria-label={label}>
        {TONES.map((tone) => (
          <button key={tone} type="button" role="radio" aria-checked={value === tone} aria-label={tone} title={tone} className={`${styles.toneOption} ${styles[`tone-${tone}`]} ${value === tone ? styles.optionSelected : ''}`} onClick={() => onChange(tone)} />
        ))}
      </div>
    </div>
  );
}
