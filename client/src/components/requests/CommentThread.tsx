import { useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Muted } from '@/components/ui/Display';
import { TextAreaField } from '@/components/ui/Form';
import { useAction } from '@/components/ui/Toast';
import { formatDateTime } from '@/lib/format';
import type { RequestComment } from '@/lib/types';
import styles from '@/components/requests/Requests.module.css';

interface Props {
  comments: RequestComment[];
  canWrite: boolean;
  placeholder: string;
  /** Who "you" are on this page: the requester's own messages are on their side on the progress page. */
  viewer?: 'member' | 'requester';
  onSend: (body: string) => Promise<unknown>;
}

/** The conversation on a request, shared by the review queue and the requester's progress page. */
export function CommentThread({ comments, canWrite, placeholder, viewer = 'member', onSend }: Props) {
  const { run, busy } = useAction();
  const [body, setBody] = useState('');

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    if (await run(() => onSend(text), 'Message sent')) setBody('');
  };

  if (comments.length === 0 && !canWrite) return null;

  return (
    <div className={styles.thread}>
      {comments.length > 0 && (
        <ol className={styles.comments} aria-label="Messages">
          {comments.map((comment) => {
            const mine = viewer === 'requester' ? comment.fromRequester : !comment.fromRequester;
            return (
              <li key={comment.id} className={`${styles.comment} ${mine ? styles.commentMine : ''}`}>
                <span className={styles.noteLabel}>
                  {comment.authorName}
                  {comment.fromRequester && viewer === 'member' ? ' (requester)' : ''} · {formatDateTime(comment.createdAt)}
                </span>
                <p className={styles.noteText}>{comment.body}</p>
              </li>
            );
          })}
        </ol>
      )}
      {canWrite && (
        <form
          className={styles.commentForm}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <TextAreaField label="Message" value={body} onChange={setBody} rows={2} maxLength={2000} placeholder={placeholder} />
          <Button type="submit" icon={Send} disabled={busy || !body.trim()}>
            Send
          </Button>
        </form>
      )}
      {comments.length === 0 && canWrite && <Muted>No messages yet.</Muted>}
    </div>
  );
}
