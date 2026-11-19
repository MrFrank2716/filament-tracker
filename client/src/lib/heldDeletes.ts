/**
 * Deletes being held back for their Undo toast (see hooks/useUndo.ts). Each entry sends its delete now.
 * Kept apart from the hook so that signing out can send them without importing any screen code.
 */
export const heldDeletes = new Set<() => void>();

/** Send every held delete now: the page is closing, or the member is signing out. */
export function flushHeldDeletes(): void {
  for (const send of [...heldDeletes]) send();
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', flushHeldDeletes);
