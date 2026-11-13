import { useState, type ReactNode } from 'react';
import { Plus, Trash2, type LucideIcon } from 'lucide-react';
import { IconPicker } from '@/components/settings/IconPicker';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorNote, List, Muted, Row, SectionTitle } from '@/components/ui/Display';
import { FormGrid, NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/Form';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { useAction } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import { api } from '@/lib/api';
import { parseNumber } from '@/lib/format';

export interface CrudField {
  key: string;
  label: string;
  kind?: 'text' | 'number' | 'select' | 'icon' | 'textarea';
  options?: Array<{ value: string; label: string }>;
  hint?: string;
  placeholder?: string;
  required?: boolean;
  wide?: boolean;
}

interface Props<T extends { id: string }> {
  title: string;
  description: string;
  /** Singular noun, e.g. "unit". */
  noun: string;
  icon: LucideIcon;
  rows: T[];
  /** Collection path within the workspace, e.g. "/units". */
  path: string;
  fields: CrudField[];
  rowTitle: (row: T) => ReactNode;
  rowSubtitle?: (row: T) => string;
  rowLeading?: (row: T) => ReactNode;
  deleteNote?: string;
}

type Draft = Record<string, string>;

/** List + add/edit/delete dialog for a simple user-defined collection. */
export function CrudSection<T extends { id: string }>({ title, description, noun, icon, rows, path, fields, rowTitle, rowSubtitle, rowLeading, deleteNote }: Props<T>) {
  const { canEdit, wsPath } = useWorkspace();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<{ row?: T; draft: Draft } | null>(null);
  const [error, setError] = useState('');

  const openFor = (row?: T) => {
    const draft: Draft = {};
    for (const field of fields) {
      const value = row ? (row as Record<string, unknown>)[field.key] : undefined;
      draft[field.key] = value === null || value === undefined ? (field.kind === 'icon' ? 'Package' : '') : String(value);
    }
    setError('');
    setEditing({ row, draft });
  };

  const set = (key: string, value: string) => setEditing((current) => (current ? { ...current, draft: { ...current.draft, [key]: value } } : current));

  const save = async () => {
    if (!editing) return;
    const body: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = editing.draft[field.key] ?? '';
      if (field.required && !raw.trim()) return setError(`${field.label} is required.`);
      if (field.kind === 'number') body[field.key] = parseNumber(raw) ?? 0;
      else if (field.kind === 'select') body[field.key] = raw || null;
      else body[field.key] = raw.trim();
    }
    const { row } = editing;
    const ok = await run(() => (row ? api.patch(wsPath(`${path}/${row.id}`)!, body) : api.post(wsPath(path)!, body)), 'Saved');
    if (ok) setEditing(null);
  };

  const remove = async () => {
    const row = editing?.row;
    if (!row) return;
    const ok = await confirm({ title: `Delete this ${noun}?`, message: deleteNote ?? `Anything using it will simply have no ${noun} set.`, confirmLabel: 'Delete', danger: true });
    if (ok && (await run(() => api.delete(wsPath(`${path}/${row.id}`)!), 'Deleted'))) setEditing(null);
  };

  return (
    <>
      <SectionTitle
        count={rows.length}
        action={
          canEdit && (
            <Button size="sm" icon={Plus} onClick={() => openFor()}>
              Add {noun}
            </Button>
          )
        }
      >
        {title}
      </SectionTitle>
      <Muted>{description}</Muted>

      {rows.length === 0 ? (
        <EmptyState icon={icon} title={`No ${title.toLowerCase()} yet`} />
      ) : (
        <List>
          {rows.map((row) => (
            <Row key={row.id} onClick={canEdit ? () => openFor(row) : undefined} leading={rowLeading?.(row)} title={rowTitle(row)} subtitle={rowSubtitle?.(row)} />
          ))}
        </List>
      )}

      {editing && (
        <Modal
          title={editing.row ? `Edit ${noun}` : `Add ${noun}`}
          onClose={() => setEditing(null)}
          onSubmit={save}
          footer={
            <>
              {editing.row && (
                <Button variant="danger" icon={Trash2} onClick={remove} disabled={busy}>
                  Delete
                </Button>
              )}
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={busy}>
                Save
              </Button>
            </>
          }
        >
          <FormGrid>
            {fields.map((field, index) => {
              const value = editing.draft[field.key] ?? '';
              const label = field.required ? `${field.label} *` : field.label;
              const common = { label, value, hint: field.hint, onChange: (next: string) => set(field.key, next) };
              if (field.kind === 'number') return <NumberField key={field.key} {...common} />;
              if (field.kind === 'textarea') return <TextAreaField key={field.key} {...common} />;
              if (field.kind === 'icon') return <IconPicker key={field.key} label={field.label} value={value} onChange={(next) => set(field.key, next)} />;
              if (field.kind === 'select') {
                return (
                  <SelectField key={field.key} {...common} wide={field.wide}>
                    <option value="">None</option>
                    {/* A row cannot be its own parent. */}
                    {field.options?.filter((o) => o.value !== editing.row?.id).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </SelectField>
                );
              }
              return <TextField key={field.key} {...common} wide={field.wide} placeholder={field.placeholder} autoFocus={index === 0 && !editing.row} />;
            })}
          </FormGrid>
          {error && <ErrorNote>{error}</ErrorNote>}
        </Modal>
      )}
    </>
  );
}
