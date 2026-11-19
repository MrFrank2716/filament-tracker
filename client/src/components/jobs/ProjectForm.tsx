import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, ErrorNote, Figure, Muted, SectionTitle } from '@/components/ui/Display';
import { FormGrid, NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/Form';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { useAction } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import { api } from '@/lib/api';
import { formatNumber, parseNumber } from '@/lib/format';
import { JOB_STATUS, PROJECT_STAGE, PROJECT_STAGES } from '@/lib/status';
import type { Job, Project, ProjectStage } from '@/lib/types';
import styles from '@/components/jobs/Jobs.module.css';

const MAX_MARGIN = 95;

interface Props {
  /** Leave out to make a new project. */
  project?: Project;
  /** Every job in the workspace, to pick from. */
  jobs: Job[];
  /** The stage the project was dragged to, when it needs a price first. */
  wantStage?: ProjectStage;
  onOpenJob: (id: string) => void;
  onClose: () => void;
}

/** Make a project, or open one: its details, its jobs, and what it cost against what it was invoiced for. */
export function ProjectForm({ project, jobs, wantStage, onOpenJob, onClose }: Props) {
  const { canEdit, canOperate, wsPath, money, workspace } = useWorkspace();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [name, setName] = useState(project?.name ?? '');
  const [customer, setCustomer] = useState(project?.customer ?? '');
  const [notes, setNotes] = useState(project?.notes ?? '');
  const [price, setPrice] = useState(project?.price != null ? String(project.price) : '');
  const [margin, setMargin] = useState(project?.marginPercent != null ? String(project.marginPercent) : '');
  const [stage, setStage] = useState<ProjectStage>(wantStage ?? project?.stage ?? 'open');
  const [error, setError] = useState(wantStage ? `Enter the invoiced price to mark this project ${PROJECT_STAGE[wantStage].label.toLowerCase()}.` : '');

  const workspaceMargin = workspace?.targetMargin ?? 40;
  const totals = project?.totals;
  // The figures follow what is typed, before it is saved.
  const typedPrice = price.trim() ? parseNumber(price) : null;
  const typedMargin = margin.trim() ? parseNumber(margin) : null;
  const marginInUse = Math.min(Math.max(typedMargin ?? workspaceMargin, 0), MAX_MARGIN);
  const cost = totals?.cost ?? 0;
  const recommended = cost / (1 - marginInUse / 100);
  const profit = typedPrice == null ? null : typedPrice - cost;

  const save = async () => {
    setError('');
    if (!name.trim()) return setError('Give the project a name.');
    if (price.trim() && (typedPrice == null || typedPrice < 0)) return setError('The invoiced price must be a number.');
    if (margin.trim() && (typedMargin == null || typedMargin < 0 || typedMargin > MAX_MARGIN)) return setError(`The target margin must be between 0 and ${MAX_MARGIN}%.`);
    if (canEdit && stage !== 'open' && typedPrice == null) return setError(`Enter the invoiced price to mark this project ${PROJECT_STAGE[stage].label.toLowerCase()}.`);
    const details = { name: name.trim(), customer: customer.trim(), notes };
    const ok = await run(async () => {
      const saved = project ? await api.patch<Project>(wsPath(`/projects/${project.id}`)!, details) : await api.post<Project>(wsPath('/projects')!, details);
      // Price, margin and stage are for admins; a new project starts open and unpriced.
      if (project && canEdit) await api.put(wsPath(`/projects/${saved.id}/pricing`)!, { price: typedPrice ?? null, marginPercent: typedMargin ?? null, stage });
    }, project ? 'Project saved' : 'Project added');
    if (ok) onClose();
  };

  const assign = (jobId: string, projectId: string | null, message: string) => void run(() => api.put(wsPath(`/jobs/${jobId}/project`)!, { projectId }), message);

  const remove = async () => {
    if (!project) return;
    const ok = await confirm({
      title: 'Delete project?',
      message: `"${project.name}" will be removed. Its ${project.jobs.length === 1 ? 'job stays' : 'jobs stay'}, with no project.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok && (await run(() => api.delete(wsPath(`/projects/${project.id}`)!), 'Project deleted'))) onClose();
  };

  // Jobs not in a project come first; one from another project can be moved over.
  const addable = jobs
    .filter((job) => job.project?.id !== project?.id && job.status !== 'cancelled')
    .sort((a, b) => Number(Boolean(a.project)) - Number(Boolean(b.project)));

  return (
    <Modal
      title={project ? project.name : 'New project'}
      size={project ? 'lg' : 'md'}
      onClose={onClose}
      onSubmit={canOperate ? save : undefined}
      footer={
        canOperate ? (
          <>
            {project && canEdit && (
              <Button variant="danger" icon={Trash2} onClick={remove} disabled={busy}>
                Delete
              </Button>
            )}
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {project ? 'Save' : 'Add project'}
            </Button>
          </>
        ) : undefined
      }
    >
      <FormGrid>
        <TextField label="Project name *" value={name} onChange={setName} wide autoFocus={!project} disabled={!canOperate} placeholder="What the work is" />
        <TextField label="Customer" value={customer} onChange={setCustomer} wide disabled={!canOperate} placeholder="Who it is for" />
        <TextAreaField label="Notes" value={notes} onChange={setNotes} rows={2} disabled={!canOperate} />
      </FormGrid>

      {project && totals && (
        <>
          <div>
            <SectionTitle count={project.jobs.length}>Jobs</SectionTitle>
            {project.jobs.length === 0 ? (
              <Muted>No jobs yet. Add the jobs done for this project to see what it cost.</Muted>
            ) : (
              <ul className={styles.usageList}>
                {project.jobs.map((job) => (
                  <li key={job.id} className={styles.projectJob}>
                    <button type="button" className={styles.projectJobName} onClick={() => onOpenJob(job.id)}>
                      {job.name}
                    </button>
                    <Badge tone={JOB_STATUS[job.status].tone}>{JOB_STATUS[job.status].label}</Badge>
                    <Figure>{money(job.totalCost)}</Figure>
                    {canOperate && <IconButton icon={X} size="sm" label={`Take ${job.name} out of this project`} disabled={busy} onClick={() => assign(job.id, null, `${job.name} taken out of ${project.name}`)} />}
                  </li>
                ))}
              </ul>
            )}
            {canOperate && addable.length > 0 && (
              <FormGrid>
                <SelectField
                  label="Add a job"
                  value=""
                  wide
                  disabled={busy}
                  onChange={(jobId) => {
                    const job = jobs.find((j) => j.id === jobId);
                    if (job) assign(job.id, project.id, `${job.name} added to ${project.name}`);
                  }}
                >
                  <option value="">Choose a job</option>
                  {addable.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.name} · {JOB_STATUS[job.status].label}
                      {job.project ? ` · now in ${job.project.name}` : ''}
                    </option>
                  ))}
                </SelectField>
              </FormGrid>
            )}
          </div>

          {canEdit && (
            <FormGrid>
              <NumberField
                label={`Invoiced price (${workspace?.currency ?? ''})`}
                value={price}
                onChange={setPrice}
                placeholder="Not priced yet"
                hint="What you charge for the whole project. Leave empty to see a recommended price."
              />
              <NumberField
                label="Target margin"
                value={margin}
                onChange={setMargin}
                suffix="%"
                placeholder={formatNumber(workspaceMargin, 1)}
                hint={`The share of the price you want left as profit. Leave empty to use the workspace's ${formatNumber(workspaceMargin, 1)}%.`}
              />
              <SelectField label="Stage" value={stage} onChange={(value) => setStage(value as ProjectStage)}>
                {PROJECT_STAGES.map((value) => (
                  <option key={value} value={value}>
                    {PROJECT_STAGE[value].label}
                  </option>
                ))}
              </SelectField>
            </FormGrid>
          )}

          <dl className={styles.costs}>
            <div><dt>{totals.estimated ? 'Estimated cost' : 'Cost'}</dt><dd><Figure>{money(cost)}</Figure></dd></div>
            {typedPrice == null || profit == null ? (
              <div className={styles.total}>
                <dt>Recommended price</dt>
                <dd><Figure tone="accent">{money(recommended)}</Figure></dd>
                <dd><Muted>for a {formatNumber(marginInUse, 1)}% margin</Muted></dd>
              </div>
            ) : (
              <>
                <div><dt>Recommended price</dt><dd><Figure>{money(recommended)}</Figure></dd></div>
                <div><dt>Invoiced price</dt><dd><Figure>{money(typedPrice)}</Figure></dd></div>
                <div className={styles.total}>
                  <dt>{profit < 0 ? 'Loss' : 'Profit'}</dt>
                  <dd><Figure tone={profit < 0 ? 'danger' : 'ok'}>{money(Math.abs(profit))}</Figure></dd>
                  {typedPrice > 0 && <dd><Muted>{formatNumber((profit / typedPrice) * 100, 1)}% margin</Muted></dd>}
                </div>
              </>
            )}
          </dl>
          {totals.estimated && <Muted>Some jobs are still open, so the cost is an estimate until they finish.</Muted>}
        </>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
    </Modal>
  );
}
