import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { PackageX, SearchX, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState, Loading } from '@/components/ui/Display';
import { useWorkspace } from '@/context/WorkspaceContext';
import { api, ApiError } from '@/lib/api';

type Kind = 'item' | 'location';
type Outcome = { state: 'looking' } | { state: 'gone' } | { state: 'retired'; name: string } | { state: 'offline'; message: string };

/**
 * Where a scanned label lands. The link holds only an id, so this asks which workspace it belongs to,
 * switches to it, and opens the item or the location there.
 */
export function LabelLinkPage({ kind }: { kind: Kind }) {
  const { id = '' } = useParams();
  const { select } = useWorkspace();
  const navigate = useNavigate();
  // What the scanner handed over (see ScanState) goes on to the page this opens.
  const { state } = useLocation();
  const [outcome, setOutcome] = useState<Outcome>({ state: 'looking' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setOutcome({ state: 'looking' });
    api
      .get<{ workspaceId: string; archived: boolean; name: string }>(`/resolve/${kind}/${encodeURIComponent(id)}`)
      .then((found) => {
        if (cancelled) return;
        if (found.archived) return setOutcome({ state: 'retired', name: found.name });
        select(found.workspaceId);
        navigate(kind === 'item' ? `/inventory?item=${encodeURIComponent(id)}` : `/locations/${encodeURIComponent(id)}`, { replace: true, state });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.status === 404) setOutcome({ state: 'gone' });
        else setOutcome({ state: 'offline', message: cause instanceof Error ? cause.message : 'Something went wrong.' });
      });
    return () => {
      cancelled = true;
    };
  }, [kind, id, select, navigate, attempt, state]);

  if (outcome.state === 'looking') return <Loading label="Opening" />;
  const home = (
    <Link to={kind === 'item' ? '/inventory' : '/locations'}>
      <Button variant="primary">{kind === 'item' ? 'Go to inventory' : 'Go to locations'}</Button>
    </Link>
  );
  if (outcome.state === 'offline') {
    return (
      <EmptyState icon={WifiOff} title="Cannot reach the server" action={<Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}>
        {outcome.message}
      </EmptyState>
    );
  }
  if (outcome.state === 'retired') {
    return (
      <EmptyState icon={PackageX} title={`${outcome.name} is no longer in stock`} action={home}>
        It was removed from the inventory and is kept only in the records of past jobs. The label or sticker can be reused: print or write a new one for another item.
      </EmptyState>
    );
  }
  return (
    <EmptyState icon={SearchX} title={kind === 'item' ? 'This label is not for anything in your stock' : 'This label is not for one of your locations'} action={home}>
      {kind === 'item' ? 'The item' : 'The location'} may have been deleted, or it belongs to a workspace you are not a member of. If you have more than one account, check you are signed in to the right one.
    </EmptyState>
  );
}
