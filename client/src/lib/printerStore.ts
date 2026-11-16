import type { PendingSpoolEvent, PrinterState } from '@/lib/types';

/**
 * Live state of connected printers, by machine.
 *
 * Kept apart from the query cache in store.ts on purpose: printers report every second or two, and each
 * report arrives over the socket as one "printer:state" message that replaces that printer's entry here.
 * Nothing is re-fetched. The first value comes from GET /printers/state.
 */
const states = new Map<string, PrinterState>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** One printer's new state, from the socket. */
export function applyPrinterState(state: PrinterState): void {
  if (!state || typeof state.machineId !== 'string') return;
  states.set(state.machineId, state);
  notify();
}

/** The whole picture, from the server: also drops printers that have been unlinked. */
export function replacePrinterStates(next: PrinterState[]): void {
  states.clear();
  for (const state of next) states.set(state.machineId, state);
  notify();
}

/** Another workspace, or signed out: nothing here belongs to the new view. */
export function clearPrinterStates(): void {
  if (states.size === 0) return;
  states.clear();
  notify();
}

/** Subscribe to changes; returns the function that stops listening. */
export function watchPrinterStates(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const printerStates = (): Map<string, PrinterState> => states;

// ---- Scan, then insert: news of a scanned spool waiting to go into a printer -------------------

const pendingListeners = new Set<(event: PendingSpoolEvent) => void>();

/** From the socket: a scanned spool was armed, linked to a tray, or given up on. */
export function applyPendingSpool(event: PendingSpoolEvent): void {
  if (!event || typeof event.machineId !== 'string') return;
  pendingListeners.forEach((listener) => listener(event));
}

export function watchPendingSpool(listener: (event: PendingSpoolEvent) => void): () => void {
  pendingListeners.add(listener);
  return () => {
    pendingListeners.delete(listener);
  };
}
