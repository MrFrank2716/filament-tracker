import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMergePatch, diffMergePatch, mergeDelta, touchesPaths, withoutPaths, type Doc } from '@filament-tracker/protocol';
import { simDocument, simFleet, simTray } from '@filament-tracker/protocol/fixtures';
import { formatHmsCode, readHms, readPrintError } from '@/integrations/bambu/hms';
import { bambuColour, readBambu } from '@/integrations/bambu/normalize';
import { colourDistance, compatible, traySignature } from '@/integrations/spoolMatch';

// The fixtures are synthetic (see protocol/src/fixtures.ts): these tests pin down our reading of the protocol.
const [x1c, p1s, a1, h2d] = simFleet();

describe('reading a Bambu status document', () => {
  it('reads state, progress, nozzle and model from a single-nozzle printer', () => {
    const reading = readBambu(simDocument(x1c));
    expect(reading.phase).toBe('printing');
    expect(reading.print).toMatchObject({ name: 'bracket_v3', progress: 37, layer: 112, totalLayers: 300, remainingMinutes: 94 });
    expect(reading.extruders).toEqual([{ label: 'Nozzle', temp: { current: 219, target: 220 }, nozzle: { diameter: 0.4, type: 'Hardened steel' } }]);
    expect(reading.modelName).toBe('X1 Carbon');
    expect(reading.firmware).toBe('01.09.00.00');
  });

  it('reads feeders, trays, tags and which tray is feeding', () => {
    const { feeders } = readBambu(simDocument(x1c));
    expect(feeders.map((feeder) => [feeder.key, feeder.label, feeder.kind])).toEqual([
      ['ams:0', 'AMS 1', 'ams'], ['ams:1', 'AMS 2', 'ams'], ['external:0', 'External spool', 'external'],
    ]);
    const [first, second, third, fourth] = feeders[0].trays;
    expect(first).toMatchObject({ position: 1, state: 'loaded', material: 'PLA', subType: 'PLA Basic', colour: '#000000', brand: 'Bambu Lab', remainingPercent: 82, spoolWeightGrams: 1000, active: true });
    expect(first.tagId).toMatch(/^[0-9A-F]{32}$/);
    expect(second.active).toBe(false);
    // A spool without a tag reports zeros for its ids and -1 for what is left.
    expect(third).toMatchObject({ material: 'PETG', colour: '#1f6feb', tagId: null, brand: null, remainingPercent: null, spoolWeightGrams: null });
    expect(fourth).toMatchObject({ state: 'empty', material: null });
  });

  it('tells feeder kinds apart and reads drying', () => {
    expect(readBambu(simDocument(a1)).feeders[0]).toMatchObject({ kind: 'ams_lite', label: 'AMS Lite 1' });
    const feeders = readBambu(simDocument(h2d)).feeders;
    expect(feeders.map((feeder) => feeder.kind)).toEqual(['ams_2_pro', 'ams_ht', 'external', 'external']);
    expect(feeders[1]).toMatchObject({ key: 'ams:128', label: 'AMS HT 1', humidityPercent: 9, drying: { remainingMinutes: 180 } });
    expect(feeders[1].trays).toHaveLength(1);
    expect(feeders[3].trays[0]).toMatchObject({ state: 'loaded', material: 'PLA', colour: '#ff7f00' });
  });

  it('reads both nozzles of a dual-nozzle printer', () => {
    const { extruders } = readBambu(simDocument(h2d));
    expect(extruders.map((extruder) => [extruder.label, extruder.nozzle.diameter])).toEqual([['Right nozzle', 0.4], ['Left nozzle', 0.6]]);
  });

  it('formats error codes the way the printer shows them, with their meaning and the right page', () => {
    expect(formatHmsCode(0x07008011, 0x00020002)).toBe('0700_8011_0002_0002');
    // Seen on a real P1P: the fourth slot's feeder motor. Its page is shared with the other slots, so the link
    // comes from the table, never from the code.
    expect(readHms(0x07002300, 0x00020012, 'P1P')).toEqual({
      kind: 'hms', code: '0700_2300_0002_0012', severity: 'error',
      message: 'AMS A slot 4 feeder unit motor is stalled, cannot rotate the spool.',
      url: 'https://wiki.bambulab.com/en/h2/troubleshooting/hmscode/0700_2000_0002_0012',
    });
    // A model with wording of its own gets it; others get the default.
    expect(readHms(0x03000200, 0x00010001, 'H2D').message).toMatch(/right nozzle/);
    expect(readHms(0x03000200, 0x00010001, 'P1S').message).not.toMatch(/right nozzle/);
    // A code nobody has written up still shows, pointing at the maker's index.
    expect(readHms(0x7fff0000, 0x00030001, 'P1S')).toMatchObject({ message: null, severity: 'warning', url: 'https://wiki.bambulab.com/en/hms/home' });
    const reading = readBambu(simDocument(a1));
    expect(reading.phase).toBe('failed');
    expect(reading.errors).toHaveLength(1);
    expect(reading.errors[0]).toMatchObject({ kind: 'hms', code: '0700_8011_0002_0002', severity: 'error' });
  });

  it('does not call a cancelled print an error, and drops numbers that mean nothing', () => {
    expect(readPrintError(50348044, 'P1S')).toMatchObject({ code: '0300_400C', severity: 'info', message: 'The task was canceled.' });
    expect(readPrintError(0, 'P1S')).toBeNull();
    expect(readPrintError(0x7fffffff, 'P1S')).toBeNull();
    expect(readBambu({ print: { gcode_state: 'FAILED', print_error: 50348044, hms: [{ attr: 0, code: 0 }] } }).errors.map((e) => e.severity)).toEqual(['info']);
  });

  it('clears the health list on an empty list and leaves it alone when a report does not mention it', () => {
    const withError = { print: { gcode_state: 'IDLE', hms: [{ attr: 0x07002300, code: 0x00020012 }] } };
    expect(readBambu(mergeDelta(withError, { print: { mc_percent: 3 } }) as Doc).errors).toHaveLength(1);
    expect(readBambu(mergeDelta(withError, { print: { hms: [] } }) as Doc).errors).toHaveLength(0);
  });

  it('survives documents that are missing, partial or the wrong shape', () => {
    expect(readBambu({}).phase).toBe('unknown');
    expect(readBambu({ print: { ams: 'nope', hms: {}, vt_tray: 4, device: [] } }).feeders).toEqual([]);
    expect(readBambu({ print: { gcode_state: 'SOMETHING_NEW' } }).phase).toBe('unknown');
    expect(bambuColour('FF6A13FF')).toBe('#ff6a13');
    expect(bambuColour('nonsense')).toBeNull();
  });

  it('idle printer with an external spool', () => {
    const reading = readBambu(simDocument(p1s));
    // Seen on real P1 and A1 printers: they have no chamber sensor and report a constant instead.
    expect(reading.chamber).toBeNull();
    expect(readBambu(simDocument(x1c)).chamber).toEqual({ current: 31, target: null });
    expect(reading.phase).toBe('idle');
    expect(reading.print).toBeNull();
    expect(reading.feeders.at(-1)?.trays[0]).toMatchObject({ material: 'TPU', state: 'loaded' });
  });
});

