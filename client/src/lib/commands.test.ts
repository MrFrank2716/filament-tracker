import { describe, expect, it } from 'vitest';
import { searchCommands } from '@/lib/commands';

const commands = [
  { label: 'Overview' },
  { label: 'Inventory', keywords: 'stock items' },
  { label: 'Reorder', keywords: 'shopping buy low stock' },
  { label: 'Scan a label', keywords: 'qr barcode nfc camera' },
  { label: 'Settings: Import / export', keywords: 'backup csv json' },
  { label: 'Sign out', keywords: 'log out' },
];
const labels = (query: string) => searchCommands(commands, query).map((c) => c.label);

describe('searchCommands', () => {
  it('returns everything, in order, for an empty search', () => {
    expect(labels('')).toEqual(commands.map((c) => c.label));
    expect(labels('   ')).toHaveLength(commands.length);
  });

  it('matches labels whatever the case, and other words someone might type', () => {
    expect(labels('INVENT')).toEqual(['Inventory']);
    expect(labels('barcode')).toEqual(['Scan a label']);
    expect(labels('log out')).toEqual(['Sign out']);
  });

  it('matches the start of a word, not the middle of one', () => {
    expect(labels('port')).toEqual([]);
    expect(labels('view')).toEqual([]);
    expect(labels('export')).toEqual(['Settings: Import / export']);
  });

  it('puts labels that start with the text first, then other label matches, then keyword matches', () => {
    expect(labels('s')).toEqual(['Scan a label', 'Settings: Import / export', 'Sign out', 'Inventory', 'Reorder']);
    expect(labels('stock')).toEqual(['Inventory', 'Reorder']);
    expect(labels('exp')).toEqual(['Settings: Import / export']);
  });

  it('needs every word typed', () => {
    expect(labels('settings csv')).toEqual(['Settings: Import / export']);
    expect(labels('settings nfc')).toEqual([]);
  });
});
