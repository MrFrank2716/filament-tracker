import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Link2Off, RefreshCw, Send } from 'lucide-react';
import { CommentThread } from '@/components/requests/CommentThread';
import { FilePicker, filesProblem } from '@/components/requests/FilePicker';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorNote, Loading } from '@/components/ui/Display';
import { TextAreaField } from '@/components/ui/Form';
import { api } from '@/lib/api';
import { formatBytes, formatDate, formatDateTime } from '@/lib/format';
import { JOB_STATUS, REQUEST_STATUS } from '@/lib/status';
import { refreshAll, useQuery } from '@/lib/store';
import { Frame } from '@/pages/SubmitRequestPage';
import type { TrackedRequest } from '@/lib/types';
import styles from '@/components/requests/Requests.module.css';

const STEPS = ['Sent', 'Checked', 'Accepted', 'Making', 'Done'] as const;

interface Progress {
  /** The step the request is on now; every step before it is done. */
  at: number;
  /** Set when the request stopped at that step, with what to call it instead. */
  blocked?: { label: string; tone: 'warn' | 'danger' };
}

function progressOf(request: TrackedRequest): Progress {
  if (request.status === 'pending') return { at: 1 };
  if (request.status === 'changes_requested') return { at: 2, blocked: { label: 'Changes needed', tone: 'warn' } };
  if (request.status === 'rejected') return { at: 2, blocked: { label: 'Not accepted', tone: 'danger' } };
  if (request.status === 'done') return { at: 4 };
  if (request.status === 'in_progress' && request.jobStatus !== 'failed' && request.jobStatus !== 'cancelled') return { at: 3 };
  if (request.jobStatus === 'in_progress') return { at: 3 };
  if (request.jobStatus === 'completed') return { at: 4 };
  if (request.jobStatus === 'failed') return { at: 3, blocked: { label: 'Failed', tone: 'danger' } };
  if (request.jobStatus === 'cancelled') return { at: 3, blocked: { label: 'Cancelled', tone: 'danger' } };
  return { at: 2 };
}

