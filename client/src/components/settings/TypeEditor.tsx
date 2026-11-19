import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { IconPicker, TonePicker } from '@/components/settings/IconPicker';
import { Button, IconButton } from '@/components/ui/Button';
import { ErrorNote, Muted, SectionTitle, TypeIcon } from '@/components/ui/Display';
import { Checkbox, FormGrid, SelectField, TextField } from '@/components/ui/Form';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { useAction } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import type { Catalog } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import type { CustomField, FieldType, ItemType } from '@/lib/types';
import styles from '@/components/settings/Settings.module.css';

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const FIELD_TYPES: Array<{ value: FieldType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Choice from a list' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'color', label: 'Colour' },
  { value: 'date', label: 'Date' },
];

/** Options are edited as one comma-separated line. */
type FieldDraft = Omit<CustomField, 'options'> & { optionsText: string; uid: number };

const slug = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

let nextUid = 1;

export function TypeEditor({ catalog, type, onClose }: { catalog: Catalog; type?: ItemType; onClose: () => void }) {
  const { wsPath } = useWorkspace();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [name, setName] = useState(type?.name ?? '');
  const [icon, setIcon] = useState(type?.icon ?? 'Package');
  const [color, setColor] = useState(type?.color ?? 'slate');
  const [defaultUnitId, setDefaultUnitId] = useState(type?.defaultUnitId ?? '');
  const [tracksLife, setTracksLife] = useState(type?.tracksLife ?? false);
  const [fields, setFields] = useState<FieldDraft[]>(() => (type?.fields ?? []).map((f) => ({ ...f, optionsText: f.options.join(', '), uid: nextUid++ })));
  const [error, setError] = useState('');

  const patch = (uid: number, change: Partial<FieldDraft>) => setFields((current) => current.map((f) => (f.uid === uid ? { ...f, ...change } : f)));
  const move = (index: number, by: number) =>
    setFields((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(index + by, 0, moved);
      return next;
    });
  const addField = () =>
    setFields((current) => [...current, { uid: nextUid++, key: '', label: '', fieldType: 'text', unit: '', optionsText: '', required: false, showInList: true, isSizeDimension: false }]);

  const save = async () => {
    setError('');
    if (!name.trim()) return setError('Give the category a name.');
    const keys = new Set<string>();
    const payload = [];
    for (const field of fields) {
      if (!field.label.trim()) return setError('Every field needs a label (or remove the empty one).');
      // Existing fields keep their key so stored values stay attached; new ones derive it from the label.
      let key = field.id ? field.key : slug(field.label) || 'field';
      // The server refuses keys every JavaScript object already has, so a field labelled "Constructor" gets "constructor_2".
      while (keys.has(key) || RESERVED_KEYS.has(key)) key = `${key}_2`;
      keys.add(key);
      const options = field.fieldType === 'select' ? [...new Set(field.optionsText.split(',').map((o) => o.trim()).filter(Boolean))] : [];
      if (field.fieldType === 'select' && options.length === 0) return setError(`"${field.label}" needs at least one choice.`);
      payload.push({
        id: field.id, key, label: field.label.trim(), fieldType: field.fieldType, unit: field.fieldType === 'number' ? field.unit.trim() : '',
        options, required: field.required, showInList: field.showInList, isSizeDimension: field.fieldType === 'number' && field.isSizeDimension,
      });
    }
    const body = { name: name.trim(), icon, color, defaultUnitId: defaultUnitId || null, tracksLife, fields: payload };
    const ok = await run(() => (type ? api.patch(wsPath(`/item-types/${type.id}`)!, body) : api.post(wsPath('/item-types')!, body)), 'Category saved');
    if (ok) onClose();
  };

  const remove = async () => {
    if (!type) return;
    const ok = await confirm({ title: 'Delete category?', message: `"${type.name}" will be removed. This only works when no items use it.`, confirmLabel: 'Delete', danger: true });
    if (ok && (await run(() => api.delete(wsPath(`/item-types/${type.id}`)!), 'Category deleted'))) onClose();
  };

  return (
    <Modal
      title={type ? `Edit ${type.name}` : 'New category'}
      size="lg"
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          {type && (
            <Button variant="danger" icon={Trash2} onClick={remove} disabled={busy}>
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            Save category
          </Button>
        </>
      }
    >
      <div className={styles.typePreview}>
        <TypeIcon icon={icon} tone={color} size="lg" toned />
        <strong>{name || 'New category'}</strong>
      </div>
      <FormGrid>
        <TextField label="Name *" value={name} onChange={setName} autoFocus={!type} placeholder="e.g. Resin, Drill bit, Timber" />
        <SelectField label="Usually measured in" value={defaultUnitId} onChange={setDefaultUnitId} hint="Weight, length or count: new items start with this unit.">
          <option value="">No default</option>
          {catalog.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.symbol})
            </option>
          ))}
        </SelectField>
      </FormGrid>
      <TonePicker label="Colour" value={color} onChange={setColor} />
      <IconPicker label="Icon" value={icon} onChange={setIcon} />
      <Checkbox label="Track tool life" hint="For tooling that wears: jobs add hours of use, and items are flagged when they reach their expected life." checked={tracksLife} onChange={setTracksLife} />

      <div className={styles.fields}>
        <SectionTitle
          count={fields.length}
          action={
            <Button size="sm" icon={Plus} onClick={addField}>
              Add field
            </Button>
          }
        >
          Fields
        </SectionTitle>
        <Muted>The details you record for every item of this category.</Muted>
        {fields.map((field, index) => (
          <div key={field.uid} className={styles.fieldCard}>
            <div className={styles.fieldTop}>
              <TextField label="Label" value={field.label} onChange={(label) => patch(field.uid, { label })} />
              <SelectField label="Type" value={field.fieldType} onChange={(value) => patch(field.uid, { fieldType: value as FieldType })} disabled={Boolean(field.id)} hint={field.id ? 'Fixed once created.' : undefined}>
                {FIELD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </SelectField>
              {field.fieldType === 'number' && <TextField label="Unit" value={field.unit} onChange={(unit) => patch(field.uid, { unit })} placeholder="mm" />}
            </div>
            {field.fieldType === 'select' && <TextField label="Choices, separated by commas" value={field.optionsText} onChange={(optionsText) => patch(field.uid, { optionsText })} placeholder="Small, Medium, Large" />}
            <div className={styles.fieldFlags}>
              <Checkbox label="Required" checked={field.required} onChange={(required) => patch(field.uid, { required })} />
              <Checkbox label="Show in lists" checked={field.showInList} onChange={(showInList) => patch(field.uid, { showInList })} />
              {field.fieldType === 'number' && <Checkbox label="Size of the piece" hint="Enables the will-it-fit search." checked={field.isSizeDimension} onChange={(isSizeDimension) => patch(field.uid, { isSizeDimension })} />}
              <span className={styles.fieldTools}>
                <IconButton icon={ArrowUp} label="Move up" size="sm" disabled={index === 0} onClick={() => move(index, -1)} />
                <IconButton icon={ArrowDown} label="Move down" size="sm" disabled={index === fields.length - 1} onClick={() => move(index, 1)} />
                <IconButton icon={Trash2} label={`Remove ${field.label || 'field'}`} size="sm" onClick={() => setFields((current) => current.filter((f) => f.uid !== field.uid))} />
              </span>
            </div>
          </div>
        ))}
        {type && fields.length < type.fields.length && <Muted>Removing a field hides its values on existing items.</Muted>}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </Modal>
  );
}
