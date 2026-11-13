import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Download, Inbox, Link2, MessageSquareReply, Trash2, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, ErrorNote, Muted, SectionTitle } from '@/components/ui/Display';
import { FormGrid, NumberField, SelectField, TextAreaField } from '@/components/ui/Form';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { useAction, useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import type { Catalog } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import { formatBytes, formatDate, parseNumber } from '@/lib/format';
import { JOB_STATUS, REQUEST_STATUS } from '@/lib/status';
import type { JobRequest, RequestFile, RequestLink } from '@/lib/types';
import styles from '@/components/requests/Requests.module.css';

type Decision = 'approve' | 'changes' | 'reject';

interface RequestQueueProps {
  requests: JobRequest[];
  link: RequestLink | undefined;
  catalog: Catalog;
  /** Set when one machine is in focus, for the wording of the empty state. */
  machineName?: string;
}

/** Outside job requests: the ones waiting to be checked in the order they arrived, then the rest. */
export function RequestQueue({ requests, link, catalog, machineName }: RequestQueueProps) {
  const { canEdit, isOwner } = useWorkspace();
  const [reviewing, setReviewing] = useState<{ request: JobRequest; decision: Decision } | null>(null);

  const waiting = requests.filter((request) => request.status === 'pending');
  const withRequester = requests.filter((request) => request.status === 'changes_requested');
  const done = requests
    .filter((request) => request.status === 'approved' || request.status === 'rejected')
    .sort((a, b) => (b.reviewedAt ?? b.createdAt).localeCompare(a.reviewedAt ?? a.createdAt));

  if (requests.length === 0) {
    return (
      <EmptyState icon={Inbox} title={machineName ? `No requests for ${machineName}` : 'No requests yet'} action={!link?.enabled && isOwner && <Link to="/settings?tab=requests">Turn on the request link</Link>}>
        {link?.enabled
          ? 'People you give the request link to can send files here to be checked. Approving one adds it to the open jobs.'
          : 'Let people outside the workspace send files for checking: switch on the request link in Settings, under Job requests.'}
      </EmptyState>
    );
  }

  const card = (request: JobRequest, position?: number) => (
    <RequestCard key={request.id} request={request} position={position} canEdit={canEdit} onDecide={(decision) => setReviewing({ request, decision })} />
  );

  return (
    <div className={styles.queue}>
      {waiting.length > 0 && (
        <>
          <SectionTitle count={waiting.length}>Waiting to be checked</SectionTitle>
          {waiting.map((request, index) => card(request, index + 1))}
        </>
      )}
      {withRequester.length > 0 && (
        <>
          <SectionTitle count={withRequester.length}>Waiting on the requester</SectionTitle>
          {withRequester.map((request) => card(request))}
        </>
      )}
      {done.length > 0 && (
        <>
          <SectionTitle count={done.length}>Checked</SectionTitle>
          {done.map((request) => card(request))}
        </>
      )}
      {reviewing && <ReviewDialog request={reviewing.request} decision={reviewing.decision} catalog={catalog} onClose={() => setReviewing(null)} />}
    </div>
  );
}

/** Files are only ever downloaded, never opened in the page: they come from outside. */
export function RequestFiles({ requestId, files }: { requestId: string; files: RequestFile[] }) {
  const { wsPath } = useWorkspace();
  const { run, busy } = useAction();
  if (files.length === 0) return null;
  return (
    <div className={styles.fileList}>
      {files.map((file) => (
        <button key={file.id} type="button" className={styles.fileButton} disabled={busy} onClick={() => run(() => api.download(wsPath(`/job-requests/${requestId}/files/${file.id}`)!, file.name))}>
          <Download size={16} aria-hidden />
          <span className={styles.fileName}>{file.name}</span>
          <span className={styles.fileMeta}>{formatBytes(file.size)}</span>
        </button>
      ))}
    </div>
  );
}

function RequestCard({ request, position, canEdit, onDecide }: { request: JobRequest; position?: number; canEdit: boolean; onDecide: (decision: Decision) => void }) {
  const { wsPath } = useWorkspace();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const toast = useToast();
  const status = REQUEST_STATUS[request.status];
  const open = request.status === 'pending' || request.status === 'changes_requested';

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/request/${request.trackToken}`);
      toast('Progress link copied');
    } catch {
      toast('Could not copy the link', 'danger');
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this request?',
      message: `"${request.title}" from ${request.requesterName} and its ${request.files.length} file${request.files.length === 1 ? '' : 's'} will be permanently removed, and their progress link will stop working.${request.job ? ' The job created from it stays.' : ''}`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) await run(() => api.delete(wsPath(`/job-requests/${request.id}`)!), 'Request deleted');
  };

  return (
    <Card className={request.status === 'pending' ? styles.requestWaiting : ''}>
      <div className={styles.request}>
        <div className={styles.requestHead}>
          {position !== undefined && (
            <span className={styles.position} aria-label={`Number ${position} in the queue`}>
              {position}
            </span>
          )}
          <div className={styles.requestTitle}>
            <h3 className={styles.requestName}>{request.title}</h3>
            <span className={styles.requestMeta}>
              {request.requesterName} · {request.requesterEmail} · sent {formatDate(request.createdAt)}
              {request.machine ? ` · ${request.machine.name}` : ' · no machine preference'}
            </span>
          </div>
          <Badge tone={status.tone}>{request.status === 'pending' ? 'To check' : status.label}</Badge>
        </div>

        {request.details && <p className={styles.details}>{request.details}</p>}
        <RequestFiles requestId={request.id} files={request.files} />

        {request.reviewNote && (
          <div className={styles.note}>
            <span className={styles.noteLabel}>
              {request.reviewedBy ? `${request.reviewedBy.name} replied` : 'Reply'}
              {request.reviewedAt ? ` · ${formatDate(request.reviewedAt)}` : ''}
            </span>
            <p className={styles.noteText}>{request.reviewNote}</p>
          </div>
        )}

        {request.job && (
          <Muted>
            Job: {request.job.name} · {JOB_STATUS[request.job.status].label}
          </Muted>
        )}

        {canEdit && (
          <div className={styles.actions}>
            {open && (
              <Button variant="primary" icon={Check} onClick={() => onDecide('approve')} disabled={busy}>
                Approve
              </Button>
            )}
            {request.status === 'pending' && (
              <Button icon={MessageSquareReply} onClick={() => onDecide('changes')} disabled={busy}>
                Ask for changes
              </Button>
            )}
            {open && (
              <Button icon={X} onClick={() => onDecide('reject')} disabled={busy}>
                Reject
              </Button>
            )}
            {request.trackToken && (
              <Button variant="ghost" icon={Link2} onClick={copyLink}>
                Copy progress link
              </Button>
            )}
            <IconButton icon={Trash2} label={`Delete request ${request.title}`} onClick={remove} disabled={busy} />
          </div>
        )}
      </div>
    </Card>
  );
}

const DIALOG: Record<Decision, { title: string; action: string; done: string; noteLabel: string; notePlaceholder: string }> = {
  approve: { title: 'Approve request', action: 'Approve and plan job', done: 'Approved. Added to open jobs.', noteLabel: 'Message to the requester (optional)', notePlaceholder: 'e.g. Ready for collection on Friday' },
  changes: { title: 'Ask for changes', action: 'Send back', done: 'Sent back to the requester', noteLabel: 'What needs changing *', notePlaceholder: 'e.g. Walls are thinner than 0.8 mm near the clip; please thicken and resend' },
  reject: { title: 'Reject request', action: 'Reject', done: 'Request rejected', noteLabel: 'Reason (optional, shown to the requester)', notePlaceholder: 'e.g. Too large for our machines' },
};

function ReviewDialog({ request, decision, catalog, onClose }: { request: JobRequest; decision: Decision; catalog: Catalog; onClose: () => void }) {
  const { wsPath } = useWorkspace();
  const { run, busy } = useAction();
  const [note, setNote] = useState('');
  const [machineId, setMachineId] = useState(request.machine?.id ?? '');
  const [hours, setHours] = useState('');
  const [error, setError] = useState('');
  const copy = DIALOG[decision];

  const save = async () => {
    setError('');
    if (decision === 'changes' && !note.trim()) return setError('Say what needs changing, so the requester knows what to send.');
    const ok = await run(
      () =>
        api.post(wsPath(`/job-requests/${request.id}/review`)!, {
          decision,
          note: note.trim(),
          ...(decision === 'approve' ? { machineId: machineId || null, durationHours: parseNumber(hours) ?? 0 } : {}),
        }),
      copy.done,
    );
    if (ok) onClose();
  };

  return (
    <Modal
      title={copy.title}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant={decision === 'reject' ? 'danger' : 'primary'} disabled={busy}>
            {copy.action}
          </Button>
        </>
      }
    >
      <div>
        <strong>{request.title}</strong>
        <div>
          <Muted>
            {request.requesterName} · {request.files.length} file{request.files.length === 1 ? '' : 's'}
          </Muted>
        </div>
      </div>
      {decision === 'approve' && (
        <>
          <Muted>This creates a planned job with the requester's details and files attached. Add materials and tooling to it from Open jobs.</Muted>
          <FormGrid>
            <SelectField label="Machine" value={machineId} onChange={setMachineId}>
              <option value="">Not decided</option>
              {catalog.machines.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.name}
                </option>
              ))}
            </SelectField>
            <NumberField label="Estimated time" value={hours} onChange={setHours} suffix="h" />
          </FormGrid>
        </>
      )}
      <TextAreaField label={copy.noteLabel} value={note} onChange={setNote} rows={3} maxLength={2000} placeholder={copy.notePlaceholder} autoFocus />
      {decision !== 'approve' && <Muted>The requester sees this on their progress link. There is no email, so pass the link on if they need a nudge.</Muted>}
      {error && <ErrorNote>{error}</ErrorNote>}
    </Modal>
  );
}
