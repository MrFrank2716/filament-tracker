import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PackageOpen, PackageSearch, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { ItemBoard, type BoardGrouping } from '@/components/items/ItemBoard';
import { ItemForm } from '@/components/items/ItemForm';
import { ItemSheet } from '@/components/items/ItemSheet';
import { Button } from '@/components/ui/Button';
import { StockMeter } from '@/components/items/StockMeter';
import { Badge, Chip, ChipRow, EmptyState, ErrorNote, Figure, List, Loading, Muted, PageHeader, Row, Swatch, Tabs, TypeIcon } from '@/components/ui/Display';
import { FormGrid, NumberField, SelectField } from '@/components/ui/Form';
import { useMachineFocus } from '@/context/FocusContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useCatalog, useItems } from '@/hooks/useCatalog';
import { fits, flattenLocations, formatQuantity, isLow, isWorn, locationPath, parseNumber, summarizeFields } from '@/lib/format';
import type { Item } from '@/lib/types';
import itemStyles from '@/components/items/Items.module.css';
import styles from '@/pages/InventoryPage.module.css';

type Flag = 'low' | 'worn' | 'offcut' | 'loaded';
type Sort = 'name' | 'quantity' | 'recent';
type View = 'list' | BoardGrouping;

const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'category', label: 'By category' },
  { id: 'machine', label: 'By machine' },
  { id: 'location', label: 'By location' },
  { id: 'list', label: 'List' },
];

/** The chosen layout is remembered on this device. */
const VIEW_KEY = 'filament-tracker.inventory-view';

function storedView(): View {
  try {
    const value = localStorage.getItem(VIEW_KEY);
    return VIEWS.find((view) => view.id === value)?.id ?? 'category';
  } catch {
    return 'category';
  }
}

const FLAGS: Array<{ id: Flag; label: string; test: (item: Item) => boolean }> = [
  { id: 'low', label: 'Low stock', test: isLow },
  { id: 'worn', label: 'Worn', test: isWorn },
  { id: 'offcut', label: 'Offcuts', test: (item) => item.isRemnant },
  { id: 'loaded', label: 'Loaded in a machine', test: (item) => item.slot !== null },
];

