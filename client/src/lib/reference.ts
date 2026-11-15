import { api } from '@/lib/api';

/**
 * The reference catalogue: read-only machines and materials served by the API.
 * It only changes on deploy, so each list is fetched once per session and kept in memory.
 */

export type ReferenceKind = 'machine' | 'filament' | 'endmill' | 'fastener' | 'sheet' | 'finish';
export type ItemKind = Exclude<ReferenceKind, 'machine'>;
export const ITEM_KINDS: ItemKind[] = ['filament', 'sheet', 'endmill', 'fastener', 'finish'];

export interface Spec {
  label: string;
  value: string;
  unit?: string;
}

export interface ReferenceMachine {
  id: string;
  brand: string;
  model: string;
  machineType: string;
  summary?: string;
  specs: Spec[];
  attachments?: { id: string; name: string; kind: string; slots: number; builtIn?: boolean }[];
  tasks?: { name: string }[];
  asUnit?: { kind: string; slots: number };
}

export interface FilamentLine {
  id: string;
  brand: string;
  name: string;
  material: string;
  materialCode: string;
  density: number;
  diameters: number[];
  weights: { g: number; spool?: number }[];
  nozzle?: [number, number];
  bed?: [number, number];
  finish?: string;
  colours: [string, string][];
}

export interface ReferenceEndmill {
  id: string;
  name: string;
  cutType: string;
  diameter: number;
  shank: number;
  flutes: number;
  angle?: number;
  toolMaterial: string;
  coating?: string;
  ratedFor?: string;
  imperial?: boolean;
}

export interface ReferenceFastener {
  id: string;
  name: string;
  kind: string;
  standard?: string;
  head?: string;
  drive?: string;
  materials: { material: string; grade?: string }[];
  sizes: { size: string; pitch?: number; lengths: number[] }[];
  imperial?: boolean;
}

export interface ReferenceSheet {
  id: string;
  name: string;
  material: string;
  finish?: string;
  thicknesses: number[];
  note?: string;
}

export interface ReferenceFinish {
  id: string;
  name: string;
  kind: string;
  base?: string;
  sheen?: string;
  size?: string;
  unit: 'ml' | 'pcs';
  variants: { label: string; grit?: number; capacity?: number }[];
}

export interface EntryByKind {
  machine: ReferenceMachine;
  filament: FilamentLine;
  endmill: ReferenceEndmill;
  fastener: ReferenceFastener;
  sheet: ReferenceSheet;
  finish: ReferenceFinish;
}

export interface ReferenceSummary {
  kinds: { kind: ReferenceKind; label: string; count: number; category: string | null }[];
  machineTypes: Record<string, { name: string; icon: string }>;
  sheetSizes: { label: string; width: number; length: number }[];
  attribution: { filament: { name: string; url: string; licence: string; copyright: string } };
}

export type Pick =
  | { kind: 'machine'; id: string; attachments: string[] }
  | { kind: 'filament'; id: string; colours: string[]; weight: number; diameter: number; count: number }
  | { kind: 'endmill'; id: string; count: number }
  | { kind: 'fastener'; id: string; size: string; lengths: number[]; material: number; count: number }
  | { kind: 'sheet'; id: string; thicknesses: number[]; width: number; length: number; count: number }
  | { kind: 'finish'; id: string; variants: string[]; count: number };

export interface AddResult {
  machines: { id: string; name: string }[];
  subUnits: number;
  items: number;
  skipped: string[];
  category: { id: string; name: string } | null;
}

const cache = new Map<string, Promise<unknown>>();

function cached<T>(path: string): Promise<T> {
  let pending = cache.get(path);
  if (!pending) {
    pending = api.get<T>(path);
    cache.set(path, pending);
    pending.catch(() => cache.delete(path)); // let a failed fetch be retried
  }
  return pending as Promise<T>;
}

export const loadSummary = () => cached<ReferenceSummary>('/reference');

/** The whole list for the small kinds. */
export const loadEntries = <K extends Exclude<ReferenceKind, 'filament'>>(kind: K) =>
  cached<{ total: number; entries: EntryByKind[K][] }>(`/reference/${kind}`).then((r) => r.entries);

export const loadFilamentBrands = () => cached<{ brand: string; lines: number }[]>('/reference/filament/brands');

/** Filament is searched on the server: it runs to thousands of colours. */
export function searchFilament(brand: string, q: string) {
  const params = new URLSearchParams();
  if (brand) params.set('brand', brand);
  if (q.trim()) params.set('q', q.trim());
  return cached<{ total: number; entries: FilamentLine[] }>(`/reference/filament?${params}`);
}

export const machineTitle = (m: ReferenceMachine) => (m.brand ? `${m.brand} ${m.model}` : m.model);

/** "40 W", "256 × 256 × 256 mm", "18%" */
export const specText = (s: Spec) => (s.unit ? (/^[\p{L}\d]/u.test(s.unit) ? `${s.value} ${s.unit}` : `${s.value}${s.unit}`) : s.value);

export const fmt = (value: number) => String(Number(value.toFixed(3)));

/** 12.7 -> 1/2", for imperial fastener lengths stored in mm. */
export function inchLabel(millimetres: number): string {
  const sixteenths = Math.round((millimetres / 25.4) * 16);
  const whole = Math.floor(sixteenths / 16);
  let numerator = sixteenths % 16;
  let denominator = 16;
  while (numerator && numerator % 2 === 0) {
    numerator /= 2;
    denominator /= 2;
  }
  const fraction = numerator ? `${numerator}/${denominator}` : '';
  return `${whole && fraction ? `${whole}-${fraction}` : whole || fraction || '0'}"`;
}
