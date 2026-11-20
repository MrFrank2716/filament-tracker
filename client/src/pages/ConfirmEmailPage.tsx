import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorNote } from '@/components/ui/Display';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { Frame } from '@/pages/PasswordResetPages';
import styles from '@/pages/AuthPage.module.css';

/** Where the "confirm your email" link lands, with its token in the URL fragment. Works signed in or not. */
export function ConfirmEmailPage() {
  const { user, refreshUser } = useAuth();
  // Read once: the fragment never reaches the server, and it is cleared from the address bar straight away.
  const [token] = useState(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
    if (value) window.history.replaceState(null, '', window.location.pathname);
    return value;
  });
  const [email, setEmail] = useState('');
  const [error, setError] = useState(token ? '' : 'This link is incomplete. Open the link from your email again.');

  useEffect(() => {
    if (!token) return;
    let current = true;
    api
      .post<{ email: string }>('/auth/verify', { token })
      .then((confirmed) => {
        if (!current) return;
        setEmail(confirmed.email);
        // If this browser is signed in to that account, its notice should go at once.
        refreshUser();
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : 'Something went wrong');
      });
    return () => {
      current = false;
    };
  }, [token, refreshUser]);

  return (
    <Frame footer={<Link to={user ? '/' : '/login'}>{user ? 'Continue to Wrkbench' : 'Sign in'}</Link>}>
      <div className={styles.form}>
        <h2 className={styles.heading}>Confirm your email</h2>
        {error ? (
          <ErrorNote>{error}</ErrorNote>
        ) : email ? (
          <p className={styles.note} role="status">
            {email} is confirmed. You can now be added to other people's workspaces.
          </p>
        ) : (
          <p className={styles.note} role="status">
            Checking your link…
          </p>
        )}
      </div>
    </Frame>
  );
}
