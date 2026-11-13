import { Meter } from '@/components/ui/Display';
import { isLow } from '@/lib/format';
import type { Item } from '@/lib/types';

/**
 * The one rule for stock gauges: measure against capacity when the item has one (a spool, a tank),
 * otherwise against twice the minimum, and put the notch at the minimum. Null when there is nothing to measure.
 */
export function StockMeter({ item, compact = false }: { item: Pick<Item, 'name' | 'quantity' | 'capacity' | 'minQuantity'>; compact?: boolean }) {
  const max = item.capacity ?? (item.minQuantity > 0 ? item.minQuantity * 2 : null);
  if (!max) return null;
  return (
    <Meter
      value={item.quantity}
      max={max}
      threshold={item.minQuantity > 0 ? item.minQuantity : undefined}
      tone={isLow(item) ? 'danger' : 'accent'}
      label={item.capacity ? `${item.name} remaining` : `${item.name} against minimum`}
      compact={compact}
    />
  );
}
