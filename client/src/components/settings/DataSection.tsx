import { useRef, useState } from 'react';
import { Download, FileJson, FileSpreadsheet, ListChecks, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, ErrorNote, Muted, SectionTitle } from '@/components/ui/Display';
import { Checkbox, SelectField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useAction, useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import type { Catalog } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import { EXPORT_PARTS, EXPORT_PART_INFO, droppedLinks, neededBy, toggleExportPart, type ExportPart } from '@/lib/exportParts';
import styles from '@/components/settings/Settings.module.css';

interface CsvResult {
  created: number;
  errors: Array<{ row: number; message: string }>;
}

const fileSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';

export function DataSection({ catalog }: { catalog: Catalog }) {
  const { workspace, wsPath, canEdit } = useWorkspace();
  const { run, busy } = useAction();
  const toast = useToast();
  const jsonInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const [defaultTypeId, setDefaultTypeId] = useState('');
  const [csvResult, setCsvResult] = useState<CsvResult | null>(null);
  const [jsonResult, setJsonResult] = useState<Record<string, number> | null>(null);
  /** The parts ticked in the "choose what to export" dialog; null while it is closed. */
  const [picking, setPicking] = useState<Set<ExportPart> | null>(null);

  if (!workspace) return null;
  const base = fileSlug(workspace.name);

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(await file.text());
    } catch {
      toast('That file is not valid JSON.', 'danger');
      return;
    }
    setJsonResult(null);
    await run(async () => {
      const { summary } = await api.post<{ summary: Record<string, number> }>(wsPath('/import')!, snapshot);
      setJsonResult(summary);
    }, 'Import finished');
  };

  const importCsv = async (file: File | undefined) => {
    if (!file) return;
    const csv = await file.text();
    setCsvResult(null);
    await run(async () => setCsvResult(await api.post<CsvResult>(wsPath('/import/items.csv')!, { csv, defaultTypeId: defaultTypeId || undefined })), 'Import finished');
  };

  return (
    <>
      <SectionTitle>Export</SectionTitle>
      <div className={styles.dataGrid}>
        <Card>
          <div className={styles.dataCard}>
            <FileJson size={22} aria-hidden />
            <strong>Whole workspace (JSON)</strong>
            <Muted>Categories, fields, units, locations, machines, inventory, maintenance, projects and jobs. Import it into another workspace or keep it as a backup.</Muted>
            <Button icon={Download} disabled={busy} onClick={() => run(() => api.download(wsPath('/export')!, `${base}.json`))}>
              Download JSON
            </Button>
            <Button icon={ListChecks} disabled={busy} onClick={() => setPicking(new Set(EXPORT_PARTS))}>
              Choose what to export
            </Button>
          </div>
        </Card>
        <Card>
          <div className={styles.dataCard}>
            <FileSpreadsheet size={22} aria-hidden />
            <strong>Inventory (CSV)</strong>
            <Muted>One row per item with a column for every custom field. Opens in any spreadsheet.</Muted>
            <Button icon={Download} disabled={busy} onClick={() => run(() => api.download(wsPath('/export/items.csv')!, `${base}-inventory.csv`))}>
              Download CSV
            </Button>
          </div>
        </Card>
      </div>

      {canEdit && (
        <>
          <SectionTitle>Import</SectionTitle>
          <div className={styles.dataGrid}>
            <Card>
              <div className={styles.dataCard}>
                <FileJson size={22} aria-hidden />
                <strong>Workspace file (JSON)</strong>
                <Muted>Merges into this workspace. Categories, units, suppliers and machines that already exist by name are reused; items, projects and jobs are added.</Muted>
                <input ref={jsonInput} type="file" accept="application/json,.json" className={styles.fileInput} onChange={(e) => { void importJson(e.target.files?.[0]); e.target.value = ''; }} />
                <Button icon={Upload} disabled={busy} onClick={() => jsonInput.current?.click()}>
                  Choose JSON file
                </Button>
                {jsonResult && (
                  <Muted>
                    Added:{' '}
                    {Object.entries(jsonResult)
                      .filter(([, count]) => count > 0)
                      .map(([key, count]) => `${count} ${key}`)
                      .join(', ') || 'nothing new'}
                  </Muted>
                )}
              </div>
            </Card>
            <Card>
              <div className={styles.dataCard}>
                <FileSpreadsheet size={22} aria-hidden />
                <strong>Items (CSV)</strong>
                <Muted>
                  Needs a <code>name</code> column. Optional: <code>type</code>, <code>quantity</code>, <code>unit</code>, <code>min_quantity</code>, <code>unit_cost</code>, <code>supplier</code>, <code>location</code>, <code>notes</code>, plus any custom field by its label.
                </Muted>
                <SelectField label="Category for rows without a type column" value={defaultTypeId} onChange={setDefaultTypeId}>
                  <option value="">None</option>
                  {catalog.types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </SelectField>
                <input ref={csvInput} type="file" accept="text/csv,.csv" className={styles.fileInput} onChange={(e) => { void importCsv(e.target.files?.[0]); e.target.value = ''; }} />
                <Button icon={Upload} disabled={busy} onClick={() => csvInput.current?.click()}>
                  Choose CSV file
                </Button>
                {csvResult && (
                  <>
                    <Muted>
                      {csvResult.created} item{csvResult.created === 1 ? '' : 's'} added{csvResult.errors.length ? `, ${csvResult.errors.length} row${csvResult.errors.length === 1 ? '' : 's'} skipped:` : '.'}
                    </Muted>
                    {csvResult.errors.length > 0 && (
                      <ErrorNote>
                        <ul>
                          {csvResult.errors.slice(0, 10).map((e) => (
                            <li key={e.row}>
                              Row {e.row}: {e.message}
                            </li>
                          ))}
                          {csvResult.errors.length > 10 && <li>…and {csvResult.errors.length - 10} more</li>}
                        </ul>
                      </ErrorNote>
                    )}
                  </>
                )}
              </div>
            </Card>
          </div>
        </>
      )}

      {picking && (
        <Modal
          title="Choose what to export"
          onClose={() => setPicking(null)}
          onSubmit={() =>
            void run(async () => {
              await api.download(`${wsPath('/export')!}?include=${[...picking].join(',')}`, `${base}-selection.json`);
              setPicking(null);
            })
          }
          footer={
            <>
              <Button onClick={() => setPicking(null)}>Cancel</Button>
              <Button type="submit" variant="primary" icon={Download} disabled={busy || picking.size === 0}>
                Download JSON
              </Button>
            </>
          }
        >
          <Muted>
            Tick the parts to put in the file. A part brings along what it points at, so the file still imports whole: inventory needs its
            categories, units, suppliers and locations.
          </Muted>
          <div className={styles.exportParts}>
            {EXPORT_PARTS.map((part) => {
              const info = EXPORT_PART_INFO[part];
              const users = neededBy(picking, part);
              return (
                <Checkbox
                  key={part}
                  label={info.label}
                  hint={users.length > 0 ? `${info.detail} Needed by ${users.map((user) => EXPORT_PART_INFO[user].label.toLowerCase()).join(', ')}.` : info.detail}
                  checked={picking.has(part)}
                  onChange={(on) => setPicking(toggleExportPart(picking, part, on))}
                />
              );
            })}
          </div>
          {droppedLinks(picking).map((note) => (
            <Muted key={note}>{note}</Muted>
          ))}
          <div className={styles.exportAll}>
            <Button size="sm" variant="ghost" onClick={() => setPicking(new Set(EXPORT_PARTS))} disabled={picking.size === EXPORT_PARTS.length}>
              Select all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicking(new Set())} disabled={picking.size === 0}>
              Clear
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
