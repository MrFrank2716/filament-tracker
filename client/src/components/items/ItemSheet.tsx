import { useState } from 'react';
import { Minus, Pencil, Plus, Scissors, Trash2 } from 'lucide-react';
import { StockMeter } from '@/components/items/StockMeter';
import { Button } from '@/components/ui/Button';
import { Badge, Figure, Loading, Meter, Muted, SectionTitle, Swatch, TypeIcon } from '@/components/ui/Display';
import { NumberField } from '@/components/ui/Form';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { useAction } from '@/components/ui/Toast';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import type { Catalog } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import { formatDateTime, formatFieldValue, formatHours, formatNumber, formatQuantity, isLow, isWorn, locationPath, parseNumber } from '@/lib/format';
import { MOVEMENT_REASON } from '@/lib/status';
import type { Item, Movement, Unit } from '@/lib/types';
import styles from '@/components/items/Items.module.css';

interface Props {
  item: Item;
  catalog: Catalog;
  onClose: () => void;
  onEdit: () => void;
  onAddOffcut: () => void;
}

/** Step sizes that suit the scale of the item: grams move in tens, screws in ones. */
function stepsFor(item: Item, unit: Unit | undefined): number[] {
  const scale = Math.max(item.capacity ?? 0, item.quantity, item.minQuantity);
  if (unit && unit.decimals > 0 && scale < 20) return [0.1, 1];
  if (scale >= 400) return [10, 50, 100];
  if (scale >= 40) return [1, 10];
  return [1, 5];
}

