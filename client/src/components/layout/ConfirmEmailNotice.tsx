import { useEffect, useState } from 'react';
import { MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import styles from '@/components/layout/ConfirmEmailNotice.module.css';

/**
 * Shown to an account that has not opened its confirmation link yet. The account works meanwhile; what it
 * cannot do is be added to someone else's workspace, so the notice says that and offers to send the link again.
 */
export function ConfirmEmailNotice() {
  const { user, refreshUser, resendConfirmation } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const waiting = Boolean(user) && !user?.isGuest && user?.emailVerified === false;

  // The link is usually opened in another tab or on a phone: look again when this one comes back into view.
  useEffect(() => {
    if (!waiting) return;
    const look = () => {
      if (document.visibilityState === 'visible') refreshUser();
    };
    document.addEventListener('visibilitychange', look);
    window.addEventListener('focus', look);
    return () => {
      document.removeEventListener('visibilitychange', look);
      window.removeEventListener('focus', look);
    };
  }, [waiting, refreshUser]);

  if (!waiting || !user) return null;

  const send = async () => {
    setBusy(true);
    try {
      toast(await resendConfirmation());
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Could not send the link', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.notice} role="status">
      <MailCheck size={18} aria-hidden className={styles.icon} />
      <p className={styles.text}>
        <strong>Confirm your email address.</strong> We sent a link to {user.email}. Until you open it, nobody can add you to their workspace.
      </p>
      <Button size="sm" onClick={send} disabled={busy}>
        Send the link again
      </Button>
    </div>
  );
}
