import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * What the bridge keeps on disk: which server it belongs to, its token, and each printer's access code.
 * The access codes exist nowhere else, so this file is written with owner-only permissions and never logged.
 */

export const VERSION = '0.1.0';

export interface StoredPrinter {
  vendor: string;
  serial: string;
  host: string;
  /** The printer's LAN access code. Missing after the bridge is moved to a new computer, until re-entered in Wrkbench. */
  accessCode?: string;
  /** SHA-256 of the printer's certificate, taken the first time it connects. A different one later is not trusted. */
  fingerprint?: string;
}

export interface BridgeConfigFile {
  configVersion: 1;
  server: string;
  bridgeId?: string;
  token?: string;
  printers: Record<string, StoredPrinter>;
}

/** /data in a container (mount a volume there); otherwise a folder in the user's config directory. */
export function defaultDir(): string {
  if (process.env.WRKBENCH_BRIDGE_DIR) return process.env.WRKBENCH_BRIDGE_DIR;
  if (existsSync('/data') && existsSync('/.dockerenv')) return '/data';
  const base = process.env.XDG_CONFIG_HOME ?? (process.platform === 'win32' ? (process.env.APPDATA ?? homedir()) : path.join(homedir(), '.config'));
  return path.join(base, 'wrkbench-bridge');
}

export class ConfigStore {
  readonly file: string;
  data: BridgeConfigFile;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'config.json');
    this.data = { configVersion: 1, server: '', printers: {} };
    if (existsSync(this.file)) {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<BridgeConfigFile>;
      this.data = { configVersion: 1, server: parsed.server ?? '', bridgeId: parsed.bridgeId, token: parsed.token, printers: parsed.printers ?? {} };
    }
  }

  /** Written to a temporary file first and renamed, so a power cut cannot leave half a file. */
  save(): void {
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.file);
    try {
      chmodSync(this.file, 0o600);
    } catch {
      /* not every filesystem has permissions */
    }
  }
}

/** The server address, tidied. Plain http is only allowed for a server on this computer or this network. */
export function checkServer(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not an address. Use the address you open Wrkbench at, such as https://wrkbench.example.com`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The server address must start with https://');
  const local = url.hostname === 'localhost' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname);
  if (url.protocol === 'http:' && !local) throw new Error('Use https:// for a server on the internet. Plain http is only allowed for one on your own network.');
  return url.origin;
}