export function ItemSheet({ item, catalog, onClose, onEdit, onAddOffcut }: Props) {
  const { wsPath, canEdit, money } = useWorkspace();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const { data: movements } = useWsQuery<Movement[]>(`/items/${item.id}/movements`);
  const [exact, setExact] = useState('');

  const type = catalog.typeById.get(item.itemTypeId);
  const unit = item.unitId ? catalog.unitById.get(item.unitId) : undefined;
  const supplier = item.supplierId ? catalog.supplierById.get(item.supplierId) : undefined;
  const colour = type?.fields.find((f) => f.fieldType === 'color');
  const colourValue = colour ? item.fields[colour.key] : null;
  const low = isLow(item);
  const worn = isWorn(item);
  const hasSize = type?.fields.some((f) => f.isSizeDimension) ?? false;

  const adjust = (delta: number) => run(() => api.post(wsPath(`/items/${item.id}/adjust`)!, { mode: 'delta', value: delta }));
  const setTo = async () => {
    const value = parseNumber(exact);
    if (value === null || value < 0) return;
    if (await run(() => api.post(wsPath(`/items/${item.id}/adjust`)!, { mode: 'set', value, note: 'Counted / weighed' }), 'Stock level set')) setExact('');
  };
  const remove = async () => {
    const ok = await confirm({ title: 'Delete item?', message: `"${item.name}" will be removed from inventory. Past jobs keep their record of it.`, confirmLabel: 'Delete', danger: true });
    if (ok && (await run(() => api.delete(wsPath(`/items/${item.id}`)!), 'Item deleted'))) onClose();
  };
  const toggleWear = () => run(() => api.patch(wsPath(`/items/${item.id}`)!, { wearFlag: !item.wearFlag }));

  const details: Array<[string, string]> = [
    ...(type?.fields ?? []).filter((f) => f.fieldType !== 'color').map((f): [string, string] => [f.label, formatFieldValue(f, item.fields[f.key])]),
    ['Location', locationPath(item.locationId, catalog.locations)],
    ['Loaded in', item.slot ? `${item.slot.subUnit.name}, slot ${item.slot.position}` : ''],
    ['Supplier', supplier?.name ?? ''],
    ['Cost', item.unitCost ? `${money(item.unitCost * (item.capacity ?? 1))} per ${formatQuantity(item.capacity ?? 1, unit)}` : ''],
    ['Value in stock', item.unitCost ? money(item.unitCost * item.quantity) : ''],
    ['Fits', item.compatibleMachineIds.map((id) => catalog.machineById.get(id)?.name).filter(Boolean).join(', ')],
    ['SKU', item.sku],
    ['Notes', item.notes],
  ];

  return (
    <Modal
      title={item.name}
      onClose={onClose}
      footer={
        canEdit ? (
          <>
            <Button variant="danger" icon={Trash2} onClick={remove} disabled={busy}>
              Delete
            </Button>
            {hasSize && !item.isRemnant && (
              <Button icon={Scissors} onClick={onAddOffcut}>
                Add offcut
              </Button>
            )}
            <Button icon={Pencil} onClick={onEdit}>
              Edit
            </Button>
          </>
        ) : undefined
      }
    >
      <div className={styles.sheetHead}>
        <TypeIcon icon={type?.icon} tone={type?.color} size="lg" toned />
        <div className={styles.sheetHeadText}>
          <span className={styles.sheetType}>
            {type?.name}
            {typeof colourValue === 'string' && colourValue && <Swatch color={colourValue} label={`Colour ${colourValue}`} />}
          </span>
          <div className={styles.badges}>
            {low && <Badge tone="danger">Low stock</Badge>}
            {worn && <Badge tone="danger">Worn</Badge>}
            {item.isRemnant && <Badge tone="info">Offcut</Badge>}
            {item.slot && <Badge tone="accent">{item.slot.subUnit.name}</Badge>}
          </div>
        </div>
      </div>

      <div className={styles.stock}>
        <div className={styles.stockFigure}>
          <span className={`${styles.stockValue} ${low ? styles.stockLow : ''}`}>{formatNumber(item.quantity, unit?.decimals ?? 2)}</span>
          <span className={styles.stockUnit}>{unit?.symbol}</span>
        </div>
        <StockMeter item={item} />
        <Muted>
          {item.capacity ? `of ${formatQuantity(item.capacity, unit)}` : ''}
          {item.capacity && item.minQuantity > 0 ? ' · ' : ''}
          {item.minQuantity > 0 ? `minimum ${formatQuantity(item.minQuantity, unit)}` : ''}
        </Muted>

        {canEdit && (
          <>
            <div className={styles.steps}>
              {stepsFor(item, unit)
                .slice()
                .reverse()
                .map((step) => (
                  <Button key={`minus-${step}`} size="lg" icon={Minus} disabled={busy || item.quantity <= 0} onClick={() => adjust(-step)} aria-label={`Use ${step} ${unit?.symbol ?? ''}`}>
                    {formatNumber(step, 1)}
                  </Button>
                ))}
              {stepsFor(item, unit).map((step) => (
                <Button key={`plus-${step}`} size="lg" icon={Plus} disabled={busy} onClick={() => adjust(step)} aria-label={`Add ${step} ${unit?.symbol ?? ''}`}>
                  {formatNumber(step, 1)}
                </Button>
              ))}
            </div>
            <form
              className={styles.exact}
              onSubmit={(event) => {
                event.preventDefault();
                void setTo();
              }}
            >
              <NumberField label="Counted or weighed? Set the exact amount" value={exact} onChange={setExact} suffix={unit?.symbol} placeholder={String(item.quantity)} />
              <Button type="submit" variant="primary" disabled={busy || parseNumber(exact) === null}>
                Set
              </Button>
            </form>
          </>
        )}
      </div>

      {type?.tracksLife && (
        <div className={styles.life}>
          <SectionTitle
            action={
              canEdit && (
                <Button size="sm" onClick={toggleWear} disabled={busy}>
                  {item.wearFlag ? 'Clear worn flag' : 'Flag as worn'}
                </Button>
              )
            }
          >
            Tool life
          </SectionTitle>
          {item.lifeHours ? <Meter value={item.usageHours} max={item.lifeHours} threshold={item.lifeHours * 0.8} tone={worn ? 'danger' : item.usageHours >= item.lifeHours * 0.8 ? 'warn' : 'accent'} label="Tool life used" /> : null}
          <Figure tone={worn ? 'danger' : undefined}>
            {formatHours(item.usageHours)} used{item.lifeHours ? ` of ${formatHours(item.lifeHours)}` : ''}
          </Figure>
        </div>
      )}

      <dl className={styles.facts}>
        {details
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className={styles.fact}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>

      <div>
        <SectionTitle>History</SectionTitle>
        {!movements ? (
          <Loading />
        ) : movements.length === 0 ? (
          <Muted>No stock changes recorded yet.</Muted>
        ) : (
          <ul className={styles.history}>
            {movements.slice(0, 12).map((move) => (
              <li key={move.id} className={styles.move}>
                <Figure tone={move.delta < 0 ? 'neutral' : 'ok'}>
                  {move.delta > 0 ? '+' : ''}
                  {formatNumber(move.delta, unit?.decimals ?? 2)}
                </Figure>
                <span className={styles.moveText}>
                  {MOVEMENT_REASON[move.reason] ?? move.reason}
                  {move.job ? `: ${move.job.name}` : move.note ? `: ${move.note}` : ''}
                </span>
                <Muted>
                  {formatDateTime(move.createdAt)}
                  {move.user ? ` · ${move.user.name}` : ''}
                </Muted>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
