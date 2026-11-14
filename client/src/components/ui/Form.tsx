import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Check } from 'lucide-react';
import { Select } from '@/components/ui/Select';
import styles from '@/components/ui/Form.module.css';

interface FieldProps {
  label: string;
  hint?: string;
  suffix?: string;
  wide?: boolean;
  children: (id: string) => ReactNode;
}

/** Label + control + optional hint, wired together by id. */
export function Field({ label, hint, suffix, wide, children }: FieldProps) {
  const id = useId();
  return (
    <div className={`${styles.field} ${wide ? styles.wide : ''}`}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.control}>
        {children(id)}
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </div>
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  suffix?: string;
  wide?: boolean;
}

export function TextField({ label, value, onChange, hint, suffix, wide, ...rest }: TextFieldProps) {
  return (
    <Field label={label} hint={hint} suffix={suffix} wide={wide}>
      {(id) => <input id={id} className={styles.input} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />}
    </Field>
  );
}

/** Numeric entry kept as text so partial input ("1.", "") is never fought with. Shows the decimal keypad on phones. */
export function NumberField(props: TextFieldProps) {
  return <TextField inputMode="decimal" autoComplete="off" enterKeyHint="done" {...props} />;
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}

export function SelectField({ label, value, onChange, hint, wide, children, ...rest }: SelectFieldProps) {
  return (
    <Field label={label} hint={hint} wide={wide}>
      {(id) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
          {children}
        </Select>
      )}
    </Field>
  );
}

interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}

export function TextAreaField({ label, value, onChange, hint, rows = 3, ...rest }: TextAreaFieldProps) {
  return (
    <Field label={label} hint={hint} wide>
      {(id) => (
        <textarea id={id} className={`${styles.input} ${styles.textarea}`} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
      )}
    </Field>
  );
}

interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
}

export function Checkbox({ label, checked, onChange, hint, disabled }: CheckboxProps) {
  return (
    <label className={`${styles.checkbox} ${disabled ? styles.disabled : ''}`}>
      <input type="checkbox" className={styles.checkboxInput} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={styles.box} aria-hidden>
        <Check size={14} strokeWidth={3} />
      </span>
      <span className={styles.checkboxText}>
        {label}
        {hint && <span className={styles.hint}>{hint}</span>}
      </span>
    </label>
  );
}

/** Responsive grid for form controls: one column on phones, two on wider screens. */
export function FormGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}