/** The request's journey as a ruler: filled up to where it is, the orange needle on the step in hand. */
function ProgressTrack({ request }: { request: TrackedRequest }) {
  const { at, blocked } = progressOf(request);
  const finished = !blocked && at === STEPS.length - 1;
  return (
    <ol className={styles.track} aria-label="Progress">
      {STEPS.map((label, index) => {
        const state = index < at || (finished && index === at) ? 'done' : index === at ? (blocked ? `blocked-${blocked.tone}` : 'current') : 'todo';
        return (
          <li key={label} className={`${styles.trackStep} ${styles[`track-${state}`]} ${index < at ? styles.trackFilled : ''}`} aria-current={index === at ? 'step' : undefined}>
            <span className={styles.trackSegment} aria-hidden />
            <span className={styles.trackLabel}>{index === at && blocked ? blocked.label : label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Public page a requester keeps: where their request stands, what the reviewer said, and a way to answer. */
export function TrackRequestPage() {
  const { token = '' } = useParams();
  const { data: request, error: loadError } = useQuery<TrackedRequest>(`/public/track/${token}`);
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // No account means no live updates, so look again every minute and whenever the page is returned to.
  useEffect(() => {
    const timer = setInterval(refreshAll, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshAll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (loadError) {
    return (
      <Frame title="Your request">
        <EmptyState icon={Link2Off} title="Request not found">
          This link does not match a request. It may have been removed by the workshop.
        </EmptyState>
      </Frame>
    );
  }
  if (!request) {
    return (
      <Frame title="Your request">
        <Loading />
      </Frame>
    );
  }

  const status = REQUEST_STATUS[request.status];

  const resubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (files.length === 0 && !message.trim()) return setError('Attach the corrected files, or write a reply.');
    const problem = filesProblem(files, request.limits);
    if (problem) return setError(problem);

    const form = new FormData();
    form.set('message', message.trim());
    for (const file of files) form.append('files', file);
    setBusy(true);
    try {
      await api.upload(`/public/track/${token}/resubmit`, form);
      setFiles([]);
      setMessage('');
      refreshAll();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame title="Your request" subtitle={request.workspaceName}>
      <div className={styles.sheet}>
        <div className={styles.statusRow}>
          <h2 className={styles.sheetTitle}>{request.title}</h2>
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={refreshAll}>
            Check again
          </Button>
        </div>
        <ProgressTrack request={request} />
        <span className={styles.srOnly}>
          {status.label}
          {request.jobStatus ? `. Job: ${JOB_STATUS[request.jobStatus].label}` : ''}
        </span>

        <p className={styles.lead}>
          {request.status === 'pending' &&
            (request.ahead === 0
              ? 'Your files are next to be checked. Nothing is made until the request is approved.'
              : `${request.ahead} request${request.ahead === 1 ? ' is' : 's are'} ahead of yours. Nothing is made until the request is approved.`)}
          {request.status === 'changes_requested' && 'The workshop has looked at your files and needs something changed before it can accept the job.'}
          {request.status === 'approved' && 'Accepted. You will get an email when it is being made.'}
          {request.status === 'in_progress' && 'Being made now. You will get an email when it is done.'}
          {request.status === 'done' && 'Done. Contact the workshop to collect it.'}
          {request.status === 'rejected' && 'The workshop was not able to accept this job.'}
        </p>

        {request.estimate && (
          <p className={styles.lead}>
            {request.estimate.paused
              ? 'The machine it is booked on is paused at the moment, so there is no time estimate yet.'
              : request.estimate.estimatedFinish
                ? `${request.estimate.ahead === 0 ? 'Next up' : `${request.estimate.ahead} job${request.estimate.ahead === 1 ? '' : 's'} ahead of it`}. Estimated ready around ${formatDateTime(request.estimate.estimatedFinish)}.`
                : null}
          </p>
        )}

        {request.reviewNote && request.comments.length === 0 && (
          <div className={styles.note}>
            <span className={styles.noteLabel}>From {request.workspaceName}</span>
            <p className={styles.noteText}>{request.reviewNote}</p>
          </div>
        )}

        {request.status === 'changes_requested' && (
          <form className={styles.reply} onSubmit={resubmit} noValidate>
            <FilePicker files={files} onChange={setFiles} limits={request.limits} />
            <TextAreaField label="Reply (optional)" value={message} onChange={setMessage} rows={2} maxLength={2000} placeholder="What you changed" />
            {error && <ErrorNote>{error}</ErrorNote>}
            <Button type="submit" variant="primary" icon={Send} disabled={busy}>
              {busy ? 'Sending…' : 'Send again for checking'}
            </Button>
          </form>
        )}

        <CommentThread
          comments={request.comments}
          canWrite
          viewer="requester"
          placeholder="Ask the workshop something or add details"
          onSend={async (body) => {
            await api.post(`/public/track/${token}/comments`, { body });
            refreshAll();
          }}
        />

        <dl className={styles.facts}>
          <div>
            <dt>Sent</dt>
            <dd>{formatDate(request.createdAt)}</dd>
          </div>
          <div>
            <dt>From</dt>
            <dd>{request.requesterName}</dd>
          </div>
          {request.machineName && (
            <div>
              <dt>Machine</dt>
              <dd>{request.machineName}</dd>
            </div>
          )}
          {request.reviewedAt && (
            <div>
              <dt>Checked</dt>
              <dd>{formatDate(request.reviewedAt)}</dd>
            </div>
          )}
        </dl>

        {request.details && <p className={styles.details}>{request.details}</p>}

        <ul className={styles.fileList}>
          {request.files.map((file, index) => (
            <li key={`${index}:${file.name}`} className={styles.file}>
              <span className={styles.fileName}>{file.name}</span>
              <span className={styles.fileMeta}>{formatBytes(file.size)}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className={styles.footnote}>Keep this page's address. It is the only way back to your request.</p>
    </Frame>
  );
}
