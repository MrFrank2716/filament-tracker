import { useState } from 'react';
import { AccountSection } from '@/components/settings/AccountSection';
import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { NavigationSection } from '@/components/settings/NavigationSection';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, LogOut, Plus, Ruler, Shapes, Trash2, Truck } from 'lucide-react';
import { CrudSection } from '@/components/settings/CrudSection';
import { DataSection } from '@/components/settings/DataSection';
import { DevicesSection } from '@/components/settings/DevicesSection';
import { MembersSection } from '@/components/settings/MembersSection';
import { PrintersSection } from '@/components/settings/PrintersSection';
import { RequestLinkSection } from '@/components/settings/RequestLinkSection';
import { TypeEditor } from '@/components/settings/TypeEditor';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorNote, Figure, List, Muted, PageHeader, PageSkeleton, Row, SectionTitle, TypeIcon } from '@/components/ui/Display';
import { FormGrid, NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/Form';
import { useConfirm } from '@/components/ui/Modal';
import { useAction } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useCatalog } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import { parseNumber } from '@/lib/format';
import { LegalLinks } from '@/pages/LegalPages';
import type { ItemType } from '@/lib/types';
import styles from '@/components/settings/Settings.module.css';

type Tab = 'general' | 'lists' | 'members' | 'printers' | 'devices' | 'requests' | 'data' | 'appearance' | 'navigation' | 'account';

/** Workspace sections are shared by every member; the personal ones belong to whoever is signed in. */
const TABS: Array<{ id: Tab; label: string; personal?: boolean }> = [
  { id: 'general', label: 'Workspace' },
  { id: 'lists', label: 'Lists' },
  { id: 'members', label: 'Members' },
  { id: 'printers', label: 'Printers' },
  { id: 'devices', label: 'Displays' },
  { id: 'requests', label: 'Job requests' },
  { id: 'data', label: 'Import / export' },
  { id: 'appearance', label: 'Appearance', personal: true },
  { id: 'navigation', label: 'Navigation', personal: true },
  { id: 'account', label: 'Your account', personal: true },
];

/** Categories, units, machine types and suppliers used to be tabs of their own; old links still land on the combined one. */
const LEGACY_TABS: Record<string, Tab> = { categories: 'lists', units: 'lists', machineTypes: 'lists', suppliers: 'lists' };

const GROUPS = [
  { label: 'This workspace', tabs: TABS.filter((t) => !t.personal) },
  { label: 'You', tabs: TABS.filter((t) => t.personal) },
];

export function SettingsPage() {
  const { canEdit } = useWorkspace();
  const catalog = useCatalog();
  // Other screens can link straight to a section: /settings?tab=requests
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => TABS.find((t) => t.id === (LEGACY_TABS[params.get('tab') ?? ''] ?? params.get('tab')))?.id ?? 'general');
  const [typeEditor, setTypeEditor] = useState<{ type?: ItemType } | null>(null);

  // Locations used to be a section here; they have a page of their own now, and old links still land there.
  if (params.get('tab') === 'locations') return <Navigate to="/locations" replace />;
  if (catalog.error) return <ErrorNote>{catalog.error}</ErrorNote>;
  if (catalog.loading) return <PageSkeleton title="Settings" subtitle="Categories, units, suppliers and people for this workspace, and your own preferences." filters />;

  return (
    <>
      <PageHeader title="Settings" subtitle="Categories, units, suppliers and people for this workspace, and your own preferences." />

      <div className={styles.layout}>
      {/* This many sections do not fit a tab strip on a phone: a list down the side on wide screens, a select on narrow ones. */}
      <nav className={styles.rail} aria-label="Settings sections">
        {GROUPS.map((group) => (
          <div key={group.label} className={styles.railGroup} role="group" aria-label={group.label}>
            <span className={styles.railHeading}>{group.label}</span>
            {group.tabs.map((t) => (
              <button key={t.id} type="button" className={`${styles.railLink} ${t.id === tab ? styles.railActive : ''}`} aria-current={t.id === tab ? 'true' : undefined} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className={styles.sectionSelect}>
        <SelectField label="Section" value={tab} onChange={(value) => setTab(value as Tab)}>
          {GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.tabs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </SelectField>
      </div>

      <div className={styles.section}>
        {tab === 'general' && <GeneralSection />}

        {tab === 'lists' && (
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
          </>
        )}

        {tab === 'members' && <MembersSection />}
        {tab === 'printers' && <PrintersSection catalog={catalog} />}
        {tab === 'devices' && <DevicesSection catalog={catalog} />}
        {tab === 'requests' && <RequestLinkSection />}
        {tab === 'data' && <DataSection catalog={catalog} />}
        {tab === 'appearance' && (
          <>
            <SectionTitle>Appearance</SectionTitle>
            <AppearanceSection />
          </>
        )}
        {tab === 'navigation' && <NavigationSection />}
        {tab === 'account' && <AccountSection />}
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
  const [margin, setMargin] = useState(String(workspace?.targetMargin ?? 40));

  if (!workspace) return null;

  const targetMargin = parseNumber(margin);
  const marginOk = targetMargin !== null && targetMargin >= 0 && targetMargin <= 95;

  const save = () => run(async () => {
    await api.patch(wsPath('')!, { name: name.trim(), description: description.trim(), currency: currency.trim().toUpperCase(), targetMargin });
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
          <NumberField
            label="Target margin"
            value={margin}
            onChange={setMargin}
            suffix="%"
            disabled={!isOwner}
            hint="The share of a project's price you want left as profit, from 0 to 95. Used to recommend a price for projects that have none."
          />
          <TextAreaField label="Description" value={description} onChange={setDescription} rows={2} disabled={!isOwner} />
        </FormGrid>
        {isOwner ? (
          <div>
            <Button type="submit" variant="primary" disabled={busy || !name.trim() || !marginOk}>
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

      <SectionTitle>Legal</SectionTitle>
      <LegalLinks />
    </>
  );
}
