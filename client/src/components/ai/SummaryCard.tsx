import { Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/Display';
import { useWsQuery } from '@/context/WorkspaceContext';
import styles from '@/components/ai/Assistant.module.css';

/** Today's few sentences on the workshop, written by the assistant once a day. Left out when there is none. */
export function SummaryCard() {
  const { data } = useWsQuery<{ text: string | null }>('/ai/summary');
  if (!data?.text) return null;
  return (
    <Card className={styles.card}>
      <div className={styles.heading}>
        <Sparkles size={14} aria-hidden />
        Today, in short
      </div>
      <p className={styles.summary}>{data.text}</p>
      <p className={styles.foot}>Written by AI from this workshop's figures. Check before acting on it.</p>
    </Card>
  );
}
