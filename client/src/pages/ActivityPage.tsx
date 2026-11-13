import { useState } from 'react';
import { History, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge, Chip, ChipRow, EmptyState, ErrorNote, List, Loading, Muted, PageHeader, Row } from '@/components/ui/Display';
import { useConfirm } from '@/components/ui/Modal';
import { useAction } from '@/components/ui/Toast';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { Activity } from '@/lib/types';

type Filter = 'all' | 'stock' | 'jobs' | 'requests' | 'setup';

const FILTERS: Array<{ id: Filter; label: string; match: (entry: Activity) => boolean }> = [
  { id: 'all', label: 'Everything', match: () => true },
  { id: 'stock', label: 'Stock', match: (entry) => entry.entityType === 'item' || entry.action === 'import' || (entry.action === 'activity.undo' && entry.entityType === 'item') },
  { id: 'jobs', label: 'Jobs and queue', match: (entry) => entry.entityType === 'job' || entry.action === 'queue.set' },
  { id: 'requests', label: 'Requests', match: (entry) => entry.entityType === 'jobRequest' || entry.entityType === 'requestLink' },
  { id: 'setup', label: 'Set-up and members', match: (entry) => !['item', 'job', 'jobRequest', 'requestLink'].includes(entry.entityType) && entry.action !== 'import' },
];

/** Who changed what and when, with undo for stock edits made by mistake. */
export function ActivityPage() {
  const { wsPath, canEdit } = useWorkspace();
  const { data: entries, error } = useWsQuery<Activity[]>('/activity?limit=200');
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [filter, setFilter] = useState<Filter>('all');

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!entries) return <Loading />;

  const match = FILTERS.find((f) => f.id === filter)!.match;
  const shown = entries.filter(match);

  const undo = async (entry: Activity) => {
    const ok = await confirm({
      title: 'Undo this stock change?',
      message: `"${entry.summary}" will be reversed with a new stock entry, so the history still shows both. Any changes made to the same items since are kept.`,
      confirmLabel: 'Undo',
    });
    if (ok) await run(() => api.post(wsPath(`/activity/${entry.id}/undo`)!), 'Stock change undone');
  };

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle={canEdit ? 'Every change made in this workspace, newest first. Stock edits made by mistake can be undone.' : 'Every change made in this workspace, newest first.'}
      />
      <ChipRow label="Show">
        {FILTERS.map((f) => (
          <Chip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </Chip>
        ))}
      </ChipRow>

      {shown.length === 0 ? (
        <EmptyState icon={History} title="Nothing recorded yet">
          Changes appear here as soon as anyone in the workspace makes them.
        </EmptyState>
      ) : (
        <List>
          {shown.map((entry) => (
            <Row
              key={entry.id}
              title={entry.summary}
              subtitle={`${entry.userName || 'Someone'} · ${formatDateTime(entry.createdAt)}`}
              trailing={
                entry.undoneAt ? (
                  <Badge tone="neutral">Undone</Badge>
                ) : entry.undoable ? (
                  <Button size="sm" icon={Undo2} onClick={() => undo(entry)} disabled={busy}>
                    Undo
                  </Button>
                ) : undefined
              }
            />
          ))}
        </List>
      )}
      {entries.length >= 200 && <Muted>Showing the latest 200 changes.</Muted>}
    </>
  );
}
