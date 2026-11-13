import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LogOut, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Muted, SectionTitle } from '@/components/ui/Display';
import { FormGrid, TextField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useAction } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import styles from '@/components/settings/Settings.module.css';

/** About the signed-in person, not the workspace: password, other devices, and deleting the account. */
export function AccountSection() {
  const { user, changePassword, signOutOthers, deleteAccount } = useAuth();
  const { run, busy } = useAction();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');

  if (!user) return null;

  if (user.isGuest) {
    return (
      <>
        <SectionTitle>Your account</SectionTitle>
        <Muted>
          You are using a guest session, which is removed after 7 days. <Link to="/register">Create an account</Link> to keep what you
          have set up.
        </Muted>
      </>
    );
  }

  const savePassword = async () => {
    if (await run(() => changePassword(current, next), 'Password changed. Other devices were signed out.')) {
      setCurrent('');
      setNext('');
    }
  };

  return (
    <>
      <SectionTitle>Your account</SectionTitle>
      <Muted>
        Signed in as {user.name} ({user.email}).
      </Muted>

      <SectionTitle>Change password</SectionTitle>
      <form
        className={styles.general}
        onSubmit={(event) => {
          event.preventDefault();
          void savePassword();
        }}
      >
        <FormGrid>
          <TextField label="Current password" type="password" value={current} onChange={setCurrent} autoComplete="current-password" required />
          <TextField
            label="New password"
            type="password"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            minLength={8}
            hint="At least 8 characters."
            required
          />
        </FormGrid>
        <div>
          <Button type="submit" variant="primary" disabled={busy || !current || next.length < 8}>
            Change password
          </Button>
        </div>
      </form>

      <SectionTitle>Other devices</SectionTitle>
      <Muted>If you signed in somewhere you no longer use or trust, sign those devices out. This one stays signed in.</Muted>
      <div className={styles.danger}>
        <Button icon={LogOut} disabled={busy} onClick={() => void run(signOutOthers, 'Other devices were signed out')}>
          Sign out other devices
        </Button>
      </div>

      <SectionTitle>Delete account</SectionTitle>
      <Muted>Removes your account and every workspace that only you belong to. Workspaces you share with others stay with them.</Muted>
      <div className={styles.danger}>
        <Button variant="danger" icon={Trash2} disabled={busy} onClick={() => setDeleting(true)}>
          Delete my account
        </Button>
      </div>

      {deleting && (
        <Modal
          title="Delete your account?"
          onClose={() => setDeleting(false)}
          onSubmit={() => void run(() => deleteAccount(confirmPassword), 'Your account was deleted')}
          footer={
            <>
              <Button onClick={() => setDeleting(false)}>Cancel</Button>
              <Button type="submit" variant="danger" disabled={busy || !confirmPassword}>
                Delete account
              </Button>
            </>
          }
        >
          <p>
            Your account and every workspace that only you belong to will be permanently deleted. This cannot be undone. Export a
            workspace first if you might want it back.
          </p>
          <TextField
            label="Your password"
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="current-password"
            required
          />
        </Modal>
      )}
    </>
  );
}
