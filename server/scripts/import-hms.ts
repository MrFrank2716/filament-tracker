/**
 * Regenerate data/hms/bambu.json: what Bambu Lab printers' error codes mean, and where each is explained.
 *
 *   npm run reference:hms -w server -- --commit <ha-bambulab commit>
 *
 * The texts and links are taken from the ha-bambulab project (MIT licence), which collects them from Bambu Lab's
 * own error-text service and wiki index. The wording is Bambu Lab's. The output is sorted and stable, so running
 * it twice on the same commit gives no diff.
 */
import { writeFileSync } from 'node:fs';
import { HMS_FILE, hmsFileSchema, type HmsFile, type Variants } from '@/integrations/bambu/hms';

const REPO = 'greghesp/ha-bambulab';
type Raw = Record<string, Record<string, string[]>>;

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

async function fetchJson<T>(commit: string, file: string): Promise<T> {
  const response = await fetch(`https://raw.githubusercontent.com/${REPO}/${commit}/scripts/hms_error_text/${file}`);
  if (!response.ok) throw new Error(`${file}: ${response.status}`);
  return (await response.json()) as T;
}

/** { text: [models] } becomes the text itself, or { "": default, MODEL: text } when models differ. */
function variants(entry: Record<string, string[]>): Variants | null {
  const byModel: Record<string, string> = {};
  for (const [value, models] of Object.entries(entry)) {
    if (models.length === 0) byModel[''] ??= value;
    for (const model of models) byModel[model.toUpperCase()] ??= value;
  }
  const keys = Object.keys(byModel);
  if (keys.length === 0) return null;
  if (keys.length === 1 && keys[0] === '') return byModel[''];
  return Object.fromEntries(keys.sort().map((key) => [key, byModel[key]]));
}

function table(raw: Raw): Record<string, Variants> {
  const out: Record<string, Variants> = {};
  for (const code of Object.keys(raw).sort()) {
    const value = variants(raw[code]);
    if (value !== null && /^[0-9A-F]{8}([0-9A-F]{8})?$/.test(code.toUpperCase())) out[code.toUpperCase()] = value;
  }
  return out;
}

async function main(): Promise<void> {
  const commit = arg('commit');
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) throw new Error('Pass --commit <full ha-bambulab commit sha>, so the result can be traced and repeated.');
  const texts = await fetchJson<{ device_hms: Raw; device_error: Raw }>(commit, 'hms_en.json');
  const links = await fetchJson<Raw>(commit, 'wiki_links.json');
  const file: HmsFile = {
    source: { name: 'ha-bambulab', url: `https://github.com/${REPO}`, licence: 'MIT', commit },
    hms: table(texts.device_hms),
    errors: table(texts.device_error),
    links: table(links),
  };
  hmsFileSchema.parse(file);
  if (Object.keys(file.hms).length < 1000) throw new Error('Suspiciously few codes; leaving the existing file alone.');
  writeFileSync(HMS_FILE, `${JSON.stringify(file)}\n`);
  console.log(`${Object.keys(file.hms).length} HMS codes, ${Object.keys(file.errors).length} print errors, ${Object.keys(file.links).length} links`);
}

main().catch((cause: unknown) => {
  console.error((cause as Error).message);
  process.exit(1);
});
