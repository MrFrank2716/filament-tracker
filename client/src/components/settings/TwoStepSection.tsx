import { useEffect, useState } from 'react';
import { Copy, Download, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNote, Muted, SectionTitle } from '@/components/ui/Display';
import { TextField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { api, saveBlob } from '@/lib/api';
import { QR_QUIET_ZONE, qrShape } from '@/lib/labels';
import type { User } from '@/lib/types';
import styles from '@/components/settings/TwoStep.module.css';

const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Something went wrong');

/** The set-up link as a code to scan with the phone. */
function SetupCode({ link }: { link: string }) {
  const shape = qrShape(link);
  const box = shape.size + QR_QUIET_ZONE * 2;
  return (
    <svg className={styles.qr} viewBox={`${-QR_QUIET_ZONE} ${-QR_QUIET_ZONE} ${box} ${box}`} shapeRendering="crispEdges" role="img" aria-label="QR code to scan with your authenticator app">
      <rect x={-QR_QUIET_ZONE} y={-QR_QUIET_ZONE} width={box} height={box} fill="#fff" />
      <path d={shape.path} fill="#000" />
    </svg>
  );
}

/** Recovery codes, shown once: to copy or save before the window is closed. */
function RecoveryCodes({ codes, email }: { codes: string[]; email: string }) {
  const toast = useToast();
  const text = [`Wrkbench recovery codes for ${email}`, 'Each code signs you in once, instead of a code from your authenticator app.', '', ...codes].join('\n');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Recovery codes copied');
    } catch {
      toast('Could not copy. Select the codes and copy them by hand.', 'danger');
    }
  };
  return (
    <>
      <p>
        <strong>Save these recovery codes now.</strong> If you lose your phone, each one signs you in once. They are not shown again.
      </p>
      <ul className={styles.codes} aria-label="Recovery codes">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className={styles.actions}>
        <Button icon={Copy} onClick={() => void copy()}>
          Copy
        </Button>
        <Button icon={Download} onClick={() => saveBlob(new Blob([`${text}\n`], { type: 'text/plain' }), 'wrkbench-recovery-codes.txt')}>
          Download
        </Button>
      </div>
    </>
  );
}

type Dialog =
  | { kind: 'password' }
  | { kind: 'scan'; secret: string; link: string }
  | { kind: 'codes'; codes: string[] }
  | { kind: 'prove'; then: 'off' | 'new-codes' };

