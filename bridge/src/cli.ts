import { createWriteStream } from 'node:fs';
import mqtt from 'mqtt';
import { Bridge, pair } from './bridge';
import { ConfigStore, VERSION, checkServer, defaultDir } from './config';
import { log } from './log';
import { privateHost } from './safety';
import { Simulator } from './simulate';

const HELP = `wrkbench-bridge ${VERSION}

Reads the printers on this network and reports to Wrkbench. It only reads: it cannot start, stop or change a print.

  wrkbench-bridge --server <address> --pair <code>   first run: use the command shown in Wrkbench (Settings, Printers)
  wrkbench-bridge                                    afterwards: everything it needs is stored

Options
  --server <address>   where Wrkbench is, for example https://wrkbench.example.com
  --pair <code>        the one-time set-up code from Settings, Printers
  --dir <folder>       where to keep its settings (default: /data in a container, else your config folder)
  --simulate           pretend printers instead of real ones, for trying things out
  --list-job-file      print what is inside each print's sliced file (names and sizes), to help improve Wrkbench
  --help, --version

Other commands
  wrkbench-bridge status
  wrkbench-bridge record --host <address> --serial <serial> --code <access code> [--out tape.jsonl] [--seconds 120]
      Save what a printer reports to a file, with serial numbers replaced, to help improve Wrkbench.

Environment: WRKBENCH_SERVER, WRKBENCH_PAIR, WRKBENCH_BRIDGE_DIR do the same as the options.
`;

function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  const words: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) words.push(arg);
    else if (['--simulate', '--list-job-file', '--help', '--version'].includes(arg)) flags.set(arg.slice(2), 'true');
    else flags.set(arg.slice(2), argv[++index] ?? '');
  }
  return { flags, command: words[0] ?? 'run' };
}

/** Listen to one printer and write what it says to a file, with anything that identifies it replaced. */
function record(flags: Map<string, string>): void {
  const host = flags.get('host') ?? '';
  const serial = flags.get('serial') ?? '';
  const code = flags.get('code') ?? '';
  if (!privateHost(host) || !serial || !code) throw new Error('record needs --host <address on your network> --serial <serial> --code <access code>');
  const out = flags.get('out') ?? 'tape.jsonl';
  const seconds = Number(flags.get('seconds') ?? '120') || 120;
  const file = createWriteStream(out);
  const started = Date.now();
  const scrub = (text: string) =>
    text
      .split(serial).join('SERIAL0000000001')
      .replace(/"sn":"[^"]*"/g, '"sn":"SN0000000000000"')
      // Addresses on a private network only: version numbers look like addresses too and must be left alone.
      .replace(/\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g, '192.168.0.1')
      .replace(/"(?:ssid|ip|mask|wifi_ssid|user_id|uid|nickname)":("[^"]*"|\d+)/gi, (match) => `${match.split(':')[0]}:""`);
  const client = mqtt.connect(`mqtts://${host}:8883`, { username: 'bblp', password: code, rejectUnauthorized: false, protocolVersion: 4, reconnectPeriod: 0, connectTimeout: 10_000 });
  client.on('connect', () => {
    log.info(`Recording ${seconds} s to ${out}`);
    client.subscribe(`device/${serial}/report`);
    client.publish(`device/${serial}/request`, JSON.stringify({ info: { sequence_id: '0', command: 'get_version' } }), { qos: 1 });
    client.publish(`device/${serial}/request`, JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall', version: 1, push_target: 1 } }), { qos: 1 });
    setTimeout(() => {
      client.end(true);
      file.end(() => log.info('Done. Look through the file before sharing it.'));
    }, seconds * 1000);
  });
  client.on('message', (_topic, payload) => {
    try {
      const text = scrub(JSON.stringify(JSON.parse(payload.toString('utf8'))));
      file.write(`{"t":${Date.now() - started},"payload":${text}}\n`);
    } catch {
      /* not JSON */
    }
  });
  client.on('error', (error) => {
    log.error(`Could not record: ${error.message}`);
    process.exitCode = 1;
    client.end(true);
  });
}

async function main(): Promise<void> {
  const { flags, command } = parseArgs(process.argv.slice(2));
  if (flags.has('help') || command === 'help') return void process.stdout.write(HELP);
  if (flags.has('version')) return void process.stdout.write(`${VERSION}\n`);
  if (command === 'record') return record(flags);

  const store = new ConfigStore(flags.get('dir') ?? defaultDir());
  if (command === 'status') {
    const { server, bridgeId, printers } = store.data;
    process.stdout.write(`Settings: ${store.file}\nServer: ${server || '(not set)'}\nPaired: ${bridgeId ? 'yes' : 'no'}\nPrinters: ${Object.keys(printers).length}\n`);
    return;
  }
  if (command !== 'run') throw new Error(`Unknown command "${command}". Try --help.`);

  const serverArg = flags.get('server') ?? process.env.WRKBENCH_SERVER;
  const code = flags.get('pair') ?? process.env.WRKBENCH_PAIR ?? null;
  const server = serverArg ? checkServer(serverArg) : store.data.server;
  if (!server) throw new Error('Tell the bridge where Wrkbench is: copy the command from Settings, Printers, Add bridge.');
  if (store.data.server && store.data.server !== server) {
    // A different server is a different install: nothing stored for the old one carries over.
    store.data = { configVersion: 1, server, printers: {} };
  }
  store.data.server = server;

  let pending = code;
  if (!store.data.token) {
    if (!code) throw new Error('This bridge has not been set up yet. Copy the command from Settings, Printers, Add bridge.');
    const workspace = await pair(store, server, code);
    log.info(`Paired with "${workspace}"`);
    pending = null;
  }

  const bridge = new Bridge(store, flags.has('simulate') ? new Simulator() : null, pending, flags.has('list-job-file') || process.env.WRKBENCH_LIST_JOB_FILE === '1');
  bridge.start();
  const stop = () => {
    bridge.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((cause: unknown) => {
  log.error((cause as Error).message);
  process.exit(1);
});
