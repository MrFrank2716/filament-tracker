import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, LogOut, MapPin, Plus, Ruler, Shapes, Trash2, Truck } from 'lucide-react';
import { CrudSection } from '@/components/settings/CrudSection';
import { DataSection } from '@/components/settings/DataSection';
import { MembersSection } from '@/components/settings/MembersSection';
import { RequestLinkSection } from '@/components/settings/RequestLinkSection';
import { TypeEditor } from '@/components/settings/TypeEditor';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorNote, Figure, List, Loading, Muted, PageHeader, Row, SectionTitle, TypeIcon } from '@/components/ui/Display';
import { FormGrid, SelectField, TextAreaField, TextField } from '@/components/ui/Form';
import { useConfirm } from '@/components/ui/Modal';
import { useAction } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useCatalog } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import { flattenLocations, locationPath } from '@/lib/format';
import type { ItemType } from '@/lib/types';
import styles from '@/components/settings/Settings.module.css';

type Tab = 'general' | 'categories' | 'units' | 'machineTypes' | 'locations' | 'suppliers' | 'members' | 'requests' | 'data';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'general', label: 'Workspace' },
  { id: 'categories', label: 'Categories' },
  { id: 'units', label: 'Units' },
  { id: 'machineTypes', label: 'Machine types' },
  { id: 'locations', label: 'Locations' },
  { id: 'suppliers', label: 'Suppliers' },
  { id: 'members', label: 'Members' },
  { id: 'requests', label: 'Job requests' },
  { id: 'data', label: 'Import / export' },
];

export function SettingsPage() {
  const { canEdit } = useWorkspace();
  const catalog = useCatalog();
  // Other screens can link straight to a section: /settings?tab=requests
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => TABS.find((t) => t.id === params.get('tab'))?.id ?? 'general');
  const [typeEditor, setTypeEditor] = useState<{ type?: ItemType } | null>(null);

  const locationOptions = useMemo(
    () => flattenLocations(catalog.locations).map((l) => ({ value: l.id, label: `${'  '.repeat(l.depth)}${l.name}` })),
    [catalog.locations],
  );
  const orderedLocations = useMemo(() => flattenLocations(catalog.locations), [catalog.locations]);

  if (catalog.error) return <ErrorNote>{catalog.error}</ErrorNote>;
  if (catalog.loading) return <Loading />;

  return (
    <>
      <PageHeader title="Settings" subtitle="Categories, units, places and people for this workspace." />

      <div className={styles.layout}>
      {/* Nine sections do not fit a tab strip on a phone: a list down the side on wide screens, a select on narrow ones. */}
      <nav className={styles.rail} aria-label="Settings sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`${styles.railLink} ${t.id === tab ? styles.railActive : ''}`} aria-current={t.id === tab ? 'true' : undefined} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className={styles.sectionSelect}>
        <SelectField label="Section" value={tab} onChange={(value) => setTab(value as Tab)}>
          {TABS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </SelectField>
      </div>

      <div className={styles.section}>
        {tab === 'general' && <GeneralSection />}

        {tab === 'categories' && (
          <>
            <SectionTitle
              count={catalog.types.length}
              action={
                canEdit && (
                  <Button size="sm" icon={Plus} onClick={() => setTypeEditor({})}>
                    Add category
                  </Button>
                )
              }
            >
              Item categories
            </SectionTitle>
            <Muted>Each category has its own fields. Add one for anything you stock: resin, timber, drill bits, PPE, electronics.</Muted>
            {catalog.types.length === 0 ? (
              <EmptyState icon={Shapes} title="No categories yet">
                Create a category before adding items.
              </EmptyState>
            ) : (
              <List>
                {catalog.types.map((type) => (
                  <Row
                    key={type.id}
                    onClick={canEdit ? () => setTypeEditor({ type }) : undefined}
                    leading={<TypeIcon icon={type.icon} tone={type.color} toned />}
                    title={type.name}
                    subtitle={[type.tracksLife ? 'Tracks tool life' : '', type.fields.map((f) => f.label).join(', ') || 'No custom fields'].filter(Boolean).join(' · ')}
                    trailing={
                      <Muted>
                        <Figure>{type._count?.items ?? 0}</Figure> item{type._count?.items === 1 ? '' : 's'}
                      </Muted>
                    }
                  />
                ))}
              </List>
            )}
          </>
        )}

        {tab === 'units' && (
          <CrudSection
            title="Units"
            noun="unit"
            icon={Ruler}
            description="How quantities are measured: by weight, length, volume or count."
            rows={catalog.units}
            path="/units"
            fields={[
              { key: 'name', label: 'Name', required: true, placeholder: 'Kilograms' },
              { key: 'symbol', label: 'Symbol', required: true, placeholder: 'kg' },
              { key: 'decimals', label: 'Decimal places', kind: 'number', hint: '0 for whole numbers.' },
            ]}
            rowTitle={(unit) => `${unit.name} (${unit.symbol})`}
            rowSubtitle={(unit) => (unit.decimals ? `${unit.decimals} decimal place${unit.decimals === 1 ? '' : 's'}` : 'Whole numbers')}
          />
        )}

        {tab === 'machineTypes' && (
          <CrudSection
            title="Machine types"
            noun="machine type"
            icon={Building2}
            description="Group similar equipment. A maintenance task set on a type applies to every machine of that type."
            rows={catalog.machineTypes}
            path="/machine-types"
            fields={[
              { key: 'name', label: 'Name', required: true, placeholder: 'Lathe', wide: true },
              { key: 'icon', label: 'Icon', kind: 'icon' },
            ]}
            rowTitle={(type) => type.name}
            rowLeading={(type) => <TypeIcon icon={type.icon} />}
            rowSubtitle={(type) => {
              const count = catalog.machines.filter((m) => m.machineTypeId === type.id).length;
              return `${count} machine${count === 1 ? '' : 's'}`;
            }}
            deleteNote="Machines of this type keep working but lose the type, and maintenance tasks defined on the type are removed."
          />
        )}

        {tab === 'locations' && (
          <CrudSection
            title="Locations"
            noun="location"
            icon={MapPin}
            description="Rooms, shelves, drawers and bins, nested as deep as you like. The code is what you print on a QR or barcode label."
            rows={orderedLocations}
            path="/locations"
            fields={[
              { key: 'name', label: 'Name', required: true, placeholder: 'Shelf B' },
              { key: 'kind', label: 'Kind', placeholder: 'Room, shelf, bin…' },
              { key: 'parentId', label: 'Inside', kind: 'select', options: locationOptions },
              { key: 'code', label: 'Label code', placeholder: 'LOC-014', hint: 'Optional. For QR or barcode labels.' },
            ]}
            rowTitle={(location) => location.name}
            rowLeading={(location) => (location.depth > 0 ? <span className={`${styles.depth} ${styles[`depth-${Math.min(location.depth, 4)}`]}`} aria-hidden /> : undefined)}
            rowSubtitle={(location) => [location.kind, location.code, location.depth > 0 ? locationPath(location.parentId, catalog.locations) : ''].filter(Boolean).join(' · ')}
            deleteNote="Items and machines here will have no location. Locations inside it move up a level."
          />
        )}

        {tab === 'suppliers' && (
          <CrudSection
            title="Suppliers"
            noun="supplier"
            icon={Truck}
            description="Where you buy from. The reorder list is grouped by supplier."
            rows={catalog.suppliers}
            path="/suppliers"
            fields={[
              { key: 'name', label: 'Name', required: true, wide: true },
              { key: 'website', label: 'Website', placeholder: 'https://' },
              { key: 'email', label: 'Email' },
              { key: 'notes', label: 'Notes', kind: 'textarea' },
            ]}
            rowTitle={(supplier) => supplier.name}
            rowSubtitle={(supplier) => [supplier.website, supplier.email, supplier.notes].filter(Boolean).join(' · ')}
          />
        )}

        {tab === 'members' && <MembersSection />}
        {tab === 'requests' && <RequestLinkSection />}
        {tab === 'data' && <DataSection catalog={catalog} />}
      </div>
      </div>

      {typeEditor && <TypeEditor catalog={catalog} type={typeEditor.type} onClose={() => setTypeEditor(null)} />}
    </>
  );
}