export function InventoryPage() {
  const { canEdit } = useWorkspace();
  const catalog = useCatalog();
  const { items: allItems, loading, error } = useItems();
  const { machine, relates } = useMachineFocus();
  // With one machine in focus, the inventory is what is loaded in it and what fits it.
  const items = useMemo(() => (machine ? allItems.filter(relates) : allItems), [allItems, machine, relates]);
  const [params, setParams] = useSearchParams();

  const [query, setQuery] = useState('');
  const [typeId, setTypeId] = useState<string | null>(null);
  const [flags, setFlags] = useState<Set<Flag>>(new Set());
  const [locationId, setLocationId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [needed, setNeeded] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState<View>(storedView);
  const [form, setForm] = useState<{ item?: Item; initial?: Partial<Item> } | null>(null);

  const selectedId = params.get('item');
  // Links from elsewhere open an item even when it is outside the focus.
  const selected = allItems.find((i) => i.id === selectedId);
  /** What a new item starts with: the category being browsed, and the machine in focus. */
  const preset = (): Partial<Item> => ({
    ...(typeId ? { itemTypeId: typeId } : {}),
    ...(machine ? { compatibleMachineIds: [machine.id] } : {}),
  });
  const open = (id: string | null) => setParams(id ? { item: id } : {}, { replace: true });

  const type = typeId ? catalog.typeById.get(typeId) : undefined;
  const sizeFields = useMemo(() => type?.fields.filter((f) => f.isSizeDimension && f.fieldType === 'number') ?? [], [type]);
  const locations = useMemo(() => flattenLocations(catalog.locations), [catalog.locations]);

  /** A location filter includes everything stored beneath it. */
  const locationScope = useMemo(() => {
    if (!locationId) return null;
    const scope = new Set([locationId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const location of catalog.locations) {
        if (location.parentId && scope.has(location.parentId) && !scope.has(location.id)) {
          scope.add(location.id);
          grew = true;
        }
      }
    }
    return scope;
  }, [locationId, catalog.locations]);

  const filtered = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const need = sizeFields.map((f) => parseNumber(needed[f.key] ?? '') ?? 0);
    const sizing = need.some((n) => n > 0);

    const result = items.filter((item) => {
      if (typeId && item.itemTypeId !== typeId) return false;
      for (const flag of FLAGS) if (flags.has(flag.id) && !flag.test(item)) return false;
      if (locationScope && (!item.locationId || !locationScope.has(item.locationId))) return false;
      if (supplierId && item.supplierId !== supplierId) return false;
      if (sizing) {
        const have = sizeFields.map((f) => Number(item.fields[f.key]) || 0);
        if (item.quantity <= 0 || !fits(need, have)) return false;
      }
      if (words.length) {
        const itemType = catalog.typeById.get(item.itemTypeId);
        const haystack = [
          item.name, item.sku, item.notes, itemType?.name,
          ...Object.values(item.fields).map((v) => (v === null ? '' : String(v))),
          locationPath(item.locationId, catalog.locations),
          item.supplierId ? catalog.supplierById.get(item.supplierId)?.name : '',
          item.slot?.subUnit.name,
        ]
          .join(' ')
          .toLowerCase();
        if (!words.every((word) => haystack.includes(word))) return false;
      }
      return true;
    });

    const area = (item: Item) => sizeFields.reduce((product, f) => product * (Number(item.fields[f.key]) || 0), 1);
    return result.sort((a, b) => {
      // When searching by size, the smallest piece that fits comes first: use offcuts before full sheets.
      if (sizing) return Number(b.isRemnant) - Number(a.isRemnant) || area(a) - area(b);
      if (sort === 'quantity') return a.quantity - b.quantity;
      if (sort === 'recent') return b.updatedAt.localeCompare(a.updatedAt);
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
  }, [items, query, typeId, flags, locationScope, supplierId, sizeFields, needed, sort, catalog.typeById, catalog.locations, catalog.supplierById]);

  const changeView = (next: View) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Private browsing: the choice just lasts for this visit.
    }
  };

  const toggleFlag = (flag: Flag) =>
    setFlags((current) => {
      const next = new Set(current);
      if (next.has(flag)) next.delete(flag);
      else next.add(flag);
      return next;
    });

  const countByType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.itemTypeId, (counts.get(item.itemTypeId) ?? 0) + 1);
    return counts;
  }, [items]);

  if (error || catalog.error) return <ErrorNote>{error ?? catalog.error}</ErrorNote>;
  if (loading || catalog.loading) return <Loading />;

  const extraFilters = Number(Boolean(locationId)) + Number(Boolean(supplierId)) + Number(sort !== 'name');

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle={`${filtered.length} of ${items.length} items${machine ? ` loaded in or fitting ${machine.name}` : ''}`}
        actions={
          canEdit && (
            <Button variant="primary" icon={Plus} onClick={() => setForm({ initial: preset() })}>
              Add item
            </Button>
          )
        }
      />

      <div className={styles.filters}>
        <div className={styles.searchRow}>
          <label className={itemStyles.search}>
            <Search size={18} aria-hidden />
            <input
              className={itemStyles.searchInput}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, material, size, location…"
              aria-label="Search inventory"
              enterKeyHint="search"
            />
          </label>
          <Button icon={SlidersHorizontal} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            {extraFilters ? `Filters (${extraFilters})` : 'Filters'}
          </Button>
        </div>

        <ChipRow label="Category">
          <Chip active={typeId === null} onClick={() => { setTypeId(null); setNeeded({}); }} count={items.length}>
            All
          </Chip>
          {catalog.types.map((t) => (
            <Chip key={t.id} active={typeId === t.id} onClick={() => { setTypeId(typeId === t.id ? null : t.id); setNeeded({}); }} count={countByType.get(t.id) ?? 0}>
              <TypeIcon icon={t.icon} tone={t.color} size="sm" />
              {t.name}
            </Chip>
          ))}
        </ChipRow>

        <ChipRow label="Status">
          {FLAGS.map((flag) => (
            <Chip key={flag.id} active={flags.has(flag.id)} onClick={() => toggleFlag(flag.id)} count={items.filter(flag.test).length}>
              {flag.label}
            </Chip>
          ))}
        </ChipRow>

        {showFilters && (
          <FormGrid>
            <SelectField label="Location" value={locationId} onChange={setLocationId}>
              <option value="">Anywhere</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {'  '.repeat(l.depth)}
                  {l.name}
                </option>
              ))}
            </SelectField>
            <SelectField label="Supplier" value={supplierId} onChange={setSupplierId}>
              <option value="">Any supplier</option>
              {catalog.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectField>
            <SelectField label="Sort by" value={sort} onChange={(value) => setSort(value as Sort)}>
              <option value="name">Name</option>
              <option value="quantity">Quantity, lowest first</option>
              <option value="recent">Recently changed</option>
            </SelectField>
          </FormGrid>
        )}

        {sizeFields.length > 0 && (
          <div className={styles.sizeSearch}>
            <div>
              <strong>Find a piece that fits</strong>
              <Muted> Enter the size you need. Pieces are matched in any orientation, offcuts first.</Muted>
            </div>
            <FormGrid>
              {sizeFields.map((field) => (
                <NumberField
                  key={field.key}
                  label={`${field.label} needed`}
                  value={needed[field.key] ?? ''}
                  onChange={(value) => setNeeded((current) => ({ ...current, [field.key]: value }))}
                  suffix={field.unit || undefined}
                />
              ))}
            </FormGrid>
          </div>
        )}
      </div>

      {items.length > 0 && <Tabs tabs={VIEWS} active={view} onChange={changeView} />}

      {items.length === 0 ? (
        machine ? (
          <EmptyState icon={PackageOpen} title={`Nothing linked to ${machine.name} yet`} action={canEdit && <Button variant="primary" icon={Plus} onClick={() => setForm({ initial: preset() })}>Add an item for it</Button>}>
            Items show here once they are loaded in this machine or marked as fitting it. Open an item, choose Edit, and pick the machine under "Fits these machines".
          </EmptyState>
        ) : (
          <EmptyState
            icon={PackageOpen}
            title="No inventory yet"
            action={canEdit && <Button variant="primary" icon={Plus} onClick={() => setForm({})}>Add your first item</Button>}
          >
            Add spools, tooling, sheet stock, spares or anything else you want to keep track of. You can also import a CSV from Settings.
          </EmptyState>
        )
      ) : filtered.length === 0 ? (
        <EmptyState icon={PackageSearch} title="Nothing matches those filters">
          Try fewer words or clear a filter.
        </EmptyState>
      ) : view !== 'list' ? (
        <ItemBoard
          items={filtered}
          catalog={catalog}
          grouping={view}
          hideEmpty={filtered.length !== items.length || machine !== null}
          canEdit={canEdit}
          focusMachineId={machine?.id}
          onOpen={open}
          onAdd={(column) => setForm({ initial: { ...preset(), ...column } })}
        />
      ) : (
        <List>
          {filtered.map((item) => {
            const itemType = catalog.typeById.get(item.itemTypeId);
            const unit = item.unitId ? catalog.unitById.get(item.unitId) : null;
            const colour = itemType?.fields.find((f) => f.fieldType === 'color');
            const colourValue = colour ? item.fields[colour.key] : null;
            const low = isLow(item);
            const worn = isWorn(item);
            const place = item.slot ? `${item.slot.subUnit.name} · slot ${item.slot.position}` : (catalog.locationById.get(item.locationId ?? '')?.name ?? '');
            const summary = [itemType ? summarizeFields(itemType.fields, item.fields) : '', place].filter(Boolean).join(' · ');
            return (
              <Row
                key={item.id}
                onClick={() => open(item.id)}
                flagged={low || worn}
                leading={<TypeIcon icon={itemType?.icon} tone={itemType?.color} />}
                title={
                  <>
                    {typeof colourValue === 'string' && colourValue && <Swatch color={colourValue} />}
                    <span className={styles.name}>{item.name}</span>
                  </>
                }
                subtitle={summary}
                trailing={
                  <>
                    <Figure>{formatQuantity(item.quantity, unit)}</Figure>
                    {/* One signal per state: the bar plus a gauge, or a badge where there is no gauge. */}
                    {worn ? (
                      <Badge tone="danger">Worn</Badge>
                    ) : item.isRemnant && !low ? (
                      <Badge>Offcut</Badge>
                    ) : item.capacity || item.minQuantity > 0 ? (
                      <span className={styles.gauge}>
                        <StockMeter item={item} compact />
                      </span>
                    ) : null}
                  </>
                }
              />
            );
          })}
        </List>
      )}

      {canEdit && (
        <button type="button" className={styles.fab} onClick={() => setForm({ initial: preset() })} aria-label="Add item">
          <Plus size={26} aria-hidden />
        </button>
      )}

      {selected && !form && (
        <ItemSheet
          key={selected.id}
          item={selected}
          catalog={catalog}
          onClose={() => open(null)}
          onEdit={() => setForm({ item: selected })}
          onAddOffcut={() =>
            setForm({
              initial: {
                itemTypeId: selected.itemTypeId, name: `Offcut: ${selected.name}`, quantity: 1, unitId: selected.unitId,
                fields: selected.fields, locationId: selected.locationId, parentId: selected.id, isRemnant: true,
              },
            })
          }
        />
      )}

      {form && <ItemForm catalog={catalog} item={form.item} initial={form.initial} onClose={() => setForm(null)} />}
    </>
  );
}
