import dgram from 'node:dgram';
import type { DiscoveredPrinter } from '@filament-tracker/protocol';
import { log } from './log';
import { privateHost } from './safety';

/**
 * Finding printers on the network by listening. Bambu Lab printers announce themselves every few seconds with
 * an SSDP-style notice (multicast 239.255.255.250, UDP port 2021; some firmware uses 1990) carrying their
 * serial number, model code, name and address. The bridge only listens: it never answers or probes.
 *
 * In a container this needs host networking (`--network host`); without it nothing is heard, and printers are
 * added by typing their address and serial number instead.
 */

const GROUP = '239.255.255.250';
const PORTS = [2021, 1990];
const FRESH_MS = 10 * 60_000;

interface Seen extends DiscoveredPrinter {
  seenAt: number;
}

export function parseNotice(text: string, from: string): DiscoveredPrinter | null {
  if (text.length > 2000 || !/bambulab/i.test(text)) return null;
  const headers = new Map<string, string>();
  for (const line of text.split(/\r?\n/).slice(1, 40)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  const serial = headers.get('usn') ?? '';
  if (!/^[A-Za-z0-9]{8,32}$/.test(serial)) return null;
  // The notice says where the printer is; fall back to where the packet came from.
  const location = headers.get('location') ?? '';
  const host = /^\d{1,3}(\.\d{1,3}){3}$/.test(location) ? location : from;
  if (!privateHost(host)) return null;
  return {
    serial: serial.toUpperCase(),
    host,
    modelCode: (headers.get('devmodel.bambu.com') ?? '').slice(0, 40),
    name: (headers.get('devname.bambu.com') ?? '').slice(0, 80),
  };
}

export class Discovery {
  private readonly seen = new Map<string, Seen>();
  private sockets: dgram.Socket[] = [];

  start(): void {
    for (const port of PORTS) {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      socket.on('error', (error) => {
        log.warn(`Cannot listen for printers on port ${port} (${error.message}). Add printers by address instead.`);
        socket.close();
      });
      socket.on('message', (message, remote) => {
        const printer = parseNotice(message.toString('utf8'), remote.address);
        if (printer) this.seen.set(printer.serial, { ...printer, seenAt: Date.now() });
      });
      socket.bind(port, () => {
        try {
          socket.addMembership(GROUP);
        } catch {
          /* no multicast on this interface: broadcasts may still arrive */
        }
      });
      this.sockets.push(socket);
    }
  }

  stop(): void {
    for (const socket of this.sockets) {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    }
    this.sockets = [];
  }

  list(): DiscoveredPrinter[] {
    const cutoff = Date.now() - FRESH_MS;
    return [...this.seen.values()].filter((printer) => printer.seenAt >= cutoff).map(({ seenAt: _seenAt, ...printer }) => printer);
  }
}
