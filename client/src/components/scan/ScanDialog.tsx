import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useCatalog, useItems } from '@/hooks/useCatalog';
import { cameraAvailable, cameraProblem, startScanner } from '@/lib/camera';
import { findByCode, parseScan, type Scan } from '@/lib/scan';
import styles from '@/components/scan/Scan.module.css';

export interface ScanNote {
  text: string;
  tone?: 'ok' | 'danger';
}

interface Props {
  title?: string;
  /** One line above the camera saying what to scan. */
  hint?: string;
  onClose: () => void;
  /**
   * Handle each scan and keep the scanner open, for doing the same thing to many labels in a row.
   * Return a line saying what happened. Without this, a scan opens the item or location and closes.
   */
  onScan?: (scan: Scan) => Promise<ScanNote> | ScanNote;
  /** Extra ways in, shown under the camera (stage: reading an NFC tag, pasting a tag's contents). */
  children?: ReactNode;
}

/**
 * Point the camera at a label. Codes can also be typed or pasted, which is also how a USB barcode reader
 * works (it types the code and presses Enter), and what is left when there is no camera to use.
 */
export function ScanDialog({ title = 'Scan a label', hint, onClose, onScan, children }: Props) {
  const navigate = useNavigate();
  const { items } = useItems();
  const { locations } = useCatalog();
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState('');
  const [typed, setTyped] = useState('');
  const [log, setLog] = useState<Array<ScanNote & { id: number }>>([]);
  const nextId = useRef(1);
  const hasCamera = cameraAvailable();

  const note = (entry: ScanNote) => setLog((current) => [{ ...entry, id: nextId.current++ }, ...current].slice(0, 30));

  const handle = async (raw: string) => {
    let scan = parseScan(raw);
    // A plain code may be an item's SKU or barcode, or a location's own label code.
    if (scan.kind === 'text') scan = findByCode(scan.text, items, locations) ?? scan;
    navigator.vibrate?.(40);
    if (onScan) {
      try {
        note(await onScan(scan));
      } catch (error) {
        note({ text: error instanceof Error ? error.message : 'Something went wrong', tone: 'danger' });
      }
      return;
    }
    if (scan.kind === 'item' || scan.kind === 'location') {
      onClose();
      // Through the link page, which finds the right workspace when the label belongs to another one.
      navigate(`/${scan.kind === 'item' ? 's' : 'l'}/${scan.id}`);
    } else if (scan.kind === 'openspool') {
      note({ text: 'That is a spool tag, not a Wrkbench label.', tone: 'danger' });
    } else {
      note({ text: `Nothing here has the code "${scan.text.slice(0, 60)}".`, tone: 'danger' });
    }
  };
  // The camera loop outlives renders; it always calls the latest handler.
  const latest = useRef(handle);
  latest.current = handle;

  useEffect(() => {
    if (!hasCamera || !video.current) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    startScanner(video.current, (text) => void latest.current(text))
      .then((started) => {
        if (cancelled) started();
        else stop = started;
      })
      .catch((error: unknown) => {
        if (!cancelled) setProblem(cameraProblem(error));
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [hasCamera]);

  const submitTyped = () => {
    if (!typed.trim()) return;
    void handle(typed);
    setTyped('');
  };

  return (
    <Modal title={title} onClose={onClose} onSubmit={submitTyped} footer={<Button onClick={onClose}>{onScan ? 'Done' : 'Close'}</Button>}>
      {hint && <p className={styles.note}>{hint}</p>}
      {hasCamera && !problem ? (
        <div className={styles.viewport}>
          <video ref={video} className={styles.video} muted playsInline aria-label="Camera" />
          <span className={styles.frame} aria-hidden />
        </div>
      ) : (
        <p className={styles.note}>{problem || 'The camera only works when Wrkbench is opened at a secure (https) address. You can still type or paste a code below.'}</p>
      )}
      <div className={styles.typed}>
        <TextField label="Or type a code" value={typed} onChange={setTyped} placeholder="Label code, SKU or barcode" autoComplete="off" autoCapitalize="off" enterKeyHint="go" />
        <Button type="submit" disabled={!typed.trim()}>
          Find
        </Button>
      </div>
      {children}
      {log.length > 0 && (
        <ul className={styles.log} aria-live="polite">
          {log.map((entry) => (
            <li key={entry.id} className={`${styles.entry} ${entry.tone === 'danger' ? styles.danger : styles.ok}`}>
              {entry.tone === 'danger' ? <CircleAlert size={16} aria-hidden /> : <CircleCheck size={16} aria-hidden />}
              {entry.text}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
