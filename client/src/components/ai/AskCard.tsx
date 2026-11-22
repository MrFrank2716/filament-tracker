import { useState } from 'react';
import { MessageCircleQuestion, Send } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Display';
import { TextField } from '@/components/ui/Form';
import { useAction } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import { api } from '@/lib/api';
import type { AiStatus } from '@/lib/types';
import styles from '@/components/ai/Assistant.module.css';

const MAX_CHARS = 300;
/** The pause ends at midnight UTC on the 1st, so the date is read in UTC too, or it would show the day before in the Americas. */
const resumeDate = (iso: string | undefined) => (iso ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(iso)) : 'next month');

/** "Ask your workshop": one question at a time about stock, jobs and machines, answered from the app's own figures. */
export function AskCard({ status }: { status: AiStatus }) {
  const { wsPath, canOperate } = useWorkspace();
  const { run, busy } = useAction();
  const [question, setQuestion] = useState('');
  const [reply, setReply] = useState<{ question: string; answer: string } | null>(null);

  if (!canOperate) return null;
  const left = status.questionsLeft ?? 0;
  const blocked = status.paused || left === 0;

  const ask = () => {
    const asked = question.trim();
    return run(async () => {
      const { answer } = await api.post<{ answer: string }>(wsPath('/ai/ask')!, { question: asked });
      setReply({ question: asked, answer });
      setQuestion('');
    });
  };

  return (
    <Card className={styles.card}>
      <div className={styles.heading}>
        <MessageCircleQuestion size={14} aria-hidden />
        Ask your workshop
      </div>
      <form
        className={styles.ask}
        onSubmit={(event) => {
          event.preventDefault();
          if (question.trim().length >= 3 && !busy && !blocked) void ask();
        }}
      >
        <TextField
          label="Question"
          value={question}
          onChange={setQuestion}
          maxLength={MAX_CHARS}
          placeholder="What's running low? Why did jobs fail this week?"
          disabled={blocked}
          enterKeyHint="send"
          autoComplete="off"
        />
        <Button type="submit" variant="primary" icon={Send} disabled={busy || blocked || question.trim().length < 3}>
          {busy ? 'Asking…' : 'Ask'}
        </Button>
      </form>
      {reply && (
        <div className={styles.answer} aria-live="polite">
          <p className={styles.question}>{reply.question}</p>
          <p>{reply.answer}</p>
        </div>
      )}
      <p className={styles.foot}>
        {status.paused
          ? `AI is paused until ${resumeDate(status.pausedUntil)}.`
          : left === 0
            ? 'No questions left today. Ask again tomorrow.'
            : `${left} question${left === 1 ? '' : 's'} left today. Answers come from AI and only know what the app shows; check before acting on them.`}
      </p>
    </Card>
  );
}
