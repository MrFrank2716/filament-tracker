import { useCallback } from 'react';
import { useAction } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import { api } from '@/lib/api';
import type { Slot, SubUnit } from '@/lib/types';

/** Loading and unloading a slot, from wherever it is done: the machines page, an item's sheet, a scan. */
export function useSlotActions() {
  const { wsPath } = useWorkspace();
  const { run, busy } = useAction();
  /** Put an item in a slot (it leaves whichever slot it was in), or empty the slot with null. Resolves true when done. */
  const setSlot = useCallback(
    (subUnit: Pick<SubUnit, 'id'>, slot: Pick<Slot, 'position'>, itemId: string | null) =>
      run(() => api.put(wsPath(`/sub-units/${subUnit.id}/slots/${slot.position}`)!, { itemId }), itemId ? 'Loaded' : 'Unloaded'),
    [run, wsPath],
  );
  return { setSlot, busy };
}
