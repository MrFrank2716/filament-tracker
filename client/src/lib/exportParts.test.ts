import { describe, expect, it } from 'vitest';
import { EXPORT_PARTS, droppedLinks, neededBy, toggleExportPart, type ExportPart } from '@/lib/exportParts';

const set = (...parts: ExportPart[]) => new Set<ExportPart>(parts);

describe('choosing what to export', () => {
  it('ticks what a part needs, through other parts too', () => {
    expect(toggleExportPart(set(), 'units', true)).toEqual(set('units'));
    expect(toggleExportPart(set(), 'maintenance', true)).toEqual(set('maintenance', 'machines', 'locations'));
    expect(toggleExportPart(set(), 'jobs', true)).toEqual(set(...EXPORT_PARTS.filter((part) => part !== 'maintenance')));
  });

  it('unticks whatever needs the part being unticked', () => {
    expect(toggleExportPart(set(...EXPORT_PARTS), 'units', false)).toEqual(set('suppliers', 'locations', 'machines', 'maintenance'));
    expect(toggleExportPart(set(...EXPORT_PARTS), 'jobs', false)).toEqual(set(...EXPORT_PARTS.filter((part) => part !== 'jobs')));
  });

  it('says which ticked parts need another', () => {
    expect(neededBy(set('maintenance', 'machines', 'locations'), 'locations')).toEqual(['machines', 'maintenance']);
    expect(neededBy(set('locations', 'units'), 'locations')).toEqual([]);
  });

  it('warns when inventory and machines are split, since their links cannot come along', () => {
    expect(droppedLinks(set('inventory'))).toHaveLength(1);
    expect(droppedLinks(set('machines'))).toHaveLength(1);
    expect(droppedLinks(set('inventory', 'machines'))).toEqual([]);
    expect(droppedLinks(set('units'))).toEqual([]);
  });
});
