import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, MAX_TAB_BAR, NAV_IDS, applyLayout, isDefaultLayout, movePage, normalizeLayout, setInTabBar } from '@/lib/navigation';

describe('normalizeLayout', () => {
  it('gives the standard layout for nothing, null or junk', () => {
    for (const value of [null, undefined, 'x', 3, {}, []]) expect(normalizeLayout(value)).toEqual(DEFAULT_LAYOUT);
  });

  it('keeps a valid layout as it is', () => {
    const layout = { order: [...NAV_IDS].reverse(), tabBar: ['settings', 'reorder'] };
    expect(normalizeLayout(layout)).toEqual(layout);
  });

  it('drops unknown and repeated pages, and adds missing ones at the end', () => {
    const { order } = normalizeLayout({ order: ['reorder', 'gone', 'reorder', 'jobs'], tabBar: ['jobs'] });
    expect(order.slice(0, 2)).toEqual(['reorder', 'jobs']);
    expect([...order].sort()).toEqual([...NAV_IDS].sort());
  });

  it('keeps the tab bar between one and the maximum, in sidebar order', () => {
    expect(normalizeLayout({ order: NAV_IDS, tabBar: [] }).tabBar).toEqual(['overview']);
    expect(normalizeLayout({ order: NAV_IDS, tabBar: ['nope'] }).tabBar).toEqual(['overview']);
    expect(normalizeLayout({ order: NAV_IDS, tabBar: [...NAV_IDS] }).tabBar).toHaveLength(MAX_TAB_BAR);
    expect(normalizeLayout({ order: NAV_IDS, tabBar: ['jobs', 'overview'] }).tabBar).toEqual(['overview', 'jobs']);
  });

  it('uses the standard tab bar when only an order was saved', () => {
    expect([...normalizeLayout({ order: [...NAV_IDS].reverse() }).tabBar].sort()).toEqual([...DEFAULT_LAYOUT.tabBar].sort());
  });
});

describe('editing', () => {
  it('moves a page and ignores impossible moves', () => {
    expect(movePage(DEFAULT_LAYOUT, 5, 0).order[0]).toBe('reorder');
    expect(movePage(DEFAULT_LAYOUT, 0, -1)).toBe(DEFAULT_LAYOUT);
    expect(movePage(DEFAULT_LAYOUT, 0, 99)).toBe(DEFAULT_LAYOUT);
  });

  it('will not over-fill or empty the tab bar', () => {
    expect(setInTabBar(DEFAULT_LAYOUT, 'reorder', true)).toBe(DEFAULT_LAYOUT);
    const three = setInTabBar(DEFAULT_LAYOUT, 'jobs', false);
    expect(setInTabBar(three, 'reorder', true).tabBar).toContain('reorder');
    const one = { order: [...NAV_IDS], tabBar: ['jobs' as const] };
    expect(setInTabBar(one, 'jobs', false)).toBe(one);
  });

  it('recognises the standard layout whatever order the tab bar is listed in', () => {
    expect(isDefaultLayout({ order: [...NAV_IDS], tabBar: ['maintenance', 'jobs', 'inventory', 'overview'] })).toBe(true);
    expect(isDefaultLayout(movePage(DEFAULT_LAYOUT, 0, 1))).toBe(false);
  });
});

describe('applyLayout', () => {
  it('orders pages and marks the tab bar ones', () => {
    const pages = NAV_IDS.map((id) => ({ id }));
    const out = applyLayout(pages, { order: [...NAV_IDS].reverse(), tabBar: ['settings'] });
    expect(out[0]).toEqual({ id: 'settings', primary: true });
    expect(out.filter((p) => p.primary)).toHaveLength(1);
    expect(out).toHaveLength(NAV_IDS.length);
  });
});
