import { unzipSync, strFromU8 } from 'fflate';
import { JOB_IMAGE_ENTRY, JOB_IMAGE_MAX_BYTES, isPng } from '@filament-tracker/protocol';

/**
 * Reading a few small files out of a print's sliced file (a .3mf, which is a zip).
 *
 * The address is one the printer itself announced for the print it is running: Bambu Lab's file storage, over
 * https. The bridge downloads it, picks out the named entries (the slicer's summary of what the print uses, and
 * its picture of the plate), and throws the rest away. Nothing is written to disk and nothing but those entries
 * leaves the bridge.
 */

const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MAX_ENTRY_BYTES = 400_000;

export interface JobFileEntries {
  /** Text entries, by name. */
  entries: Record<string, string>;
  /** Plate pictures (PNG), by name. */
  images: Record<string, Uint8Array>;
}

/** The named entries of a zip held in memory. Anything too big, or a picture that is not a PNG, is left out. */
export function pickEntries(zip: Uint8Array, names: string[]): JobFileEntries {
  const wanted = new Set(names);
  const limit = (name: string) => (JOB_IMAGE_ENTRY.test(name) ? JOB_IMAGE_MAX_BYTES : MAX_ENTRY_BYTES);
  // Only the wanted entries are inflated, and only if they are small: the models and G-code are never unpacked.
  const files = unzipSync(zip, { filter: (file) => wanted.has(file.name) && file.originalSize <= limit(file.name) });
  const out: JobFileEntries = { entries: {}, images: {} };
  for (const [name, data] of Object.entries(files)) {
    if (data.byteLength > limit(name)) continue; // the size a zip declares is only a claim
    if (!JOB_IMAGE_ENTRY.test(name)) out.entries[name] = strFromU8(data);
    else if (isPng(data)) out.images[name] = data;
  }
  return out;
}

export async function readZipEntries(url: string, names: string[]): Promise<JobFileEntries> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('not_https');
  const response = await fetch(url, { signal: AbortSignal.timeout(90_000), redirect: 'error' });
  if (!response.ok || !response.body) throw new Error(`download_${response.status}`);
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_FILE_BYTES) throw new Error('too_large');

  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > MAX_FILE_BYTES) throw new Error('too_large');
    chunks.push(chunk);
  }
  const whole = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    whole.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return pickEntries(whole, names);
}
