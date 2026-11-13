import { Copy, ExternalLink, Link2, Link2Off, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge, ErrorNote, Loading, Muted, SectionTitle } from '@/components/ui/Display';
import { useConfirm } from '@/components/ui/Modal';
import { useAction, useToast } from '@/components/ui/Toast';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import { api } from '@/lib/api';
import type { RequestLink } from '@/lib/types';
import requestStyles from '@/components/requests/Requests.module.css';
import styles from '@/components/settings/Settings.module.css';

/** Switch outside job requests on or off, and hand out the link people use to send them. */
export function RequestLinkSection() {
  const { isOwner, canEdit, wsPath } = useWorkspace();
  const { data: link, error } = useWsQuery<RequestLink>('/request-link');
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const toast = useToast();

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!link) return <Loading />;

  const url = link.token ? `${window.location.origin}/submit/${link.token}` : null;
  const set = (body: { enabled: boolean; renew?: boolean }, message: string) => run(() => api.put(wsPath('/request-link')!, body), message);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast('Request link copied');
    } catch {
      toast('Could not copy. Select the link and copy it by hand.', 'danger');
    }
  };

  const renew = async () => {
    const ok = await confirm({
      title: 'Replace the request link?',
      message: 'The current link stops working straight away, so anyone you gave it to needs the new one. Requests already sent are not affected.',
      confirmLabel: 'Replace link',
    });
    if (ok) await set({ enabled: true, renew: true }, 'New request link created');
  };

  const turnOff = async () => {
    const ok = await confirm({
      title: 'Turn off outside requests?',
      message: 'The link stops working and nobody can send new requests. Requests already sent stay in the queue, and their progress links keep working.',
      confirmLabel: 'Turn off',
      danger: true,
    });
    if (ok) await set({ enabled: false }, 'Outside requests turned off');
  };

  return (
    <>
      <SectionTitle action={<Badge tone={link.enabled ? 'ok' : 'neutral'}>{link.enabled ? 'On' : 'Off'}</Badge>}>Job requests from outside</SectionTitle>
      <Muted>
        Anyone with the link can describe a job and send files, without an account. Requests wait under Jobs, in the Requests tab, until an admin has checked the files and approves them, asks for changes or rejects them. Nothing becomes a job until then.
      </Muted>

      <div className={styles.general}>
        {!link.enabled && (
          <>
            <Muted>Outside requests are off. No link exists.</Muted>
            {isOwner ? (
              <div>
                <Button variant="primary" icon={Link2} onClick={() => set({ enabled: true }, 'Request link created')} disabled={busy}>
                  Turn on and create link
                </Button>
              </div>
            ) : (
              <Muted>Only an owner can turn them on.</Muted>
            )}
          </>
        )}

        {link.enabled && url && (
          <>
            <div className={requestStyles.linkBox}>
              <span className={requestStyles.linkText}>{url}</span>
              <Button icon={Copy} onClick={copy}>
                Copy
              </Button>
              <a href={url} target="_blank" rel="noreferrer noopener">
                Open <ExternalLink size={13} aria-hidden />
              </a>
            </div>
            <Muted>Treat the link like an invitation: anyone who has it can send files. Replace it if it ends up somewhere it should not.</Muted>
            {isOwner && (
              <div className={styles.danger}>
                <Button icon={RefreshCw} onClick={renew} disabled={busy}>
                  Replace link
                </Button>
                <Button variant="danger" icon={Link2Off} onClick={turnOff} disabled={busy}>
                  Turn off
                </Button>
              </div>
            )}
          </>
        )}

        {link.enabled && !url && <Muted>Outside requests are on. {canEdit ? '' : 'Ask an admin or owner for the link.'}</Muted>}
      </div>

      <Muted>
        Each request can carry up to {link.limits.maxFiles} files of {link.limits.maxMb} MB. Accepted types: {link.limits.extensions.map((ext) => `.${ext}`).join(' ')}. These limits are set on the server (UPLOAD_* in server/.env).
      </Muted>
    </>
  );
}
