import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, FileQuestion, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNote, Loading, Muted, SectionTitle, TypeIcon } from '@/components/ui/Display';
import { Checkbox, FormGrid, TextField } from '@/components/ui/Form';
import { useAction } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { api } from '@/lib/api';
import { iconFor } from '@/lib/icons';
import { useQuery } from '@/lib/store';
import type { Snapshot, Template, TemplateSummary, Workspace } from '@/lib/types';
import styles from '@/pages/NewWorkspacePage.module.css';

const BLANK = 'blank';
const CURRENCIES = ['GBP', 'EUR', 'USD', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'JPY', 'INR', 'AED', 'SAR', 'ZAR'];

/** Apply the user's ticks to a template before it is sent: unticked rows are simply left out. */
function trimSnapshot(snapshot: Snapshot, excluded: Set<string>, includeSamples: boolean): Snapshot {
  const keep = <T extends { ref: string }>(rows: T[]) => rows.filter((row) => !excluded.has(row.ref));
  const tasks = keep(snapshot.maintenanceTasks).filter((task) => includeSamples || !task.machine);
  if (includeSamples) return { ...snapshot, itemTypes: keep(snapshot.itemTypes), machineTypes: keep(snapshot.machineTypes), maintenanceTasks: tasks };
  return {
    ...snapshot,
    itemTypes: keep(snapshot.itemTypes),
    machineTypes: keep(snapshot.machineTypes),
    maintenanceTasks: tasks.map((task) => ({ ...task, logs: [] })),
    suppliers: [],
    locations: [],
    machines: [],
    items: [],
    subUnits: [],
    jobs: [],
  };
}

