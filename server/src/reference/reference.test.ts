import { describe, expect, it } from 'vitest';
import { mapMaterial } from '../../scripts/import-filaments';
import { endmills } from '@/reference/endmills';
import { fasteners } from '@/reference/fasteners';
import { loadFilaments } from '@/reference/filaments';
import { finishes } from '@/reference/finishes';
import { filamentBrands, getEntry, REFERENCE_KINDS, referenceSummary, searchReference } from '@/reference';
import { machines } from '@/reference/machines';
import { sheets } from '@/reference/sheets';
import { readingSchema } from '@/services/snapshot';

const duplicates = (values: string[]) => values.filter((value, index) => values.indexOf(value) !== index);

describe('reference data integrity', () => {
  it('loads the generated filament file', () => {
    const file = loadFilaments();
    expect(file.source.licence).toBe('MIT');
    expect(file.lines.length).toBeGreaterThan(100);
  });

  it('gives every entry a unique id within its kind', () => {
    for (const kind of REFERENCE_KINDS) {
      const ids = searchReference(kind).entries.map((entry) => entry.id);
      expect(duplicates(ids), kind).toEqual([]);
    }
  });

  it('gives every curated entry a unique display name', () => {
    expect(duplicates(machines.map((m) => `${m.brand} ${m.model}`))).toEqual([]);
    expect(duplicates(endmills.map((e) => e.name))).toEqual([]);
    expect(duplicates(sheets.map((s) => s.name))).toEqual([]);
    expect(duplicates(finishes.map((f) => f.name))).toEqual([]);
    expect(duplicates(fasteners.map((f) => `${f.name} ${f.materials.map((m) => m.material).join()}`))).toEqual([]);
  });

  it('keeps machine specs within what a machine record accepts', () => {
    for (const machine of machines) {
      expect(machine.specs.length, machine.id).toBeLessThanOrEqual(12);
      for (const spec of machine.specs) expect(() => readingSchema.parse(spec), `${machine.id} ${spec.label}`).not.toThrow();
      expect(duplicates((machine.attachments ?? []).map((a) => a.id)), machine.id).toEqual([]);
      for (const attachment of machine.attachments ?? []) expect(attachment.slots).toBeGreaterThanOrEqual(0);
    }
  });

  it('offers something to choose for every item entry', () => {
    for (const fastener of fasteners) {
      expect(fastener.sizes.length, fastener.id).toBeGreaterThan(0);
      expect(fastener.materials.length, fastener.id).toBeGreaterThan(0);
      expect(duplicates(fastener.sizes.map((s) => s.size)), fastener.id).toEqual([]);
    }
    for (const sheet of sheets) expect(sheet.thicknesses.every((t) => t > 0), sheet.id).toBe(true);
    for (const finish of finishes) {
      expect(finish.variants.length, finish.id).toBeGreaterThan(0);
      expect(duplicates(finish.variants.map((v) => v.label)), finish.id).toEqual([]);
      if (finish.unit === 'ml') expect(finish.variants.every((v) => (v.capacity ?? 0) > 0), finish.id).toBe(true);
    }
    for (const line of loadFilaments().lines) expect(duplicates(line.colours.map(([name]) => name)).length, line.id).toBeLessThan(line.colours.length);
  });
});

describe('filament material mapping', () => {
  it.each([
    ['PLA', 'PLA'], ['PLA+', 'PLA+'], ['HTPLA+', 'PLA+'], ['PLA+WOOD', 'PLA'], ['PLA-CF', 'PLA-CF'], ['WOOD', 'PLA'],
    ['PETG', 'PETG'], ['PETG-CF10', 'PETG-CF'], ['PETG-GF', 'PETG'], ['PCTG', 'PCTG'], ['PET-CF', 'PET'], ['CPE', 'PET'],
    ['ABS+GF20', 'ABS'], ['EASYASA', 'ASA'], ['ASA-CF', 'ASA'], ['TPU-95A', 'TPU'], ['PEBA', 'TPE'],
    ['PA6-CF', 'PA-CF'], ['PAHT-CF', 'PA-CF'], ['PA12-CF15', 'PA-CF'], ['PPA-CF25', 'PA-CF'], ['PA6-GF', 'PA-GF'], ['PA12', 'PA'],
    ['PC', 'PC'], ['PC-CF', 'PC-CF'], ['PCPBT-CF', 'PC-CF'], ['PC+ABS', 'PC+ABS'], ['PP-CF', 'PP'],
    ['PPS-CF', 'High-temp'], ['PEEK', 'High-temp'], ['PVDF+GRAPHENE', 'High-temp'], ['PHA', 'Other'],
  ])('maps %s to %s', (code, expected) => {
    expect(mapMaterial(code)).toBe(expected);
  });
});

describe('reference search', () => {
  it('matches every word typed, in any order', () => {
    const { entries } = searchReference('machine', { q: 'carbon bambu x1' });
    expect(entries.map((m) => m.id)).toEqual(['mc-bambu-lab-x1-carbon']);
  });

  it('ignores case and accents', () => {
    expect(searchReference('sheet', { q: 'ÁCRYLIC' }).total).toBe(searchReference('sheet', { q: 'acrylic' }).total);
    expect(searchReference('sheet', { q: 'acrylic' }).total).toBeGreaterThan(0);
    expect(searchReference('fastener', { q: 'iso 4762' }).entries[0]?.id).toBe('fx-iso4762');
  });

  it('filters filament by brand and caps results', () => {
    const [first] = filamentBrands();
    const { total, entries } = searchReference('filament', { brand: first.brand, limit: 2 });
    expect(total).toBe(first.lines);
    expect(entries.length).toBeLessThanOrEqual(2);
    expect(entries.every((line) => line.brand === first.brand)).toBe(true);
  });

  it('finds filament by colour name', () => {
    const { entries } = searchReference('filament', { q: 'jade white' });
    expect(entries.some((line) => line.colours.some(([name]) => name === 'Jade White'))).toBe(true);
  });

  it('looks entries up by id and summarises every kind', () => {
    expect(getEntry('endmill', endmills[0].id)).toBe(endmills[0]);
    expect(getEntry('machine', 'missing')).toBeUndefined();
    const summary = referenceSummary();
    expect(summary.kinds.map((k) => k.kind)).toEqual([...REFERENCE_KINDS]);
    expect(summary.kinds.every((k) => k.count > 0)).toBe(true);
  });
});