/** Turning two-step sign-in on and off, and making new recovery codes. Part of the account settings. */
export function TwoStepSection() {
  const { user, updateUser, enableTwoStep } = useAuth();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [codesLeft, setCodesLeft] = useState<number | null>(null);
  const on = Boolean(user?.twoStep);

  useEffect(() => {
    if (!on) return;
    let current = true;
    api
      .get<{ recoveryCodesLeft: number }>('/auth/two-step')
      .then((status) => {
        if (current) setCodesLeft(status.recoveryCodesLeft);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [on, dialog]);

  if (!user || user.isGuest) return null;

  const open = (next: Dialog) => {
    setPassword('');
    setCode('');
    setError('');
    setDialog(next);
  };
  const close = () => setDialog(null);
  const attempt = async (action: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const begin = () =>
    attempt(async () => {
      const setup = await api.post<{ secret: string; link: string }>('/auth/two-step/setup', { password });
      open({ kind: 'scan', ...setup });
    });
  const finish = () =>
    attempt(async () => {
      const codes = await enableTwoStep(code);
      open({ kind: 'codes', codes });
    });
  const prove = (then: 'off' | 'new-codes') =>
    attempt(async () => {
      if (then === 'off') {
        const answer = await api.post<{ user: User }>('/auth/two-step/disable', { password, code });
        updateUser(answer.user);
        close();
        toast('Two-step sign-in is off');
      } else {
        const answer = await api.post<{ recoveryCodes: string[] }>('/auth/two-step/recovery-codes', { password, code });
        open({ kind: 'codes', codes: answer.recoveryCodes });
      }
    });

  const cancel = (
    <Button onClick={close} disabled={busy}>
      Cancel
    </Button>
  );
  /** The secret in groups of four, as authenticator apps show it. */
  const spaced = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

  return (
    <>
      <SectionTitle>Two-step sign-in</SectionTitle>
      {on ? (
        <>
          <Muted>
            <ShieldCheck size={16} aria-hidden className={styles.inlineIcon} /> On. Signing in asks for your password and a code from your authenticator app.
            {codesLeft !== null && ` You have ${codesLeft} recovery code${codesLeft === 1 ? '' : 's'} left.`}
          </Muted>
          <div className={styles.actions}>
            <Button icon={KeyRound} onClick={() => open({ kind: 'prove', then: 'new-codes' })}>
              New recovery codes
            </Button>
            <Button icon={ShieldOff} onClick={() => open({ kind: 'prove', then: 'off' })}>
              Turn off
            </Button>
          </div>
        </>
      ) : (
        <>
          <Muted>
            Ask for a code from an authenticator app on your phone as well as your password, so a stolen password is not enough to get in. You need an app
            such as Google Authenticator, Microsoft Authenticator, 1Password or Aegis.
          </Muted>
          <div className={styles.actions}>
            <Button icon={ShieldCheck} onClick={() => open({ kind: 'password' })}>
              Turn on two-step sign-in
            </Button>
          </div>
        </>
      )}

      {dialog?.kind === 'password' && (
        <Modal
          title="Turn on two-step sign-in"
          onClose={close}
          onSubmit={() => void begin()}
          footer={
            <>
              {cancel}
              <Button type="submit" variant="primary" disabled={busy || !password}>
                Continue
              </Button>
            </>
          }
        >
          <p>First, confirm it is you.</p>
          <TextField label="Your password" type="password" value={password} onChange={setPassword} autoComplete="current-password" autoFocus required />
          {error && <ErrorNote>{error}</ErrorNote>}
        </Modal>
      )}

      {dialog?.kind === 'scan' && (
        <Modal
          title="Add Wrkbench to your authenticator app"
          onClose={close}
          onSubmit={() => void finish()}
          footer={
            <>
              {cancel}
              <Button type="submit" variant="primary" disabled={busy || code.trim().length < 6}>
                Turn on
              </Button>
            </>
          }
        >
          <ol className={styles.steps}>
            <li>In your authenticator app, add an account and scan this code.</li>
            <li>Enter the 6-digit code the app then shows.</li>
          </ol>
          <SetupCode link={dialog.link} />
          <p className={styles.key}>
            Cannot scan it? Enter this key in the app instead: <code>{spaced(dialog.secret)}</code>
          </p>
          <TextField label="6-digit code" value={code} onChange={setCode} autoComplete="one-time-code" inputMode="numeric" maxLength={7} required />
          {error && <ErrorNote>{error}</ErrorNote>}
          <Muted>Turning it on signs out your other devices. Nothing changes until you press Turn on.</Muted>
        </Modal>
      )}

      {dialog?.kind === 'codes' && (
        <Modal
          title="Your recovery codes"
          onClose={close}
          footer={
            <Button variant="primary" onClick={close}>
              I have saved them
            </Button>
          }
        >
          <RecoveryCodes codes={dialog.codes} email={user.email} />
        </Modal>
      )}

      {dialog?.kind === 'prove' && (
        <Modal
          title={dialog.then === 'off' ? 'Turn off two-step sign-in?' : 'Make new recovery codes?'}
          onClose={close}
          onSubmit={() => void prove(dialog.then)}
          footer={
            <>
              {cancel}
              <Button type="submit" variant={dialog.then === 'off' ? 'danger' : 'primary'} disabled={busy || !password || code.trim().length < 6}>
                {dialog.then === 'off' ? 'Turn off' : 'Make new codes'}
              </Button>
            </>
          }
        >
          <p>
            {dialog.then === 'off'
              ? 'Signing in will need only your password again.'
              : 'Your old recovery codes stop working as soon as the new ones are made.'}
          </p>
          <TextField label="Your password" type="password" value={password} onChange={setPassword} autoComplete="current-password" autoFocus required />
          <TextField
            label="Code"
            value={code}
            onChange={setCode}
            autoComplete="one-time-code"
            hint="The 6-digit code from your authenticator app, or a recovery code."
            required
          />
          {error && <ErrorNote>{error}</ErrorNote>}
        </Modal>
      )}
    </>
  );
}