export function NewWorkspacePage() {
  const { logout } = useAuth();
  const { workspaces, reload, select } = useWorkspace();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const { data: templates, error } = useQuery<TemplateSummary[]>('/templates');

  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('GBP');
  const [templateId, setTemplateId] = useState<string>(BLANK);
  const [template, setTemplate] = useState<Template | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [includeSamples, setIncludeSamples] = useState(true);

  useEffect(() => {
    setTemplate(null);
    setExcluded(new Set());
    setIncludeSamples(true);
    if (templateId === BLANK) return;
    let cancelled = false;
    api.get<Template>(`/templates/${templateId}`).then((loaded) => {
      if (!cancelled) setTemplate(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const toggle = (ref: string) =>
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });

  const typeTasks = useMemo(() => template?.snapshot.maintenanceTasks.filter((t) => !t.machine) ?? [], [template]);
  const first = workspaces.length === 0;

  const create = () =>
    run(async () => {
      const created = await api.post<Workspace>('/workspaces', {
        name: name.trim(),
        currency: currency.trim().toUpperCase() || 'GBP',
        snapshot: template ? trimSnapshot(template.snapshot, excluded, includeSamples) : undefined,
      });
      await reload();
      select(created.id);
      navigate('/');
    }, 'Workspace created');

  return (
    <main className={styles.page}>
      <form
        className={styles.panel}
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <header className={styles.header}>
          {first ? (
            <Button variant="ghost" size="sm" icon={LogOut} onClick={logout}>
              Sign out
            </Button>
          ) : (
            <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => navigate('/')}>
              Back
            </Button>
          )}
          <h1 className={styles.title}>{first ? 'Set up your first workspace' : 'New workspace'}</h1>
          <p className={styles.lead}>
            A workspace is one environment: a home workshop, a school lab, a club or a shop floor. Each has its own machines, stock, locations and members.
          </p>
        </header>

        <FormGrid>
          <TextField label="Workspace name" value={name} onChange={setName} placeholder="e.g. Garage workshop" required autoFocus />
          <TextField label="Currency" value={currency} onChange={setCurrency} list="currency-codes" maxLength={3} hint="3-letter code, used for costs." />
          <datalist id="currency-codes">
            {CURRENCIES.map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
        </FormGrid>

        <section className={styles.section}>
          <SectionTitle>Start from</SectionTitle>
          <Muted>Templates only pre-fill categories and sample schedules. Everything stays editable afterwards, or start blank and define your own.</Muted>
          {error && <ErrorNote>{error}</ErrorNote>}
          {!templates && !error && <Loading />}
          <div className={styles.templates} role="radiogroup" aria-label="Template">
            <TemplateCard
              selected={templateId === BLANK}
              onSelect={() => setTemplateId(BLANK)}
              icon="FileQuestion"
              name="Blank"
              description="Skip the template. Add your own categories, units and machines."
              blank
            />
            {templates?.map((t) => (
              <TemplateCard key={t.id} selected={templateId === t.id} onSelect={() => setTemplateId(t.id)} icon={t.icon} name={t.name} description={t.description} sample={t.sampleData} />
            ))}
          </div>
        </section>

        {templateId !== BLANK && !template && <Loading label="Loading template" />}

        {template && (
          <section className={styles.section}>
            <SectionTitle>Adjust what gets created</SectionTitle>
            <Muted>Untick anything you do not need.</Muted>

            {template.sampleData && (
              <Checkbox
                label="Include sample machines, inventory and history"
                hint={`${template.snapshot.machines.length} machines and ${template.snapshot.items.length} items to explore. Turn off to keep only the configuration.`}
                checked={includeSamples}
                onChange={setIncludeSamples}
              />
            )}

            <PickGroup title="Item categories">
              {template.snapshot.itemTypes.map((type) => (
                <PickRow key={type.ref} checked={!excluded.has(type.ref)} onToggle={() => toggle(type.ref)} title={type.name} detail={type.fields.map((f) => f.label).join(', ')} leading={<TypeIcon icon={type.icon} tone={type.color} size="sm" toned />} />
              ))}
            </PickGroup>

            <PickGroup title="Machine types">
              {template.snapshot.machineTypes.map((type) => (
                <PickRow key={type.ref} checked={!excluded.has(type.ref)} onToggle={() => toggle(type.ref)} title={type.name} leading={<TypeIcon icon={type.icon} size="sm" />} />
              ))}
            </PickGroup>

            {typeTasks.length > 0 && (
              <PickGroup title="Sample maintenance schedules">
                {typeTasks.map((task) => {
                  const machineType = template.snapshot.machineTypes.find((m) => m.ref === task.machineType);
                  const interval = [task.intervalDays ? `every ${task.intervalDays} days` : '', task.intervalHours ? `every ${task.intervalHours} h of use` : ''].filter(Boolean).join(' or ');
                  return (
                    <PickRow
                      key={task.ref}
                      checked={!excluded.has(task.ref) && !excluded.has(task.machineType ?? '')}
                      disabled={excluded.has(task.machineType ?? '')}
                      onToggle={() => toggle(task.ref)}
                      title={task.name}
                      detail={`${machineType?.name ?? 'Machine'} · ${interval}`}
                    />
                  );
                })}
              </PickGroup>
            )}
          </section>
        )}

        <footer className={styles.footer}>
          <Button type="submit" variant="primary" size="lg" icon={Check} disabled={busy || !name.trim() || (templateId !== BLANK && !template)}>
            Create workspace
          </Button>
        </footer>
      </form>
    </main>
  );
}

function TemplateCard({ selected, onSelect, icon, name, description, sample, blank }: { selected: boolean; onSelect: () => void; icon: string; name: string; description: string; sample?: boolean; blank?: boolean }) {
  const Icon = blank ? FileQuestion : iconFor(icon);
  return (
    <button type="button" role="radio" aria-checked={selected} className={`${styles.template} ${selected ? styles.templateSelected : ''}`} onClick={onSelect}>
      <span className={styles.templateIcon} aria-hidden>
        <Icon size={20} />
      </span>
      <span className={styles.templateName}>
        {name}
        {sample && <span className={styles.sampleTag}>sample data</span>}
      </span>
      <span className={styles.templateText}>{description}</span>
    </button>
  );
}

function PickGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.group}>
      <h3 className={styles.groupTitle}>{title}</h3>
      <div className={styles.groupRows}>{children}</div>
    </div>
  );
}

function PickRow({ checked, onToggle, title, detail, leading, disabled }: { checked: boolean; onToggle: () => void; title: string; detail?: string; leading?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`${styles.pick} ${disabled ? styles.pickDisabled : ''}`}>
      <input type="checkbox" className={styles.pickInput} checked={checked} disabled={disabled} onChange={onToggle} />
      {leading}
      <span className={styles.pickText}>
        <span className={styles.pickTitle}>{title}</span>
        {detail && <span className={styles.pickDetail}>{detail}</span>}
      </span>
    </label>
  );
}
