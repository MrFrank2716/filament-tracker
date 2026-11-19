import { useCallback, useState } from 'react';
import { UNDO_WINDOW_MS, useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import { api } from '@/lib/api';
import { heldDeletes } from '@/lib/heldDeletes';
import { maskCached, refreshAll } from '@/lib/store';
import type { Item } from '@/lib/types';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong');

interface StockChange {
  mode: 'delta' | 'set';
  value: number;
  reason?: 'restock' | 'adjust';
  note?: string;
}

/**
 * Change an item's stock and say so in a toast with Undo on it, for members who may undo (admins and owners).
 * Undo is the same one Activity offers: a new entry that reverses this one, so the history shows both.
 */
export function useStockChange() {
  const toast = useToast();
  const { wsPath } = useWorkspace();
  const [busy, setBusy] = useState(false);

  const change = useCallback(
    async (itemId: string, body: StockChange, done: string): Promise<boolean> => {
      setBusy(true);
      try {
        const { undoId } = await api.postUndoable<Item>(wsPath(`/items/${itemId}/adjust`)!, body);
        refreshAll();
        const undo = async () => {
          try {
            await api.post(wsPath(`/activity/${undoId}/undo`)!);
            refreshAll();
            toast('Stock change undone');
          } catch (error) {
            toast(messageOf(error), 'danger');
          }
        };
        // One toast per item: tapping -1 five times leaves one toast, whose Undo takes back the last tap.
        toast(done, 'ok', { key: `stock:${itemId}`, action: undoId ? { label: 'Undo', run: () => void undo() } : undefined });
        return true;
      } catch (error) {
        toast(messageOf(error), 'danger');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [toast, wsPath],
  );

  return { change, busy };
}

/**
 * Delete an item without asking first: it leaves the screen at once and a toast offers Undo. The delete itself
 * is sent when the toast has gone, so Undo simply never sends it. Closing the page sends it straight away.
 */
export function useItemDelete() {
  const toast = useToast();
  const { wsPath } = useWorkspace();

  return useCallback(
    (item: Pick<Item, 'id' | 'name'>) => {
      const path = wsPath(`/items/${item.id}`)!;
      const show = maskCached<Item[]>(wsPath('/items')!, (all) => all.filter((other) => other.id !== item.id));
      let settled = false;
      const send = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        heldDeletes.delete(send);
        api
          .delete(path)
          .catch((error: unknown) => toast(messageOf(error), 'danger'))
          .finally(() => {
            show();
            refreshAll();
          });
      };
      const timer = window.setTimeout(send, UNDO_WINDOW_MS);
      heldDeletes.add(send);
      toast(`${item.name} deleted`, 'ok', {
        action: {
          label: 'Undo',
          run: () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            heldDeletes.delete(send);
            show();
          },
        },
      });
    },
    [toast, wsPath],
  );
}
