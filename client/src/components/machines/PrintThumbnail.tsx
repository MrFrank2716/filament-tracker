import { useEffect, useState } from 'react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { api } from '@/lib/api';
import styles from '@/components/machines/Machines.module.css';

/**
 * The slicer's picture of the plate being printed. It is fetched with the sign-in header and shown from a
 * local address, and takes up no room until it has arrived: a print without a picture looks as it always did.
 */
export function PrintThumbnail({ runId, name }: { runId: string; name: string | null }) {
  const { wsPath } = useWorkspace();
  const path = wsPath(`/printers/runs/${runId}/thumbnail`);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!path) return;
    let current: string | null = null;
    let gone = false;
    api.blob(path).then(
      (blob) => {
        if (gone) return;
        current = URL.createObjectURL(blob);
        setUrl(current);
      },
      () => undefined, // no picture after all: show nothing
    );
    return () => {
      gone = true;
      if (current) URL.revokeObjectURL(current);
      setUrl(null);
    };
  }, [path]);

  if (!url) return null;
  return <img className={styles.printThumb} src={url} alt={name ? `Preview of ${name}` : 'Preview of the print'} width={96} height={96} />;
}
