import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useTopDialog } from '@/components/ui/Modal';
import { refreshAll } from '@/lib/store';
import styles from '@/components/ui/Toast.module.css';

type ToastTone = 'ok' | 'danger';
export interface ToastOptions {
  /** A button on the toast, usually Undo. The toast then stays for 8 seconds, and goes when the button is pressed. */
  action?: { label: string; run: () => void };
  /** A newer toast with the same key takes the place of the older one instead of stacking on it. */
  key?: string;
}
interface ToastMessage extends ToastOptions {
  id: number;
  text: string;
  tone: ToastTone;
  leaving?: boolean;
}

/** How long a toast with a button stays: long enough to notice a mistake and reach for Undo. */
export const UNDO_WINDOW_MS = 8000;

/** Matches --duration-exit plus a frame of slack. */
const TOAST_EXIT_MS = 120;

const ToastContext = createContext<(text: string, tone?: ToastTone, options?: ToastOptions) => void>(() => undefined);

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextId = useRef(1);
  const regionRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((t) => t.id !== id)), []);

  const toast = useCallback((text: string, tone: ToastTone = 'ok', options: ToastOptions = {}) => {
    const id = nextId.current++;
    const shown = options.action ? UNDO_WINDOW_MS : tone === 'danger' ? 6000 : 2600;
    setToasts((current) => [...current.filter((t) => !options.key || t.key !== options.key).slice(-2), { id, text, tone, ...options }]);
    // Fade out over the last 120 ms rather than vanishing mid-read; the live region is unaffected.
    setTimeout(() => setToasts((current) => current.map((t) => (t.id === id ? { ...t, leaving: true } : t))), shown - TOAST_EXIT_MS);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), shown);
  }, []);

  // Modal dialogs live in the browser's top layer and make everything outside them unclickable. So the region
  // is drawn inside whichever dialog is on top (or the page when none is), and shown as a popover, which lifts it
  // above that dialog: errors are never hidden behind one, and Undo can be pressed while one is open.
  // Moving to another dialog draws the region afresh, which replays the entrance of toasts already showing.
  const host = useTopDialog();
  const newest = toasts.at(-1)?.id;
  useEffect(() => {
    const region = regionRef.current;
    // While a dialog closes, the region is briefly still inside it and off the page; this runs again once it has moved.
    if (!region?.showPopover || !region.isConnected) return;
    const open = region.matches(':popover-open');
    if (newest === undefined) {
      if (open) region.hidePopover();
      return;
    }
    if (!open) region.showPopover();
  }, [newest, host]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {createPortal(
      <div ref={regionRef} popover="manual" className={styles.region} aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`${styles.toast} ${styles[t.tone] ?? ''} ${t.leaving ? styles.leaving : ''}`} role={t.tone === 'danger' ? 'alert' : 'status'}>
            {t.tone === 'danger' ? <CircleAlert size={18} aria-hidden /> : <CircleCheck size={18} aria-hidden />}
            <span className={styles.text}>{t.text}</span>
            {t.action && (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  dismiss(t.id);
                  t.action?.run();
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>,
      host ?? document.body,
      )}
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
