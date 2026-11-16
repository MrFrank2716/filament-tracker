import { useEffect, useRef, useState } from 'react';
import { CircleCheck, Copy, Nfc } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useAction, useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import type { Catalog } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import { isLocalAddress, itemLink } from '@/lib/labels';
import { listenForTags, nfcAvailable, nfcProblem, type TagContents, type TagSession } from '@/lib/nfc';
import { cannotTag, stickerTag, toOpenSpool } from '@/lib/openspool';
import { parseScan } from '@/lib/scan';
import { isStickerTag } from '@/lib/spoolMatch';
import type { Item } from '@/lib/types';
import styles from '@/components/tags/Tags.module.css';

interface Props {
  item: Item;
  items: Item[];
  catalog: Catalog;
  onClose: () => void;
}

type Step =
  | { at: 'ready' }
  | { at: 'waiting' }
  /** The sticker held up already belongs to another spool in stock. */
  | { at: 'taken'; other: Item; contents: TagContents }
  | { at: 'writing' }
  | { at: 'done' };

/**
 * Write an NFC sticker for a spool: the link that opens it in Wrkbench, and an OpenSpool record saying what
 * the filament is. On Android Chrome the phone writes it; elsewhere the two pieces can be copied into any
 * NFC-writing app.
 */
export function TagDialog({ item, items, catalog, onClose }: Props) {
  const { wsPath } = useWorkspace();
  const { run, busy } = useAction();
  const toast = useToast();
  const [step, setStep] = useState<Step>({ at: 'ready' });
  const [problem, setProblem] = useState('');
  // A spool with a tag the printer reads: writing a sticker replaces Wrkbench's record of that tag.
  const hasPrinterTag = Boolean(item.tagId) && !isStickerTag(item.tagId);
  const [overridden, setOverridden] = useState(false);
  const session = useRef<TagSession | null>(null);
  useEffect(() => () => session.current?.stop(), []);

  const blocked = cannotTag(item, catalog);
  const record = toOpenSpool(item, catalog);
  const json = record ? JSON.stringify(record) : '';
  const url = itemLink(window.location.origin, item.id);
  const canWrite = nfcAvailable();

  const write = async (contents: TagContents) => {
    setStep({ at: 'writing' });
    try {
      await session.current!.write(url, json);
      const tagId = stickerTag(contents.serial);
      // Remember which sticker this is, so reading it later finds the spool even if its contents were changed.
      if (tagId) await api.put(wsPath(`/items/${item.id}/tag`)!, { tagId });
      session.current?.stop();
      session.current = null;
      setStep({ at: 'done' });
    } catch (error) {
      setProblem(nfcProblem(error));
      setStep({ at: 'waiting' });
    }
  };

  const onTag = (contents: TagContents) => {
    setProblem('');
    // Whose sticker is this already? By its serial, or by the link it carries.
    const tagId = stickerTag(contents.serial);
    const linked = contents.url ? parseScan(contents.url) : null;
    const other = items.find((candidate) => candidate.id !== item.id && ((tagId && candidate.tagId === tagId) || (linked?.kind === 'item' && candidate.id === linked.id)));
    if (other) setStep({ at: 'taken', other, contents });
    else void write(contents);
  };
  const latest = useRef(onTag);
  latest.current = onTag;

  const start = async () => {
    setProblem('');
    try {
      session.current = await listenForTags((contents) => latest.current(contents), setProblem);
      setStep({ at: 'waiting' });
    } catch (error) {
      setProblem(nfcProblem(error));
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied`);
    } catch {
      toast('Could not copy. Select the text and copy it by hand.', 'danger');
    }
  };

  const forget = async () => {
    if (await run(() => api.put(wsPath(`/items/${item.id}/tag`)!, { tagId: null }), 'Sticker forgotten')) onClose();
  };

  return (
    <Modal title={`Spool tag for ${item.name}`} onClose={onClose} footer={<Button onClick={onClose}>{step.at === 'done' ? 'Done' : 'Close'}</Button>}>
      {blocked ? (
        <p className={styles.note}>{blocked}</p>
      ) : (
        <div className={styles.steps}>
          {hasPrinterTag && !overridden && step.at === 'ready' && (
            <div className={styles.warning}>
              This spool has its own tag that the printer reads, so it is already recognised by itself wherever it is loaded. Writing a sticker makes Wrkbench forget that tag: the printer will stop recognising this spool until it is linked again.
              <div className={styles.row}>
                <Button size="sm" onClick={() => setOverridden(true)}>
                  Use a sticker anyway
                </Button>
              </div>
            </div>
          )}

          {canWrite && (!hasPrinterTag || overridden) && (
            <>
              {step.at === 'ready' && (
                <Button variant="primary" size="lg" icon={Nfc} onClick={start}>
                  Write a sticker
                </Button>
              )}
              {step.at === 'waiting' && (
                <div className={styles.status}>
                  <Nfc size={22} aria-hidden /> Hold the sticker against the back of the phone
                </div>
              )}
              {step.at === 'taken' && (
                <div className={styles.warning}>
                  This sticker is already on {step.other.name}. Moving it here makes it open this spool instead.
                  <div className={styles.row}>
                    <Button size="sm" variant="primary" onClick={() => void write(step.contents)}>
                      Move it to this spool
                    </Button>
                    <Button size="sm" onClick={() => setStep({ at: 'waiting' })}>
                      Use another sticker
                    </Button>
                  </div>
                </div>
              )}
              {step.at === 'writing' && (
                <div className={styles.status}>
                  <Nfc size={22} aria-hidden /> Writing: keep the sticker still
                </div>
              )}
              {step.at === 'done' && (
                <div className={`${styles.status} ${styles.done}`}>
                  <CircleCheck size={22} aria-hidden /> Written. Tap the sticker with any phone to open this spool.
                </div>
              )}
              {problem && <p className={styles.warning}>{problem}</p>}
            </>
          )}

          {!canWrite && (
            <p className={styles.note}>
              This device cannot write tags from the browser (only Chrome on Android can). Use any NFC-writing app instead: add a link record and a data record (type application/json) with the two pieces below, link first.
            </p>
          )}

          {isLocalAddress(window.location.origin) && (
            <p className={styles.warning}>
              The link below points at {window.location.origin}, which only this computer can open. Open Wrkbench at the address everyone uses before writing a sticker, or tapping it will not open the spool.
            </p>
          )}
          <div className={styles.section}>
            <span className={styles.note}>Link to this spool</span>
            <pre className={styles.record}>{url}</pre>
            <span className={styles.note}>OpenSpool record</span>
            <pre className={styles.record}>{json}</pre>
            <div className={styles.row}>
              <Button size="sm" icon={Copy} onClick={() => void copy(url, 'Link')}>
                Copy link
              </Button>
              <Button size="sm" icon={Copy} onClick={() => void copy(json, 'OpenSpool record')}>
                Copy OpenSpool JSON
              </Button>
            </div>
          </div>

          {isStickerTag(item.tagId) && step.at !== 'done' && (
            <div className={styles.section}>
              <span className={styles.note}>A sticker is tied to this spool. Forget it if the sticker was thrown away or moved by hand.</span>
              <div className={styles.row}>
                <Button size="sm" onClick={forget} disabled={busy}>
                  Forget the sticker
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
