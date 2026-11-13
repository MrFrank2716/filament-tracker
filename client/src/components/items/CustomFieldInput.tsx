import { X } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { Checkbox, Field, NumberField, SelectField, TextField } from '@/components/ui/Form';
import type { CustomField, FieldValue } from '@/lib/types';
import { parseNumber } from '@/lib/format';
import styles from '@/components/items/Items.module.css';

/** Form state for custom fields: everything is text while typing, except checkboxes. */
export type FieldDraft = Record<string, string | boolean>;

export function toDraft(fields: CustomField[], values: Record<string, FieldValue>): FieldDraft {
  const draft: FieldDraft = {};
  for (const field of fields) {
    const value = values[field.key];
    if (field.fieldType === 'boolean') draft[field.key] = value === true;
    else draft[field.key] = value === null || value === undefined ? '' : String(value);
  }
  return draft;
}

export function fromDraft(fields: CustomField[], draft: FieldDraft): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  for (const field of fields) {
    const raw = draft[field.key];
    if (field.fieldType === 'boolean') values[field.key] = raw === true;
    else if (field.fieldType === 'number') values[field.key] = typeof raw === 'string' ? parseNumber(raw) : null;
    else values[field.key] = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
  }
  return values;
}

interface Props {
  field: CustomField;
  value: string | boolean | undefined;
  onChange: (value: string | boolean) => void;
}

/** Renders the right control for a user-defined field. */
export function CustomFieldInput({ field, value, onChange }: Props) {
  const label = field.required ? `${field.label} *` : field.label;
  const text = typeof value === 'string' ? value : '';

  switch (field.fieldType) {
    case 'number':
      return <NumberField label={label} value={text} onChange={onChange} suffix={field.unit || undefined} />;
    case 'select':
      return (
        <SelectField label={label} value={text} onChange={onChange}>
          <option value="">Choose…</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </SelectField>
      );
    case 'boolean':
      return <Checkbox label={field.label} checked={value === true} onChange={onChange} />;
    case 'date':
      return <TextField label={label} type="date" value={text} onChange={onChange} />;
    case 'color':
      return (
        <Field label={label}>
          {(id) => (
            <span className={styles.colorControl}>
              <input id={id} type="color" className={styles.colorInput} value={text || '#888888'} onChange={(e) => onChange(e.target.value)} />
              <span className={styles.colorValue}>{text || 'Not set'}</span>
              {text && <IconButton icon={X} label={`Clear ${field.label}`} size="sm" onClick={() => onChange('')} />}
            </span>
          )}
        </Field>
      );
    default:
      return <TextField label={label} value={text} onChange={onChange} />;
  }
}
