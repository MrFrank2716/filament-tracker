import { describe, expect, it } from 'vitest';
import type { PrinterReport, ReportAck, TelemetryConfig } from '@filament-tracker/protocol';
import { checkServer } from '../src/config';
import { parseNotice } from '../src/discovery';
import { Replicator } from '../src/replicator';
import { privateHost } from '../src/safety';

describe('safety', () => {
  it('only private addresses written out in full', () => {
    expect(['10.0.0.5', '172.16.4.4', '172.31.255.1', '192.168.1.50'].every(privateHost)).toBe(true);
    expect(['127.0.0.1', '169.254.169.254', '8.8.8.8', '172.32.0.1', 'printer.local', '192.168.1', '192.168.1.999', '0.0.0.0'].some(privateHost)).toBe(false);
  });
  it('insists on https for a server on the internet', () => {
    expect(checkServer('https://wrkbench.example.com/app')).toBe('https://wrkbench.example.com');
    expect(checkServer('http://192.168.1.10:4000')).toBe('http://192.168.1.10:4000');
    expect(() => checkServer('http://wrkbench.example.com')).toThrow();
    expect(() => checkServer('not an address')).toThrow();
  });
});

describe('discovery', () => {
  const notice = ['NOTIFY * HTTP/1.1', 'HOST: 239.255.255.250:1900', 'Location: 192.168.1.50', 'NT: urn:bambulab-com:device:3dprinter:1', 'USN: 01P00A123456789', 'DevModel.bambu.com: C12', 'DevName.bambu.com: Workshop P1S'].join('\r\n');
  it('reads a printer\'s announcement', () => {
    expect(parseNotice(notice, '192.168.1.50')).toEqual({ serial: '01P00A123456789', host: '192.168.1.50', modelCode: 'C12', name: 'Workshop P1S' });
  });
  it('ignores anything else, and anything claiming a public address', () => {
    expect(parseNotice('NOTIFY * HTTP/1.1\r\nUSN: uuid:some-tv', '192.168.1.7')).toBeNull();
    expect(parseNotice(notice.replace('192.168.1.50', '8.8.8.8'), '8.8.4.4')).toBeNull();
    expect(parseNotice('x'.repeat(5000), '192.168.1.7')).toBeNull();
  });
});

describe('replicating a document', () => {
  const telemetry: TelemetryConfig = { liveMs: 0, idleMs: 0, urgentPaths: [], ignorePaths: ['print.sequence_id'], arrayKey: 'id' };
  const setup = (answer: (report: PrinterReport) => ReportAck | null) => {
    const sent: PrinterReport[] = [];
    const replicator = new Replicator('p1', {
      ready: () => true,
      telemetry: () => telemetry,
      gapMs: () => 0,
      send: async (report) => {
        sent.push(report);
        return answer(report);
      },
    });
    return { sent, replicator };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('sends everything first, then only what changed, one report at a time', async () => {
    const { sent, replicator } = setup(() => ({ ok: true }));
    replicator.merge({ print: { gcode_state: 'IDLE', mc_percent: 0, sequence_id: '1' } });
    replicator.merge({ print: { mc_percent: 5, sequence_id: '2' } });
    replicator.merge({ print: { mc_percent: 6, sequence_id: '3' } });
    await settle();
    expect(sent[0]).toEqual({ printerId: 'p1', seq: 0, kind: 'full', data: { print: { gcode_state: 'IDLE', mc_percent: 0 } } });
    // The two changes made while the first report was in flight went out as one patch.
    expect(sent.slice(1)).toEqual([{ printerId: 'p1', seq: 1, kind: 'patch', data: { print: { mc_percent: 6 } } }]);
    replicator.merge({ print: { sequence_id: '4' } });
    await settle();
    expect(sent).toHaveLength(2);
    replicator.stop();
  });

  it('starts over with the whole document when the server asks', async () => {
    let refuse = true;
    const { sent, replicator } = setup((report) => (report.kind === 'patch' && refuse ? ((refuse = false), { ok: false, resync: true }) : { ok: true }));
    replicator.merge({ print: { mc_percent: 1 } });
    await settle();
    replicator.merge({ print: { mc_percent: 2 } });
    await settle();
    expect(sent.map((report) => report.kind)).toEqual(['full', 'patch', 'full']);
    expect(sent[2].data).toEqual({ print: { mc_percent: 2 } });
    replicator.stop();
  });
});
