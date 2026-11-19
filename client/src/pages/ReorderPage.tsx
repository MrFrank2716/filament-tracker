import { Link } from 'react-router-dom';
import { CircleCheck, Copy, Download, ExternalLink, PackagePlus } from 'lucide-react';
import { StockMeter } from '@/components/items/StockMeter';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, ErrorNote, Figure, HeaderStat, Muted, PageHeader, PageSkeleton } from '@/components/ui/Display';
import { useToast } from '@/components/ui/Toast';
import { useMachineFocus } from '@/context/FocusContext';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import { useItems } from '@/hooks/useCatalog';
import { useStockChange } from '@/hooks/useUndo';
import { saveBlob } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import type { ReorderData, ReorderLine } from '@/lib/types';
import styles from '@/pages/ReorderPage.module.css';

const amount = (value: number, line: ReorderLine) => `${formatNumber(value, line.decimals)}${line.unit ? ` ${line.unit}` : ''}`;
const csvCell = (value: string | number) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Only follow links that are plainly web addresses; supplier websites are free text typed by members. */
const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? url : null);

const sum = (values: number[]) => Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;

function scopeTo(data: ReorderData, itemIds: Set<string>): ReorderData {
  const groups = data.groups
    .map((group) => {
      const lines = group.lines.filter((line) => itemIds.has(line.itemId));
      return { ...group, lines, total: sum(lines.map((line) => line.estimatedCost)) };
    })
    .filter((group) => group.lines.length > 0);
  return { groups, total: sum(groups.map((group) => group.total)) };
}

export function ReorderPage() {
  const { canEdit, money, workspace } = useWorkspace();
  const { data: all, error } = useWsQuery<ReorderData>('/reorder');
  const { items } = useItems();
  const { machine, relates } = useMachineFocus();
  const stock = useStockChange();
  const busy = stock.busy;
  const toast = useToast();

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!all) return <PageSkeleton title="Reorder" subtitle="Built from items below their minimum and tooling at the end of its life." />;

  // With one machine in focus, keep only the lines for things loaded in it or fitting it, and re-total.
  const data: ReorderData = machine ? scopeTo(all, new Set(items.filter(relates).map((item) => item.id))) : all;
  const itemById = new Map(items.map((item) => [item.id, item]));
  const lineCount = data.groups.reduce((total, group) => total + group.lines.length, 0);

  const asText = () =>
    data.groups
      .map((group) => [`${group.supplier?.name ?? 'No supplier set'}`, ...group.lines.map((line) => `  - ${line.name}: ${amount(line.suggested, line)}${line.reason === 'worn' ? ' (replace worn)' : ''}`)].join('\n'))
      .join('\n\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      toast('Reorder list copied');
    } catch {
      toast('Could not copy. Use the CSV download instead.', 'danger');
    }
  };

  const download = () => {
    const rows = [
      ['supplier', 'item', 'category', 'reason', 'in_stock', 'minimum', 'order_quantity', 'unit', 'estimated_cost'],
      ...data.groups.flatMap((group) =>
        group.lines.map((line) => [group.supplier?.name ?? '', line.name, line.typeName, line.reason, line.quantity, line.minQuantity, line.suggested, line.unit, line.estimatedCost]),
      ),
    ];
    saveBlob(new Blob(['﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), `reorder-${workspace?.name ?? 'list'}.csv`);
  };

  const receive = (line: ReorderLine) =>
    stock.change(line.itemId, { mode: 'delta', value: line.suggested, reason: 'restock', note: 'Received from reorder list' }, `${line.name} restocked`);

  return (
    <>
      <PageHeader
        title="Reorder"
        subtitle="Built from items below their minimum and tooling at the end of its life."
        actions={data.groups.length > 0 && <HeaderStat label="Estimated total" value={money(data.total)} hint={`${lineCount} line${lineCount === 1 ? '' : 's'} · ${data.groups.length} supplier${data.groups.length === 1 ? '' : 's'}`} />}
      />

      {data.groups.length > 0 && (
        <div className={styles.toolbar}>
          <Button icon={Copy} onClick={copy}>
            Copy list
          </Button>
          <Button icon={Download} onClick={download}>
            Download CSV
          </Button>
        </div>
      )}

      {data.groups.length === 0 ? (
        <EmptyState icon={CircleCheck} title={machine ? `Nothing to reorder for ${machine.name}` : 'Nothing to reorder'}>
          {machine
            ? 'Everything loaded in this machine or fitting it is at or above its minimum, and its tooling is within life.'
            : 'Every item is at or above its minimum stock level. Set a minimum on an item to have it appear here when it runs low.'}
        </EmptyState>
      ) : (
        data.groups.map((group) => {
          const website = group.supplier ? safeUrl(group.supplier.website) : null;
          return (
            <section key={group.supplier?.id ?? 'none'} className={styles.group}>
              <header className={styles.supplier}>
                <div className={styles.supplierText}>
                  <h2 className={styles.supplierName}>{group.supplier?.name ?? 'No supplier set'}</h2>
                  {website && (
                    <a href={website} target="_blank" rel="noreferrer noopener" className={styles.link}>
                      Open store <ExternalLink size={13} aria-hidden />
                    </a>
                  )}
                  {group.supplier?.email && <Muted>{group.supplier.email}</Muted>}
                </div>
                <Figure>{money(group.total)}</Figure>
              </header>
              <ul className={styles.lines}>
                {group.lines.map((line) => {
                  const item = itemById.get(line.itemId);
                  return (
                    <li key={line.itemId} className={styles.line}>
                      <div className={styles.lineText}>
                        <Link to={`/inventory?item=${line.itemId}`} className={styles.lineName}>
                          {line.name}
                        </Link>
                        <span className={styles.lineMeta}>
                          {line.typeName} · have {amount(line.quantity, line)}
                          {line.minQuantity > 0 ? ` · min ${amount(line.minQuantity, line)}` : ''}
                        </span>
                        {line.reason === 'low' && item && <StockMeter item={item} compact />}
                      </div>
                      <div className={styles.lineOrder}>
                        {line.reason === 'worn' && <Badge tone="warn">Worn</Badge>}
                        <span>
                          Order <Figure>{amount(line.suggested, line)}</Figure>
                        </span>
                        {line.estimatedCost > 0 && (
                          <Muted>
                            <Figure>{money(line.estimatedCost)}</Figure>
                          </Muted>
                        )}
                      </div>
                      {canEdit && line.reason === 'low' && (
                        <Button size="sm" icon={PackagePlus} onClick={() => receive(line)} disabled={busy}>
                          Received
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </>
  );
}
