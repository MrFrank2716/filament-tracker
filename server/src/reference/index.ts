import { endmills } from '@/reference/endmills';
import { fasteners } from '@/reference/fasteners';
import { loadFilaments } from '@/reference/filaments';
import { finishes } from '@/reference/finishes';
import { machines } from '@/reference/machines';
import { sheets, sheetSizes } from '@/reference/sheets';
import type {
  FilamentLine, ItemKind, ReferenceEndmill, ReferenceFastener, ReferenceFinish, ReferenceKind, ReferenceMachine, ReferenceSheet,
} from '@/reference/types';
import { itemTypes, machineTypes } from '@/templates/library';

export { REFERENCE_KINDS } from '@/reference/types';
export type { ItemKind, ReferenceKind } from '@/reference/types';

export interface EntryByKind {
  machine: ReferenceMachine;
  filament: FilamentLine;
  endmill: ReferenceEndmill;
  fastener: ReferenceFastener;
  sheet: ReferenceSheet;
  finish: ReferenceFinish;
}

/** Which starter category each kind of item belongs in. */
export const KIND_CATEGORY = {
  filament: itemTypes.filament,
  endmill: itemTypes.endmill,
  fastener: itemTypes.fixing,
  sheet: itemTypes.sheet,
  finish: itemTypes.finishing,
} satisfies Record<ItemKind, unknown>;

const LABELS: Record<ReferenceKind, string> = {
  machine: 'Machines and equipment',
  filament: 'Filament',
  endmill: 'Endmills and cutters',
  fastener: 'Fixings and fasteners',
  sheet: 'Sheet stock',
  finish: 'Finishing supplies',
};

const STATIC = { machine: machines, endmill: endmills, fastener: fasteners, sheet: sheets, finish: finishes };

function entries<K extends ReferenceKind>(kind: K): EntryByKind[K][] {
  return (kind === 'filament' ? loadFilaments().lines : STATIC[kind as Exclude<ReferenceKind, 'filament'>]) as EntryByKind[K][];
}

export function getEntry<K extends ReferenceKind>(kind: K, id: string): EntryByKind[K] | undefined {
  return entries(kind).find((entry) => entry.id === id);
}

export function referenceSummary() {
  const filament = loadFilaments();
  return {
    kinds: (Object.keys(LABELS) as ReferenceKind[]).map((kind) => ({
      kind,
      label: LABELS[kind],
      count: entries(kind).length,
      category: kind === 'machine' ? null : KIND_CATEGORY[kind].name,
    })),
    machineTypes: Object.fromEntries(Object.entries(machineTypes).map(([key, type]) => [key, { name: type.name, icon: type.icon }])),
    sheetSizes,
    attribution: {
      filament: { name: filament.source.name, url: filament.source.url, licence: filament.source.licence, copyright: filament.source.copyright },
    },
  };
}

/** Text a search runs against: everything a user is likely to type for that entry. */
function haystack(kind: ReferenceKind, entry: EntryByKind[ReferenceKind]): string {
  switch (kind) {
    case 'machine': {
      const m = entry as ReferenceMachine;
      return [m.brand, m.model, m.summary, machineTypes[m.machineType].name, m.attachments?.map((a) => a.name).join(' ')].join(' ');
    }
    case 'filament': {
      const f = entry as FilamentLine;
      return [f.brand, f.name, f.material, f.materialCode, f.finish, f.colours.map(([name]) => name).join(' ')].join(' ');
    }
    case 'endmill': {
      const e = entry as ReferenceEndmill;
      return [e.name, e.cutType, e.ratedFor, e.toolMaterial].join(' ');
    }
    case 'fastener': {
      const f = entry as ReferenceFastener;
      return [f.name, f.kind, f.standard, f.head, f.drive, f.sizes.map((s) => s.size).join(' ')].join(' ');
    }
    case 'sheet': {
      const s = entry as ReferenceSheet;
      return [s.name, s.material, s.finish].join(' ');
    }
    case 'finish': {
      const f = entry as ReferenceFinish;
      return [f.name, f.kind, f.base, f.sheen].join(' ');
    }
  }
}

const normalise = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Every word typed must appear somewhere in the entry. The lists are small enough to scan. */
export function searchReference<K extends ReferenceKind>(kind: K, options: { q?: string; brand?: string; limit?: number } = {}): { total: number; entries: EntryByKind[K][] } {
  const words = normalise(options.q ?? '').split(/\s+/).filter(Boolean);
  const brand = options.brand ? normalise(options.brand) : null;
  const matches = entries(kind).filter((entry) => {
    if (brand !== null && normalise((entry as { brand?: string }).brand ?? '') !== brand) return false;
    if (!words.length) return true;
    const text = normalise(haystack(kind, entry));
    return words.every((word) => text.includes(word));
  });
  return { total: matches.length, entries: options.limit ? matches.slice(0, options.limit) : matches };
}

/** Filament makers with how many product lines each has, for the brand filter. */
export function filamentBrands(): { brand: string; lines: number }[] {
  const counts = new Map<string, number>();
  for (const line of loadFilaments().lines) counts.set(line.brand, (counts.get(line.brand) ?? 0) + 1);
  return [...counts].map(([brand, lines]) => ({ brand, lines })).sort((a, b) => a.brand.localeCompare(b.brand, 'en'));
}
