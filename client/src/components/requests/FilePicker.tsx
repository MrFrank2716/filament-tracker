import { useRef } from 'react';
import { FileUp, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { formatBytes } from '@/lib/format';
import type { UploadLimits } from '@/lib/types';
import styles from '@/components/requests/Requests.module.css';

const extensionOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');

/** Why a file would be turned away, or null if it is fine. Mirrors the server's checks so the answer is instant. */
export function fileProblem(file: File, limits: UploadLimits): string | null {
  if (!limits.extensions.includes(extensionOf(file.name))) return 'not an accepted file type';
  if (file.size > limits.maxMb * 1024 * 1024) return `larger than ${limits.maxMb} MB`;
  return null;
}

interface FilePickerProps {
  files: File[];
  onChange: (files: File[]) => void;
  limits: UploadLimits;
}

/** Choose several files, see them listed with their size, and take any back out before sending. */
export function FilePicker({ files, onChange, limits }: FilePickerProps) {
  const input = useRef<HTMLInputElement>(null);

  const add = (picked: FileList | null) => {
    if (!picked) return;
    // Picking again adds to the list; the same file twice is kept once.
    const known = new Set(files.map((file) => `${file.name}:${file.size}`));
    onChange([...files, ...[...picked].filter((file) => !known.has(`${file.name}:${file.size}`))]);
  };

  return (
    <div className={styles.picker}>
      <input
        ref={input}
        type="file"
        multiple
        // No `accept` list on purpose. Phones have no file type registered for workshop formats (.3mf, .step, .gcode,
        // .nc ...), so their pickers grey those files out when a list is given. Every file can be chosen; the list
        // below says at once which ones will not be taken, and the server checks again.
        className={styles.fileInput}
        onChange={(event) => {
          add(event.target.files);
          event.target.value = '';
        }}
      />
      <Button icon={FileUp} onClick={() => input.current?.click()}>
        {files.length ? 'Add more files' : 'Choose files'}
      </Button>
      <p className={styles.pickerHint}>
        Up to {limits.maxFiles} files, {limits.maxMb} MB each. Accepted: {limits.extensions.map((ext) => `.${ext}`).join(' ')}
      </p>
      {files.length > 0 && (
        <ul className={styles.fileList}>
          {files.map((file, index) => {
            const problem = fileProblem(file, limits) ?? (index >= limits.maxFiles ? `over the limit of ${limits.maxFiles} files` : null);
            return (
              <li key={`${file.name}:${file.size}`} className={`${styles.file} ${problem ? styles.fileBad : ''}`}>
                <span className={styles.fileName}>{file.name}</span>
                <span className={styles.fileMeta}>{problem ?? formatBytes(file.size)}</span>
                <IconButton icon={X} size="sm" label={`Remove ${file.name}`} onClick={() => onChange(files.filter((other) => other !== file))} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** First reason the chosen files cannot be sent, or null. */
export function filesProblem(files: File[], limits: UploadLimits): string | null {
  if (files.length > limits.maxFiles) return `You can send up to ${limits.maxFiles} files. Remove ${files.length - limits.maxFiles}.`;
  const bad = files.find((file) => fileProblem(file, limits));
  return bad ? `"${bad.name}" is ${fileProblem(bad, limits)}. Remove it to continue.` : null;
}
