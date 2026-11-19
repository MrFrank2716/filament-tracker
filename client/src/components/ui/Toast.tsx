import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { refreshAll } from '@/lib/store';
import styles from '@/components/ui/Toast.module.css';

type ToastTone = 'ok' | 'danger';
interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
  leaving?: boolean;
}

/** Matches --duration-exit plus a frame of slack. */
const TOAST_EXIT_MS = 120;

const ToastContext = createContext<(text: string, tone?: ToastTone) => void>(() => undefined);

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextId = useRef(1);
  const regionRef = useRef<HTMLDivElement>(null);

  const toast = useCallback((text: string, tone: ToastTone = 'ok') => {
    const id = nextId.current++;
    const shown = tone === 'danger' ? 6000 : 2600;
    setToasts((current) => [...current.slice(-2), { id, text, tone }]);
    // Fade out over the last 120 ms rather than vanishing mid-read; the live region is unaffected.
    setTimeout(() => setToasts((current) => current.map((t) => (t.id === id ? { ...t, leaving: true } : t))), shown - TOAST_EXIT_MS);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), shown);
  }, []);

  // Modal dialogs live in the browser's top layer. When a toast arrives while one is open, re-showing the region
  // as a popover lifts it above the dialog, so errors are never hidden behind one. Only then: re-showing restarts
  // the entrance of every toast already on screen.
  const newest = toasts.at(-1)?.id;
  useEffect(() => {
    const region = regionRef.current;
    if (!region?.showPopover) return;
    const open = region.matches(':popover-open');
    if (newest === undefined) {
      if (open) region.hidePopover();
      return;
    }
    if (open && document.querySelector('dialog:modal')) region.hidePopover();
    if (!region.matches(':popover-open')) region.showPopover();
  }, [newest]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div ref={regionRef} popover="manual" className={styles.region} aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`${styles.toast} ${styles[t.tone] ?? ''} ${t.leaving ? styles.leaving : ''}`} role={t.tone === 'danger' ? 'alert' : 'status'}>
            {t.tone === 'danger' ? <CircleAlert size={18} aria-hidden /> : <CircleCheck size={18} aria-hidden />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Run a write: shows the busy state, refreshes on-screen data afterwards,
 * and turns a failure into a toast. Resolves to whether it succeeded.
 */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (action: () => Promise<unknown>, success?: string): Promise<boolean> => {
      setBusy(true);
      try {
        await action();
        refreshAll();
        if (success) toast(success);
        return true;
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Something went wrong', 'danger');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  return { run, busy };
}

/**
 * Run a small, harmless write (a switch, a flag) without making anyone wait: `show` changes the screen at once
 * and returns how to put it back, which happens, with the error, if the save fails.
 */
export function useOptimisticAction() {
  const toast = useToast();
  return useCallback(
    async (show: () => () => void, action: () => Promise<unknown>): Promise<boolean> => {
      const putBack = show();
      try {
        await action();
        refreshAll();
        return true;
      } catch (error) {
        putBack();
        toast(error instanceof Error ? error.message : 'Something went wrong', 'danger');
        return false;
      }
    },
    [toast],
  );
}
