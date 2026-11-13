import { Settings2 } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { StockMeter } from '@/components/items/StockMeter';
import { Badge, Figure, Muted, Swatch } from '@/components/ui/Display';
import type { Catalog } from '@/hooks/useCatalog';
import { formatQuantity, isLow, summarizeFields } from '@/lib/format';
import type { Item, Slot, SubUnit } from '@/lib/types';
import styles from '@/components/machines/Machines.module.css';

export function colourOf(item: Item | undefined, catalog: Catalog): string | null {
  if (!item) return null;
  const field = catalog.typeById.get(item.itemTypeId)?.fields.find((f) => f.fieldType === 'color');
  const value = field ? item.fields[field.key] : null;
  return typeof value === 'string' && value ? value : null;
}

export function SlotSummary({ item, catalog }: { item: Item | undefined; catalog: Catalog }) {
  if (!item) return <Muted>Empty</Muted>;
  const type = catalog.typeById.get(item.itemTypeId);
  const colour = colourOf(item, catalog);
  return (
    <div className={styles.slotSummary}>
      {colour && <Swatch color={colour} size={28} />}
      <div>
        <strong>{item.name}</strong>
        <div>
          <Muted>{type ? summarizeFields(type.fields, item.fields) : ''}</Muted>
        </div>
      </div>
      <Figure>{formatQuantity(item.quantity, item.unitId ? catalog.unitById.get(item.unitId) : null)}</Figure>
    </div>
  );
}

interface SubUnitPanelProps {
  subUnit: SubUnit;
  catalog: Catalog;
  itemById: Map<string, Item>;
  canEdit: boolean;
  onEdit: () => void;
  onSlot: (slot: Slot) => void;
}

export function SubUnitPanel({ subUnit, catalog, itemById, canEdit, onEdit, onSlot }: SubUnitPanelProps) {
  return (
    <section className={styles.subUnit}>
      <header className={styles.subUnitHead}>
        <div className={styles.subUnitTitle}>
          <strong>{subUnit.name}</strong>
          {subUnit.kind && subUnit.kind !== subUnit.name && <Muted>{subUnit.kind}</Muted>}
        </div>
        <div className={styles.readingBadges}>
          {subUnit.readings.map((reading) => (
            <Badge key={reading.label}>
              {reading.label} {reading.value}
              {reading.unit}
            </Badge>
          ))}
        </div>
        {canEdit && <IconButton icon={Settings2} label={`Edit ${subUnit.name}`} size="sm" onClick={onEdit} />}
      </header>
      {subUnit.statusNote && <Muted>{subUnit.statusNote}</Muted>}
      {subUnit.slots.length > 0 && (
        <div className={styles.slots}>
          {subUnit.slots.map((slot) => {
            const item = slot.itemId ? itemById.get(slot.itemId) : undefined;
            const colour = colourOf(item, catalog);
            const unit = item?.unitId ? catalog.unitById.get(item.unitId) : null;
            const content = (
              <>
                <span className={styles.slotNumber}>{slot.label || slot.position}</span>
                {item ? (
                  <>
                    <span className={styles.slotName}>
                      {colour && <Swatch color={colour} size={14} />}
                      {item.name}
                    </span>
                    <span className={styles.slotQty}>
                      <Figure tone={isLow(item) && !item.capacity ? 'danger' : undefined}>{formatQuantity(item.quantity, unit)}</Figure>
                    </span>
                    {item.capacity ? <StockMeter item={item} compact /> : null}
                  </>
                ) : (
                  <span className={styles.slotEmpty}>Empty</span>
                )}
              </>
            );
            return canEdit ? (
              <button key={slot.id} type="button" className={`${styles.slot} ${item ? '' : styles.slotIsEmpty}`} onClick={() => onSlot(slot)}>
                {content}
              </button>
            ) : (
              <div key={slot.id} className={`${styles.slot} ${item ? '' : styles.slotIsEmpty}`}>
                {content}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