function GeneralSection() {
  const { workspace, isOwner, wsPath, reload } = useWorkspace();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [name, setName] = useState(workspace?.name ?? '');
  const [description, setDescription] = useState(workspace?.description ?? '');
  const [currency, setCurrency] = useState(workspace?.currency ?? 'GBP');

  if (!workspace) return null;

  const save = () => run(async () => {
    await api.patch(wsPath('')!, { name: name.trim(), description: description.trim(), currency: currency.trim().toUpperCase() });
    await reload();
  }, 'Workspace saved');

  const leave = async () => {
    const ok = await confirm({ title: 'Leave workspace?', message: `You will lose access to "${workspace.name}" until an owner adds you again.`, confirmLabel: 'Leave', danger: true });
    if (ok && (await run(() => api.post(wsPath('/leave')!).then(reload), 'You left the workspace'))) navigate('/');
  };

  const destroy = async () => {
    const ok = await confirm({
      title: 'Delete this workspace?',
      message: `"${workspace.name}" and everything in it (inventory, machines, maintenance history, jobs) will be permanently deleted for every member. This cannot be undone. Export it first if you might want it back.`,
      confirmLabel: 'Delete workspace',
      danger: true,
    });
    if (ok && (await run(() => api.delete(wsPath('')!).then(reload), 'Workspace deleted'))) navigate('/');
  };

  return (
    <>
      <SectionTitle>Workspace</SectionTitle>
      <form
        className={styles.general}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <FormGrid>
          <TextField label="Name" value={name} onChange={setName} disabled={!isOwner} />
          <TextField label="Currency" value={currency} onChange={setCurrency} maxLength={3} disabled={!isOwner} hint="3-letter code, e.g. GBP, EUR, USD." />
          <TextAreaField label="Description" value={description} onChange={setDescription} rows={2} disabled={!isOwner} />
        </FormGrid>
        {isOwner ? (
          <div>
            <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
              Save
            </Button>
          </div>
        ) : (
          <Muted>Only an owner can change these.</Muted>
        )}
      </form>

      <SectionTitle>Leave or delete</SectionTitle>
      <div className={styles.danger}>
        <Button icon={LogOut} onClick={leave} disabled={busy}>
          Leave workspace
        </Button>
        {isOwner && (
          <Button variant="danger" icon={Trash2} onClick={destroy} disabled={busy}>
            Delete workspace
          </Button>
        )}
      </div>
    </>
  );
}
