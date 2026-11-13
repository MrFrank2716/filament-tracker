import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useCatalog } from '@/hooks/useCatalog';
import type { Item } from '@/lib/types';

interface FocusValue {
  machineId: string | null;
  setMachineId: (id: string | null) => void;
}

const FocusContext = createContext<FocusValue>({ machineId: null, setMachineId: () => undefined });

const storageKey = (workspaceId: string) => `filament-tracker.focus.${workspaceId}`;

/** Holds the "whole workshop or one machine" choice for a workspace. Remembered on this device. */
export function FocusProvider({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const [machineId, setState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(storageKey(workspaceId));
    } catch {
      return null;
    }
  });

  const setMachineId = useCallback(
    (id: string | null) => {
      setState(id);
      try {
        if (id) localStorage.setItem(storageKey(workspaceId), id);
        else localStorage.removeItem(storageKey(workspaceId));
      } catch {
        /* the choice lasts for this visit only */
      }
    },
    [workspaceId],
  );

  const value = useMemo(() => ({ machineId, setMachineId }), [machineId, setMachineId]);
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

/**
 * The machine every screen is narrowed to, or null for the whole workshop.
 * `relates` says whether an item belongs to that machine: loaded in its hardware, or marked as fitting it.
 */
export function useMachineFocus() {
  const { machineId, setMachineId } = useContext(FocusContext);
  const { machineById } = useCatalog();
  // A machine that has since been deleted simply drops the focus.
  const machine = (machineId ? machineById.get(machineId) : undefined) ?? null;
  const focusId = machine?.id ?? null;

  const relates = useCallback(
    (item: Pick<Item, 'compatibleMachineIds' | 'slot'>) =>
      focusId === null || item.compatibleMachineIds.includes(focusId) || item.slot?.subUnit.machineId === focusId,
    [focusId],
  );

  return { machine, setFocus: setMachineId, relates };
}