describe('merging and replicating documents', () => {
  it('folds a partial update for one tray into the full document', () => {
    const full = simDocument(p1s);
    const merged = mergeDelta(full, { print: { ams: { ams: [{ id: '0', tray: [simTray(2, { type: 'ABS', color: 'aa0000' })] }] } } }) as Doc;
    const trays = readBambu(merged).feeders[0].trays;
    expect(trays[2]).toMatchObject({ material: 'ABS', colour: '#aa0000' });
    expect(trays[0]).toMatchObject({ material: 'PETG', remainingPercent: 15 });
  });

  it('an element carrying only its id empties that place', () => {
    const merged = mergeDelta(simDocument(p1s), { print: { ams: { ams: [{ id: '0', tray: [{ id: '0' }] }] } } }) as Doc;
    expect(readBambu(merged).feeders[0].trays[0].state).toBe('empty');
  });

  it('a patch turns one document into the next, exactly', () => {
    const before = simDocument(x1c);
    const after = mergeDelta(before, { print: { mc_percent: 38, ams: { ams: [{ id: '1', tray: [{ id: '0' }] }] } } }) as Doc;
    const patch = diffMergePatch(before, after);
    expect(applyMergePatch(before, patch)).toEqual(after);
    expect(diffMergePatch(after, after)).toBeUndefined();
    expect(touchesPaths(patch, ['print.ams'])).toBe(true);
    expect(touchesPaths(diffMergePatch(before, mergeDelta(before, { print: { mc_percent: 40 } })), ['print.ams'])).toBe(false);
  });

  it('ignored paths never reach the server', () => {
    expect(withoutPaths({ print: { sequence_id: '9', mc_percent: 1 } }, ['print.sequence_id'])).toEqual({ print: { mc_percent: 1 } });
  });

  it('refuses to write through prototype keys', () => {
    applyMergePatch({}, JSON.parse('{"__proto__":{"polluted":true}}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('matching spools', () => {
  const tray = { state: 'loaded' as const, material: 'PLA', subType: 'PLA Basic', colour: '#000000', tagId: null };
  it('a signature ignores how much is left and changes with the spool', () => {
    expect(traySignature(tray)).toBe(traySignature({ ...tray }));
    expect(traySignature({ ...tray, colour: '#ffffff' })).not.toBe(traySignature(tray));
    expect(traySignature({ ...tray, state: 'empty' })).toBe('empty');
  });
  it('needs the same material and a close colour, and a tag settles it', () => {
    expect(compatible({ material: 'pla', colour: '#0a0a0a', tagId: null }, tray)).toBe(true);
    expect(compatible({ material: 'PETG', colour: '#000000', tagId: null }, tray)).toBe(false);
    expect(compatible({ material: 'PLA', colour: '#ffffff', tagId: null }, tray)).toBe(false);
    expect(compatible({ material: 'PLA', colour: null, tagId: null }, tray)).toBe(true);
    expect(compatible({ material: 'PLA', colour: '#000000', tagId: 'AA' }, { ...tray, tagId: 'BB' })).toBe(false);
    expect(compatible({ material: 'PETG', colour: '#ffffff', tagId: 'AA' }, { ...tray, tagId: 'AA' })).toBe(true);
    expect(colourDistance('#000000', '#000000')).toBe(0);
  });
});

describe('a real X2D (recorded, see test/fixtures/x2d.json)', () => {
  const doc = JSON.parse(readFileSync(new URL('./fixtures/x2d.json', import.meta.url), 'utf8')) as Doc;
  const reading = readBambu(doc);

  it('reads the model, state, both nozzles, bed and chamber', () => {
    expect(reading).toMatchObject({ modelName: 'X2D', phase: 'printing', bed: { current: 55, target: 55 }, chamber: { current: 25, target: null } });
    expect(reading.print).toMatchObject({ name: 'sample_print', totalLayers: 100, remainingMinutes: 30 });
    expect(reading.extruders).toEqual([
      { label: 'Right nozzle', temp: { current: 25, target: 0 }, nozzle: { diameter: 0.4, type: 'Hardened steel' } },
      { label: 'Left nozzle', temp: { current: 25, target: 0 }, nozzle: { diameter: 0.4, type: 'Hardened steel, high flow' } },
    ]);
  });

  it('reads an AMS 2 Pro, an AMS HT and both outside holders', () => {
    expect(reading.feeders.map((feeder) => [feeder.key, feeder.label, feeder.humidityPercent])).toEqual([
      ['ams:0', 'AMS 2 Pro 1', 34], ['ams:128', 'AMS HT 1', 37], ['external:0', 'External spool 1', null], ['external:1', 'External spool 2', null],
    ]);
    const [abs, , , tagged] = reading.feeders[0].trays;
    expect(abs).toMatchObject({ material: 'ABS-GF', colour: '#161616', tagId: null, remainingPercent: null });
    expect(tagged).toMatchObject({ material: 'PLA', subType: 'PLA Basic', brand: 'Bambu Lab', remainingPercent: 5 });
    // A spool without a tag reports "0 left", which is not a reading.
    expect(reading.feeders[2].trays[0]).toMatchObject({ material: 'TPU', remainingPercent: null, nozzleTemp: [200, 240], diameter: 1.75 });
    expect(reading.feeders[3].trays[0].state).toBe('empty');
  });

  it('gives its health messages in words', () => {
    expect(reading.errors[0]).toMatchObject({ code: '0501_0400_0003_0002', severity: 'warning', message: 'Threaded rods need lubrication now.' });
  });
});
