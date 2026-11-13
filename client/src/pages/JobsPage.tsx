import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Ban, Check, ClipboardList, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { JobForm } from '@/components/jobs/JobForm';
import { RequestFiles, RequestQueue } from '@/components/requests/RequestQueue';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, ErrorNote, Figure, List, Loading, Muted, PageHeader, Row, SectionTitle, Tabs } from '@/components/ui/Display';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { useAction } from '@/components/ui/Toast';
import { useMachineFocus } from '@/context/FocusContext';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import { useCatalog, useItems } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import { formatDate, formatHours, formatQuantity } from '@/lib/format';
import { JOB_STATUS } from '@/lib/status';
import type { Job, JobRequest, RequestLink } from '@/lib/types';
import styles from '@/components/jobs/Jobs.module.css';

type Tab = 'open' | 'requests' | 'history';
const isOpen = (job: Job) => job.status === 'planned' || job.status === 'in_progress';

export function JobsPage() {
  const { canEdit, wsPath, money } = useWorkspace();
  const catalog = useCatalog();
  const { items } = useItems();
  const { data: allJobs, error } = useWsQuery<Job[]>('/jobs');
  const { data: allRequests } = useWsQuery<JobRequest[]>('/job-requests');
  const { data: requestLink } = useWsQuery<RequestLink>('/request-link');
  const { machine } = useMachineFocus();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('open');
  const [viewId, setViewId] = useState<string | null>(null);
  const [form, setForm] = useState<{ job?: Job } | null>(null);

  // A link can ask for a tab (the daily report points at the request queue): /jobs?tab=requests
  const [params] = useSearchParams();
  const askedTab = params.get('tab');
  useEffect(() => {
    if (askedTab === 'open' || askedTab === 'requests' || askedTab === 'history') setTab(askedTab);
  }, [askedTab]);

  if (error || catalog.error) return <ErrorNote>{error ?? catalog.error}</ErrorNote>;
  if (!allJobs || catalog.loading) return <Loading />;

  // With one machine in focus: its jobs, and the requests that asked for it.
  const jobs = machine ? allJobs.filter((job) => job.machineId === machine.id) : allJobs;
  const requests = (allRequests ?? []).filter((request) => !machine || request.machine?.id === machine.id);
  const open = jobs.filter(isOpen);
  const history = jobs.filter((j) => !isOpen(j));
  const shown = tab === 'open' ? open : history;
  const viewing = allJobs.find((j) => j.id === viewId);

  const act = (job: Job, action: 'start' | 'finish' | 'cancel', body: object, message: string, close = true) =>
    run(() => api.post(wsPath(`/jobs/${job.id}/${action}`)!, body), message).then((ok) => {
      if (ok && close) setViewId(null);
    });

  const fail = async (job: Job) => {
    const ok = await confirm({
      title: 'Mark as failed?',
      message: 'The materials and tool hours on this job are still taken from stock, because a failed run uses them up too. Edit the quantities first if less was used.',
      confirmLabel: 'Mark failed',
      danger: true,
    });
    if (ok) await act(job, 'finish', { outcome: 'failed' }, 'Marked as failed. Stock updated.');
  };

  const remove = async (job: Job) => {
    const ok = await confirm({
      title: 'Delete job?',
      message: isOpen(job) ? `"${job.name}" will be removed.` : `"${job.name}" will be removed from history. Stock it already used is not put back.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok && (await run(() => api.delete(wsPath(`/jobs/${job.id}`)!), 'Job deleted'))) setViewId(null);
  };

  return (
    <>
      <PageHeader
        title="Jobs"
        subtitle={machine ? `Jobs on ${machine.name}, and requests that asked for it.` : 'Finishing a job takes its material from stock and adds tool and machine hours.'}
        actions={
          canEdit && (
            <Button variant="primary" icon={Plus} onClick={() => setForm({})}>
              New job
            </Button>
          )
        }
      />

      <Tabs
        tabs={[
          { id: 'open', label: 'Open', count: open.length },
          { id: 'requests', label: 'Requests', count: requests.filter((request) => request.status === 'pending').length },
          { id: 'history', label: 'History', count: history.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'requests' ? (
        <RequestQueue requests={requests} link={requestLink} catalog={catalog} machineName={machine?.name} />
      ) : shown.length === 0 ? (
        <EmptyState icon={ClipboardList} title={tab === 'open' ? 'No open jobs' : 'No finished jobs yet'} action={canEdit && tab === 'open' && <Button variant="primary" icon={Plus} onClick={() => setForm({})}>New job</Button>}>
          {tab === 'open' ? 'Plan a job to check you have the material, or log one you have just finished.' : 'Finished, failed and cancelled jobs appear here with their cost.'}
        </EmptyState>
      ) : (
        <List>
          {shown.map((job) => {
            // An open job that would use more than is on the shelf needs sorting before it runs.
            const short = isOpen(job) ? job.usages.filter((usage) => usage.quantity > usage.item.quantity) : [];
            const context = [job.machine?.name, formatHours(job.durationHours), formatDate(job.completedAt ?? job.createdAt), job.request ? `for ${job.request.requesterName}` : ''].filter(Boolean).join(' · ');
            return (
              <Row
                key={job.id}
                onClick={() => setViewId(job.id)}
                flagged={short.length > 0 ? 'warn' : false}
                title={job.name}
                subtitle={short.length > 0 ? `Short: ${short.map((usage) => usage.item.name).join(', ')}` : context}
                trailing={
                  <>
                    <Figure>{money(job.totalCost)}</Figure>
                    <Badge tone={short.length > 0 ? 'warn' : JOB_STATUS[job.status].tone}>{short.length > 0 ? 'Short of stock' : JOB_STATUS[job.status].label}</Badge>
                  </>
                }
              />
            );
          })}
        </List>
      )}

      {viewing && !form && (
        <Modal
          title={viewing.name}
          size="lg"
          onClose={() => setViewId(null)}
          footer={
            canEdit ? (
              <>
                <Button variant="danger" icon={Trash2} onClick={() => remove(viewing)} disabled={busy}>
                  Delete
                </Button>
                {isOpen(viewing) && (
                  <>
                    <Button icon={Ban} onClick={() => act(viewing, 'cancel', {}, 'Job cancelled')} disabled={busy}>
                      Cancel job
                    </Button>
                    <Button icon={Pencil} onClick={() => setForm({ job: viewing })}>
                      Edit
                    </Button>
                    <Button icon={X} onClick={() => fail(viewing)} disabled={busy}>
                      Failed
                    </Button>
                    {viewing.status === 'planned' && (
                      <Button icon={Play} onClick={() => act(viewing, 'start', {}, 'Job started', false)} disabled={busy}>
                        Start
                      </Button>
                    )}
                    <Button variant="primary" icon={Check} onClick={() => act(viewing, 'finish', { outcome: 'completed' }, 'Job finished. Stock and tool life updated.')} disabled={busy}>
                      Finish
                    </Button>
                  </>
                )}
              </>
            ) : undefined
          }
        >
          <div className={styles.meta}>
            <Badge tone={JOB_STATUS[viewing.status].tone}>{JOB_STATUS[viewing.status].label}</Badge>
            {viewing.machine && <span>{viewing.machine.name}</span>}
            <Figure>{formatHours(viewing.durationHours)}</Figure>
            <Muted>
              {viewing.completedAt ? `Finished ${formatDate(viewing.completedAt)}` : `Created ${formatDate(viewing.createdAt)}`}
              {viewing.createdBy ? ` · ${viewing.createdBy.name}` : ''}
            </Muted>
          </div>
          {viewing.notes && <p className={styles.notes}>{viewing.notes}</p>}

          {viewing.request && (
            <div>
              <SectionTitle count={viewing.request.files.length}>Files from {viewing.request.requesterName}</SectionTitle>
              <RequestFiles requestId={viewing.request.id} files={viewing.request.files} />
            </div>
          )}

          <div>
            <SectionTitle count={viewing.usages.length}>Used</SectionTitle>
            {viewing.usages.length === 0 ? (
              <Muted>Nothing recorded against this job.</Muted>
            ) : (
              <ul className={styles.usageList}>
                {viewing.usages.map((usage) => {
                  const unit = usage.item.unitId ? catalog.unitById.get(usage.item.unitId) : null;
                  const short = isOpen(viewing) && usage.quantity > usage.item.quantity;
                  return (
                    <li key={usage.id} className={styles.usage}>
                      <span>
                        {usage.item.name}
                        {short && (
                          <>
                            {' '}
                            <Badge tone="danger">only {formatQuantity(usage.item.quantity, unit)} in stock</Badge>
                          </>
                        )}
                      </span>
                      <span className={styles.usageAmounts}>
                        {usage.quantity > 0 && <Figure>{formatQuantity(usage.quantity, unit)}</Figure>}
                        {usage.hours > 0 && <Figure>{formatHours(usage.hours)}</Figure>}
                        {!isOpen(viewing) && usage.cost > 0 && <Muted>{money(usage.cost)}</Muted>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <dl className={styles.costs}>
            <div><dt>Materials</dt><dd><Figure>{money(viewing.materialCost)}</Figure></dd></div>
            <div><dt>Tool wear</dt><dd><Figure>{money(viewing.toolingCost)}</Figure></dd></div>
            <div><dt>Machine time</dt><dd><Figure>{money(viewing.machineCost)}</Figure></dd></div>
            {viewing.extraCost > 0 && <div><dt>Other</dt><dd><Figure>{money(viewing.extraCost)}</Figure></dd></div>}
            <div className={styles.total}><dt>{isOpen(viewing) ? 'Estimated cost' : 'Cost'}</dt><dd><Figure>{money(viewing.totalCost)}</Figure></dd></div>
          </dl>
        </Modal>
      )}

      {form && <JobForm catalog={catalog} items={items} job={form.job} defaultMachineId={machine?.id} onClose={() => setForm(null)} />}
    </>
  );
}
