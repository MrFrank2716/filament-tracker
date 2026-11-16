import { Plus, Tag } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState, Figure, List, Muted, Row, SectionTitle, Swatch } from '@/components/ui/Display';
import { Modal } from '@/components/ui/Modal';
import { useAction } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import type { Catalog } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import { formatQuantity, summarizeFields } from '@/lib/format';
import { fromOpenSpool } from '@/lib/openspool';
import { matchScore, newSpoolFrom } from '@/lib/spoolMatch';
import type { Item } from '@/lib/types';
import styles from '@/components/tags/Tags.module.css';

interface Props {
  /** What the tag holds. */
  record: Record<string, unknown>;
  /** The sticker's serial as kept on items ("NFC…"), when it was read from a sticker rather than pasted. */
  tagId: string | null;
  items: Item[];
  catalog: Catalog;
  onClose: () => void;
  /** The tag belongs to this spool in stock (now tied to it, when there is a serial). */
  onOpen: (item: Item) => void;
  /** Add it as a new spool, filled in from the tag. */
  onAdd: (initial: Partial<Item>) => void;
}

/**
 * A spool tag Wrkbench has not seen before. Usually it is on a spool that is already in stock, so those that
 * fit are offered first: choosing one ties the sticker to it instead of making a duplicate.
 */
export function TagImportDialog({ record, tagId, items, catalog, onClose, onOpen, onAdd }: Props) {
  const { wsPath, canEdit, canOperate } = useWorkspace();
  const { run, busy } = useAction();
  const detected = fromOpenSpool(record);

  if (!detected) {
    return (
      <Modal title="Spool tag" onClose={onClose}>
        <EmptyState icon={Tag} title="This tag does not say what filament it is">
          An OpenSpool tag names at least a material. This one does not, so there is nothing to fill in from it.
        </EmptyState>
      </Modal>
    );
  }

  const matches = items
    .map((item) => ({ item, score: matchScore(item, detected, catalog) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || Number(Boolean(a.item.tagId)) - Number(Boolean(b.item.tagId)) || a.item.name.localeCompare(b.item.name))
    .slice(0, 8);

  const choose = async (item: Item) => {
    // Tying a sticker to a spool is everyday bench work; without a serial there is nothing to tie.
    if (tagId && canOperate && !(await run(() => api.put(wsPath(`/items/${item.id}/tag`)!, { tagId }), `Sticker tied to ${item.name}`))) return;
    onOpen(item);
  };

  return (
    <Modal
      title="Spool tag"
      onClose={onClose}
      footer={
        canEdit ? (
          <Button variant={matches.length ? 'secondary' : 'primary'} icon={Plus} onClick={() => onAdd({ ...newSpoolFrom(detected, catalog), tagId })}>
            Add as a new spool
          </Button>
        ) : undefined
      }
    >
      <div className={styles.tagFacts}>
        {detected.colour && <Swatch color={detected.colour} size={28} />}
        <div>
          <strong>{[detected.material, detected.brand].filter(Boolean).join(' · ')}</strong>
          <div>
            <Muted>{detected.nozzleTemp ? `Nozzle ${detected.nozzleTemp[0]} to ${detected.nozzleTemp[1]} °C` : 'The tag gives no nozzle temperature'}</Muted>
          </div>
        </div>
      </div>

      {matches.length > 0 ? (
        <div className={styles.section}>
          <SectionTitle>This is one of these</SectionTitle>
          <Muted>{tagId ? 'Choose the spool the sticker is on: from then on scanning it opens that spool.' : 'Spools in stock that fit what the tag says.'}</Muted>
          <List>
            {matches.map(({ item, score }) => {
              const type = catalog.typeById.get(item.itemTypeId);
              return (
                <Row
                  key={item.id}
                  onClick={busy ? undefined : () => void choose(item)}
                  title={item.name}
                  subtitle={[type ? summarizeFields(type.fields, item.fields) : '', score >= 2 ? 'same material and colour' : 'same material'].filter(Boolean).join(' · ')}
                  trailing={<Figure>{formatQuantity(item.quantity, item.unitId ? catalog.unitById.get(item.unitId) : null)}</Figure>}
                />
              );
            })}
          </List>
        </div>
      ) : (
        <Muted>Nothing in stock fits this tag.{canEdit ? ' Add it as a new spool: the form is filled in from the tag.' : ' Ask an admin to add it as a new spool.'}</Muted>
      )}
    </Modal>
  );
}
