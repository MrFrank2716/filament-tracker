import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import styles from '@/components/ui/Modal.module.css';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Sticky action row. */
  footer?: ReactNode;
  /** When set, the body is a form and Enter submits. */
  onSubmit?: () => void;
  size?: 'md' | 'lg';
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Exit: a still copy of the closing dialog, outside the top layer and hidden from assistive tech and the pointer,
 * fades and drops slightly, then goes. Its backdrop is a box-shadow, so it fades with it.
 */
function leaveBehind(dialog: HTMLDialogElement) {
  // Copy now, while it still holds its content; show the copy only if React really removed the dialog
  // (StrictMode's rehearsal unmount in development keeps the node).
  const ghost = dialog.cloneNode(true) as HTMLDialogElement;
  queueMicrotask(() => {
    if (dialog.isConnected) return;
    ghost.inert = true;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.classList.add(styles.ghost);
    document.body.append(ghost);
    void ghost.offsetWidth; // commit the starting style so the change below transitions
    ghost.classList.add(styles.leaving);
    const remove = () => ghost.remove();
    ghost.addEventListener('transitionend', remove, { once: true });
    window.setTimeout(remove, 250);
  });
}

/** Native <dialog>: focus trapping and Escape for free. Slides up as a sheet on phones. */
export function Modal({ title, onClose, children, footer, onSubmit, size = 'md' }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // Closing unmounts the dialog, so CSS never gets to animate it out. A layout cleanup runs before React removes
  // the node: leave an inert copy in its place and fade that instead. Focus returns to the trigger at once.
  useLayoutEffect(() => {
    const dialog = ref.current;
    return () => {
      if (!dialog?.open) return;
      if (!prefersReducedMotion()) leaveBehind(dialog);
      dialog.close();
    };
  }, []);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit?.();
  };

  const content = (
    <>
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <IconButton icon={X} label="Close" onClick={onClose} />
      </header>
      <div className={styles.body}>{children}</div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </>
  );

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${styles[size]}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      {onSubmit ? (
        <form className={styles.frame} onSubmit={handleSubmit} noValidate>
          {content}
        </form>
      ) : (
        <div className={styles.frame}>{content}</div>
      )}
    </dialog>
  );
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => false);

/** `const confirm = useConfirm(); if (await confirm({...})) ...` */
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );
  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Modal
          title={pending.title}
          onClose={() => settle(false)}
          footer={
            <>
              <Button onClick={() => settle(false)}>Cancel</Button>
              <Button variant={pending.danger ? 'danger' : 'primary'} onClick={() => settle(true)} autoFocus>
                {pending.confirmLabel ?? 'Confirm'}
              </Button>
            </>
          }
        >
          <p className={styles.message}>{pending.message}</p>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}
