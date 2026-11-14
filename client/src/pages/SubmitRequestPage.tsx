import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CircleCheck, Copy, Link2Off, Send } from 'lucide-react';
import { FilePicker, filesProblem } from '@/components/requests/FilePicker';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorNote, Loading } from '@/components/ui/Display';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { LegalLinks } from '@/pages/LegalPages';
import { useQuery } from '@/lib/store';
import type { SubmitInfo } from '@/lib/types';
import styles from '@/components/requests/Requests.module.css';

/** Public page behind a workspace's request link: describe a job, attach the files, send it for checking. */
export function SubmitRequestPage() {
  const { token = '' } = useParams();
  const { data: info, error: loadError } = useQuery<SubmitInfo>(`/public/requests/${token}`);
  const toast = useToast();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [machineId, setMachineId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [trackToken, setTrackToken] = useState<string | null>(null);

  if (loadError) {
    return (
      <Frame title="Request a job">
        <EmptyState icon={Link2Off} title="This link is not active">
          {loadError}
        </EmptyState>
      </Frame>
    );
  }
  if (!info) {
    return (
      <Frame title="Request a job">
        <Loading />
      </Frame>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!name.trim()) return setError('Tell us your name.');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter an email address we can reach you on.');
    if (!title.trim()) return setError('Give the job a short title.');
    if (files.length === 0) return setError('Attach at least one file to be checked.');
    const problem = filesProblem(files, info.limits);
    if (problem) return setError(problem);

    const form = new FormData();
    form.set('requesterName', name.trim());
    form.set('requesterEmail', email.trim());
    form.set('title', title.trim());
    form.set('details', details.trim());
    if (machineId) form.set('machineId', machineId);
    for (const file of files) form.append('files', file);

    setBusy(true);
    try {
      const result = await api.upload<{ trackToken: string }>(`/public/requests/${token}`, form);
      setTrackToken(result.trackToken);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send your request. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (trackToken) {
    const link = `${window.location.origin}/request/${trackToken}`;
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(link);
        toast('Link copied');
      } catch {
        toast('Could not copy. Select the link and copy it by hand.', 'danger');
      }
    };
    return (
      <Frame title="Request sent" subtitle={info.workspaceName}>
        <div className={styles.sheet}>
          <div className={styles.done}>
            <CircleCheck size={28} aria-hidden />
            <div className={styles.doneText}>
              <h2 className={styles.sheetTitle}>{title.trim()}</h2>
              <p className={styles.lead}>
                Sent. {info.workspaceName} checks your files before anything is made, and your progress page updates as it moves along.
              </p>
            </div>
          </div>
          <p>
            <strong>Keep this link.</strong> It is the only way to see whether your request was approved, or to answer if changes are needed.
          </p>
          <div className={styles.linkBox}>
            <span className={styles.linkText}>{link}</span>
            <Button icon={Copy} onClick={copy}>
              Copy
            </Button>
          </div>
          <div>
            <Link to={`/request/${trackToken}`}>Follow your request</Link>
          </div>
        </div>
      </Frame>
    );
  }

  return (
    <Frame title="Request a job" subtitle={info.workspaceName}>
      <form className={styles.sheet} onSubmit={submit} noValidate>
        <p className={styles.lead}>Send your files to be checked. You will get a link to follow the request, and nothing is made until it has been approved.</p>
        <TextField label="Your name *" value={name} onChange={setName} autoComplete="name" maxLength={80} />
        <TextField label="Email *" type="email" value={email} onChange={setEmail} autoComplete="email" inputMode="email" maxLength={200} hint="Only used by the workshop to contact you about this request." />
        <TextField label="Job title *" value={title} onChange={setTitle} maxLength={160} placeholder="e.g. Bracket for bike light, 4 off" />
        <TextAreaField label="What do you need?" value={details} onChange={setDetails} rows={4} maxLength={5000} placeholder="Material, colour, quantity, finish, and when you need it by" />
        {info.machines.length > 0 && (
          <SelectField label="Machine" value={machineId} onChange={setMachineId} hint="Leave as is if you are not sure.">
            <option value="">No preference</option>
            {info.machines.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {machine.type && machine.type !== machine.name ? `${machine.name} (${machine.type})` : machine.name}
              </option>
            ))}
          </SelectField>
        )}
        <FilePicker files={files} onChange={setFiles} limits={info.limits} />
        {error && <ErrorNote>{error}</ErrorNote>}
        <p className={styles.lead}>
          Your name, email and files are shared with {info.workspaceName} and updates are emailed to you. By sending you
          agree to the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>, and confirm you have the
          right to share these files.
        </p>
        <Button type="submit" variant="primary" size="lg" block icon={Send} disabled={busy}>
          {busy ? 'Sending…' : 'Send for checking'}
        </Button>
      </form>
    </Frame>
  );
}

/** Shared chrome for the two public pages. */
export function Frame({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <img src="/icon.svg" alt="" width={44} height={44} />
          <div className={styles.brandText}>
            <h1 className={styles.brandTitle}>{title}</h1>
            {subtitle && <p className={styles.brandSub}>{subtitle}</p>}
          </div>
        </div>
        {children}
        <LegalLinks />
      </div>
    </main>
  );
}
