import { useMemo, useState } from 'react';
import { Check, PackageSearch, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState, Figure, List, Row, Swatch, TypeIcon } from '@/components/ui/Display';
import { Modal } from '@/components/ui/Modal';
import type { Catalog } from '@/hooks/useCatalog';
import { formatQuantity, summarizeFields } from '@/lib/format';
import type { Item } from '@/lib/types';
import styles from '@/components/items/Items.module.css';

interface Props {
  title: string;
  items: Item[];
  catalog: Catalog;
  onPick: (item: Item) => void;
  onClose: () => void;
  /** Optional extra line under each row, e.g. where it is currently loaded. */
  note?: (item: Item) => string;
  /** Choose several, then confirm: tapping a row ticks it instead of picking it. */
  multi?: { confirmLabel: (count: number) => string; onConfirm: (items: Item[]) => void; busy?: boolean };
}

/** Search-and-tap chooser used wherever something in stock has to be selected. */
export function ItemPicker({ title, items, catalog, onPick, onClose, note, multi }: Props) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return items
      .filter((item) => {
        if (!words.length) return true;
        const type = catalog.typeById.get(item.itemTypeId);
        const haystack = `${item.name} ${type?.name ?? ''} ${Object.values(item.fields).join(' ')} ${item.sku}`.toLowerCase();
        return words.every((word) => haystack.includes(word));
      })
      .slice(0, 60);
  }, [items, query, catalog.typeById]);

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        multi ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={chosen.size === 0 || multi.busy} onClick={() => multi.onConfirm(items.filter((item) => chosen.has(item.id)))}>
              {multi.confirmLabel(chosen.size)}
            </Button>
          </>
        ) : undefined
      }
    >
      <label className={styles.search}>
        <Search size={18} aria-hidden />
        <input className={styles.searchInput} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, material, size…" aria-label="Search items" autoFocus />
      </label>
      {matches.length === 0 ? (
        <EmptyState icon={PackageSearch} title="Nothing matches" />
      ) : (
        <List>
          {matches.map((item) => {
            const type = catalog.typeById.get(item.itemTypeId);
            const colour = type?.fields.find((f) => f.fieldType === 'color');
            const colourValue = colour ? item.fields[colour.key] : null;
            const summary = [type ? summarizeFields(type.fields, item.fields) : '', note?.(item) ?? ''].filter(Boolean).join(' · ');
            return (
              <Row
                key={item.id}
                onClick={() => (multi ? toggle(item.id) : onPick(item))}
                leading={
                  multi ? (
                    <span className={`${styles.tick} ${chosen.has(item.id) ? styles.ticked : ''}`} role="checkbox" aria-checked={chosen.has(item.id)} aria-label={`Choose ${item.name}`}>
                      {chosen.has(item.id) && <Check size={14} strokeWidth={3} aria-hidden />}
                    </span>
                  ) : (
                    <TypeIcon icon={type?.icon} tone={type?.color} />
                  )
                }
                title={
                  <>
                    {typeof colourValue === 'string' && colourValue && <Swatch color={colourValue} />}
                    {item.name}
                  </>
                }
                subtitle={summary}
                trailing={<Figure>{formatQuantity(item.quantity, item.unitId ? catalog.unitById.get(item.unitId) : null)}</Figure>}
              />
            );
          })}
        </List>
      )}
    </Modal>
  );
}
