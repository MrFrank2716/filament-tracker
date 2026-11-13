import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Chip, ChipRow, ErrorNote, Muted, TypeIcon } from '@/components/ui/Display';
import { Checkbox, FormGrid, NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useAction } from '@/components/ui/Toast';
import { CustomFieldInput, fromDraft, toDraft, type FieldDraft } from '@/components/items/CustomFieldInput';
import { useWorkspace } from '@/context/WorkspaceContext';
import type { Catalog } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import { flattenLocations, formatNumber, parseNumber } from '@/lib/format';
import type { Item } from '@/lib/types';
import styles from '@/components/items/Items.module.css';

interface Props {
  catalog: Catalog;
  /** Existing item to edit. */
  item?: Item;
  /** Starting values for a new item (e.g. an offcut copied from its parent sheet). */
  initial?: Partial<Item>;
  onClose: () => void;
  onSaved?: (item: Item) => void;
}

const numberText = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value));

export function ItemForm({ catalog, item, initial, onClose, onSaved }: Props) {
  const { wsPath, workspace } = useWorkspace();
  const { run, busy } = useAction();
  const source: Partial<Item> = item ?? initial ?? {};

  const [typeId, setTypeId] = useState(source.itemTypeId ?? catalog.types[0]?.id ?? '');
  const type = catalog.typeById.get(typeId);
  const [name, setName] = useState(source.name ?? '');
  const [quantity, setQuantity] = useState(numberText(source.quantity ?? (item ? 0 : null)));
  const [unitId, setUnitId] = useState(source.unitId ?? type?.defaultUnitId ?? '');
  const [minQuantity, setMinQuantity] = useState(numberText(source.minQuantity || null));
  const [capacity, setCapacity] = useState(numberText(source.capacity));
  // Cost is entered the way it is paid for ("19.99 per 1000 g") and stored per single unit.
  const [priceQty, setPriceQty] = useState(numberText(source.capacity ?? 1));
  const [price, setPrice] = useState(source.unitCost ? String(Number((source.unitCost * (source.capacity ?? 1)).toFixed(4))) : '');
  const [supplierId, setSupplierId] = useState(source.supplierId ?? '');
  const [locationId, setLocationId] = useState(source.locationId ?? '');
  const [sku, setSku] = useState(source.sku ?? '');
  const [notes, setNotes] = useState(source.notes ?? '');
  const [usageHours, setUsageHours] = useState(numberText(source.usageHours || null));
  const [lifeHours, setLifeHours] = useState(numberText(source.lifeHours));
  const [wearFlag, setWearFlag] = useState(source.wearFlag ?? false);
  const [isRemnant, setIsRemnant] = useState(source.isRemnant ?? false);
  const [machineIds, setMachineIds] = useState<string[]>(source.compatibleMachineIds ?? []);
  const [draft, setDraft] = useState<FieldDraft>(() => toDraft(type?.fields ?? [], source.fields ?? {}));
  const [error, setError] = useState('');

  const unit = catalog.unitById.get(unitId);
  const locations = useMemo(() => flattenLocations(catalog.locations), [catalog.locations]);

  const changeType = (id: string) => {
    const next = catalog.typeById.get(id);
    setTypeId(id);
    if (next?.defaultUnitId) setUnitId(next.defaultUnitId);
    // Keep whatever was already typed for fields the new type also has.
    setDraft((current) => ({ ...toDraft(next?.fields ?? [], {}), ...Object.fromEntries(Object.entries(current).filter(([key]) => next?.fields.some((f) => f.key === key))) }));
  };

  const toggleMachine = (id: string) => setMachineIds((current) => (current.includes(id) ? current.filter((m) => m !== id) : [...current, id]));

  const save = async () => {
    setError('');
    if (!type) return setError('Choose a category first. You can add categories in Settings.');
    if (!name.trim()) return setError('Give the item a name.');
    const qty = parseNumber(quantity) ?? 0;
    if (qty < 0) return setError('Quantity cannot be negative.');
    const missing = type.fields.find((f) => f.required && (draft[f.key] === '' || draft[f.key] === undefined));
    if (missing) return setError(`${missing.label} is required.`);
    const per = parseNumber(priceQty) || 1;
    const paid = parseNumber(price) ?? 0;

    const body = {
      itemTypeId: type.id,
      name: name.trim(),
      sku: sku.trim(),
      quantity: qty,
      unitId: unitId || null,
      minQuantity: Math.max(0, parseNumber(minQuantity) ?? 0),
      capacity: parseNumber(capacity) || null,
      unitCost: Math.max(0, paid / per),
      supplierId: supplierId || null,
      locationId: locationId || null,
      notes,
      fields: fromDraft(type.fields, draft),
      usageHours: Math.max(0, parseNumber(usageHours) ?? 0),
      lifeHours: parseNumber(lifeHours) || null,
      wearFlag,
      isRemnant,
      parentId: source.parentId ?? null,
      compatibleMachineIds: machineIds,
    };

    let saved: Item | undefined;
    const ok = await run(async () => {
      saved = item ? await api.patch<Item>(wsPath(`/items/${item.id}`)!, body) : await api.post<Item>(wsPath('/items')!, body);
    }, item ? 'Saved' : 'Item added');
    if (ok) {
      if (saved) onSaved?.(saved);
      onClose();
    }
  };

  return (
    <Modal
      title={item ? `Edit ${item.name}` : 'Add item'}
      size="lg"
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {item ? 'Save changes' : 'Add item'}
          </Button>
        </>
      }
    >
      {catalog.types.length === 0 ? (
        <ErrorNote>This workspace has no item categories yet. Add one under Settings → Categories first.</ErrorNote>
      ) : (
        <ChipRow label="Category">
          {catalog.types.map((t) => (
            <Chip key={t.id} active={t.id === typeId} onClick={() => changeType(t.id)}>
              <TypeIcon icon={t.icon} tone={t.color} size="sm" toned />
              {t.name}
            </Chip>
          ))}
        </ChipRow>
      )}

      <FormGrid>
        <TextField label="Name *" value={name} onChange={setName} wide autoFocus={!item} placeholder={type ? `e.g. a ${type.name.toLowerCase()}` : ''} />
        <NumberField label="Quantity in stock" value={quantity} onChange={setQuantity} suffix={unit?.symbol} placeholder="0" />
        <SelectField label="Unit" value={unitId} onChange={setUnitId}>
          <option value="">No unit</option>
          {catalog.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.symbol})
            </option>
          ))}
        </SelectField>
        {type?.fields.map((field) => (
          <CustomFieldInput key={field.key} field={field} value={draft[field.key]} onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))} />
        ))}
      </FormGrid>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Stock and cost</legend>
        <FormGrid>
          <NumberField label="Minimum stock level" value={minQuantity} onChange={setMinQuantity} suffix={unit?.symbol} hint="Below this it joins the reorder list." placeholder="0" />
          <NumberField label="Full / pack size" value={capacity} onChange={(value) => { setCapacity(value); if (!price) setPriceQty(value || '1'); }} suffix={unit?.symbol} hint="Optional. Shows a fill gauge and sets the reorder amount." />
          <NumberField label={`Price (${workspace?.currency ?? ''})`} value={price} onChange={setPrice} placeholder="0.00" />
          <NumberField label="Price is for" value={priceQty} onChange={setPriceQty} suffix={unit?.symbol} hint={pricePerUnitHint(price, priceQty, unit?.symbol)} />
          <SelectField label="Supplier" value={supplierId} onChange={setSupplierId}>
            <option value="">None</option>
            {catalog.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Location" value={locationId} onChange={setLocationId}>
            <option value="">None</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {'  '.repeat(l.depth)}
                {l.name}
              </option>
            ))}
          </SelectField>
        </FormGrid>
      </fieldset>

      {type?.tracksLife && (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Tool life</legend>
          <FormGrid>
            <NumberField label="Hours used so far" value={usageHours} onChange={setUsageHours} suffix="h" placeholder="0" />
            <NumberField label="Expected life" value={lifeHours} onChange={setLifeHours} suffix="h" hint="Jobs add hours; it is flagged when this is reached." />
          </FormGrid>
          <Checkbox label="Flag as worn now" checked={wearFlag} onChange={setWearFlag} />
        </fieldset>
      )}

      <details className={styles.details} open={Boolean(sku || notes || machineIds.length || isRemnant)}>
        <summary className={styles.summary}>More details</summary>
        <div className={styles.detailsBody}>
          <FormGrid>
            <TextField label="SKU / barcode" value={sku} onChange={setSku} />
            <TextAreaField label="Notes" value={notes} onChange={setNotes} />
          </FormGrid>
          <Checkbox label="This is an offcut / remnant" hint="Kept out of the reorder list and easy to find by size." checked={isRemnant} onChange={setIsRemnant} />
          {catalog.machines.length > 0 && (
            <div>
              <Muted>Fits these machines</Muted>
              <ChipRow label="Compatible machines">
                {catalog.machines.map((machine) => (
                  <Chip key={machine.id} active={machineIds.includes(machine.id)} onClick={() => toggleMachine(machine.id)}>
                    {machine.name}
                  </Chip>
                ))}
              </ChipRow>
            </div>
          )}
        </div>
      </details>

      {error && <ErrorNote>{error}</ErrorNote>}
    </Modal>
  );
}

function pricePerUnitHint(price: string, per: string, symbol: string | undefined): string | undefined {
  const paid = parseNumber(price);
  const quantity = parseNumber(per) || 1;
  if (!paid || quantity === 1) return undefined;
  return `= ${formatNumber(paid / quantity, 4)} per ${symbol ?? 'unit'}`;
}
