import { Settings2 } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { StockMeter } from '@/components/items/StockMeter';
import { Badge, Figure, Muted, Swatch } from '@/components/ui/Display';
import type { Catalog } from '@/hooks/useCatalog';
import { formatQuantity, isLow, summarizeFields } from '@/lib/format';
import { describeDetected } from '@/lib/spoolMatch';
import type { Item, PrinterFeeder, Slot, SubUnit } from '@/lib/types';
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
  /** Loading and unloading slots: operators may, without editing the attachment itself. */
  canLoad?: boolean;
  onEdit: () => void;
  onSlot: (slot: Slot) => void;
  /** The live feeder behind a printer-kept unit: fresher than what was last saved, and knows which tray is feeding. */
  feeder?: PrinterFeeder;
}

/** Readings as the printer gives them right now, in the same words the saved ones use. */
function liveReadings(feeder: PrinterFeeder): Array<{ label: string; value: string; unit: string }> {
  const readings: Array<{ label: string; value: string; unit: string }> = [];
  if (feeder.humidityPercent !== null) readings.push({ label: 'Humidity', value: String(Math.round(feeder.humidityPercent)), unit: '%' });
  else if (feeder.humidityLevel !== null) readings.push({ label: 'Dryness', value: `${feeder.humidityLevel} of 5`, unit: '' });
  if (feeder.temperature !== null) readings.push({ label: 'Temperature', value: String(Math.round(feeder.temperature)), unit: '°C' });
  return readings;
}

export function SubUnitPanel({ subUnit, catalog, itemById, canEdit, canLoad = canEdit, onEdit, onSlot, feeder }: SubUnitPanelProps) {
  const readings = feeder ? liveReadings(feeder) : subUnit.readings;
  return (
    <section className={styles.subUnit}>
      <header className={styles.subUnitHead}>
        <div className={styles.subUnitTitle}>
          <strong>{subUnit.name}</strong>
          {subUnit.kind && subUnit.kind !== subUnit.name && <Muted>{subUnit.kind}</Muted>}
          {subUnit.externalId && <Muted>read from the printer</Muted>}
        </div>
        <div className={styles.readingBadges}>
          {readings.map((reading) => (
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
            // What the printer sees in this tray: live when there is a feeder, otherwise as last saved.
            const tray = feeder?.trays.find((candidate) => candidate.position === slot.position);
            const detected = tray ?? slot.detected;
            const unknownSpool = !item && detected?.state === 'loaded';
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
                ) : unknownSpool ? (
                  <>
                    <span className={styles.slotName}>
                      {detected.colour && <Swatch color={detected.colour} size={14} />}
                      {detected.subType ?? detected.material}
                    </span>
                    <span className={styles.slotHint}>{canLoad ? 'Not linked to stock. Tap to link.' : 'Not linked to stock'}</span>
                  </>
                ) : (
                  <span className={styles.slotEmpty}>Empty</span>
                )}
              </>
            );
            const state = `${styles.slot} ${item ? '' : unknownSpool ? styles.slotUnknown : styles.slotIsEmpty} ${tray?.active ? styles.slotActive : ''}`;
            const label = [
              `Slot ${slot.label || slot.position}`,
              item ? item.name : unknownSpool ? `${describeDetected(detected)}, not linked to stock` : 'empty',
              tray?.active ? 'feeding now' : '',
            ].filter(Boolean).join(', ');
            return canLoad ? (
              <button key={slot.id} type="button" className={state} aria-label={label} onClick={() => onSlot(slot)}>
                {content}
              </button>
            ) : (
              <div key={slot.id} className={state} aria-label={label}>
                {content}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
