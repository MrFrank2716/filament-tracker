import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { LegalNote } from '@/pages/LegalPages';
import { Button } from '@/components/ui/Button';
import { ErrorNote } from '@/components/ui/Display';
import { TextField } from '@/components/ui/Form';
import { useAuth } from '@/context/AuthContext';
import styles from '@/pages/AuthPage.module.css';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, login, register, continueAsGuest } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Where they were going when asked to sign in. Only a path inside the app is ever followed.
  const state = useLocation().state as { from?: unknown } | null;
  const from = typeof state?.from === 'string' && /^\/(?!\/)/.test(state.from) ? state.from : null;

  const registering = mode === 'register';
  // A guest may open the register page to keep their work under a real account.
  const upgrading = registering && Boolean(user?.isGuest);
  if (user && !upgrading) return <Navigate to={from ?? '/'} replace />;

  const run = async (action: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(() => (registering ? register(name, email, password) : login(email, password)));
  };

  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <img src="/icon.svg" alt="" width={44} height={44} />
          <div>
            <h1 className={styles.title}>Wrkbench</h1>
            <p className={styles.tagline}>Know what is in stock, where it is, and what needs attention.</p>
          </div>
        </div>

        <form className={styles.form} onSubmit={submit}>
          <h2 className={styles.heading}>{registering ? 'Create your account' : 'Sign in'}</h2>
          {upgrading && <p className={styles.note}>Everything you set up as a guest stays with your new account.</p>}
          {registering && <TextField label="Your name" value={name} onChange={setName} autoComplete="name" required />}
          <TextField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" inputMode="email" required />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete={registering ? 'new-password' : 'current-password'}
            hint={registering ? 'At least 8 characters.' : undefined}
            required
          />
          {!registering && (
            <p className={styles.forgot}>
              <Link to="/forgot-password">Forgot password?</Link>
            </p>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
          {registering && <LegalNote action="creating an account" />}
          <Button type="submit" variant="primary" size="lg" block disabled={busy}>
            {registering ? 'Create account' : 'Sign in'}
          </Button>
          {!upgrading && (
            <>
              <div className={styles.divider}>or</div>
              <Button size="lg" block disabled={busy} onClick={() => void run(continueAsGuest)}>
                Continue as guest
              </Button>
              <p className={styles.note}>
                Try it with a sample workshop, no account needed. Guest sessions are removed after 7 days. Example
                brand names are not affiliated with Wrkbench.
              </p>
              <LegalNote action="continuing" />
            </>
          )}
        </form>

        <p className={styles.switch}>
          {upgrading ? (
            <Link to="/">Back to the workshop</Link>
          ) : registering ? (
            <>
              Already have an account? <Link to="/login" state={state}>Sign in</Link>
            </>
          ) : (
            <>
              New here? <Link to="/register" state={state}>Create an account</Link>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
