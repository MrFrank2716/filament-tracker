import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  MAX_TAB_BAR,
  NAV_IDS,
  applyLayout,
  isDefaultLayout,
  movePage,
  normalizeLayout,
  setInTabBar,
  setShown,
  shownOn,
  type NavLayout,
} from '@/lib/navigation';

const shownEverywhere = { hiddenDesktop: [], hiddenPhone: [] };

describe('normalizeLayout', () => {
  it('gives the standard layout for nothing, null or junk', () => {
    for (const value of [null, undefined, 'x', 3, {}, []]) expect(normalizeLayout(value)).toEqual(DEFAULT_LAYOUT);
  });

  it('keeps a valid layout as it is', () => {
    const layout = { order: [...NAV_IDS].reverse(), tabBar: ['settings', 'reorder'], hiddenDesktop: ['jobs'], hiddenPhone: ['activity'] };
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
    expect(movePage(DEFAULT_LAYOUT, 6, 0).order[0]).toBe('reorder');
    expect(movePage(DEFAULT_LAYOUT, 0, -1)).toBe(DEFAULT_LAYOUT);
    expect(movePage(DEFAULT_LAYOUT, 0, 99)).toBe(DEFAULT_LAYOUT);
  });

  it('will not over-fill or empty the tab bar', () => {
    expect(setInTabBar(DEFAULT_LAYOUT, 'reorder', true)).toBe(DEFAULT_LAYOUT);
    const three = setInTabBar(DEFAULT_LAYOUT, 'jobs', false);
    expect(setInTabBar(three, 'reorder', true).tabBar).toContain('reorder');
    const one: NavLayout = { order: [...NAV_IDS], tabBar: ['jobs'], ...shownEverywhere };
    expect(setInTabBar(one, 'jobs', false)).toBe(one);
  });

  it('recognises the standard layout whatever order the tab bar is listed in', () => {
    expect(isDefaultLayout({ order: [...NAV_IDS], tabBar: ['maintenance', 'jobs', 'inventory', 'overview'], ...shownEverywhere })).toBe(true);
    expect(isDefaultLayout(movePage(DEFAULT_LAYOUT, 0, 1))).toBe(false);
  });
});

describe('applyLayout', () => {
  it('orders pages and marks the tab bar ones', () => {
    const pages = NAV_IDS.map((id) => ({ id }));
    const out = applyLayout(pages, { order: [...NAV_IDS].reverse(), tabBar: ['settings'], hiddenDesktop: ['jobs'], hiddenPhone: ['jobs', 'activity'] });
    expect(out[0]).toEqual({ id: 'settings', primary: true, desktop: true, phone: true });
    expect(out.find((p) => p.id === 'jobs')).toMatchObject({ desktop: false, phone: false });
    expect(out.find((p) => p.id === 'activity')).toMatchObject({ desktop: true, phone: false });
    expect(out.filter((p) => p.primary)).toHaveLength(1);
    expect(out).toHaveLength(NAV_IDS.length);
  });
});

describe('hiding pages', () => {
  it('shows every page everywhere in a layout saved before pages could be hidden', () => {
    const layout = normalizeLayout({ order: [...NAV_IDS], tabBar: ['jobs'] });
    expect(layout.hiddenDesktop).toEqual([]);
    expect(layout.hiddenPhone).toEqual([]);
  });

  it('sets where a page shows, one device at a time', () => {
    const desktopOnly = setShown(DEFAULT_LAYOUT, 'activity', 'desktop');
    expect(shownOn(desktopOnly, 'activity')).toBe('desktop');
    expect(desktopOnly.hiddenPhone).toEqual(['activity']);
    expect(desktopOnly.hiddenDesktop).toEqual([]);
    expect(shownOn(setShown(desktopOnly, 'activity', 'phone'), 'activity')).toBe('phone');
    expect(shownOn(setShown(desktopOnly, 'activity', 'hidden'), 'activity')).toBe('hidden');
    expect(isDefaultLayout(setShown(desktopOnly, 'activity', 'both'))).toBe(true);
    expect(isDefaultLayout(desktopOnly)).toBe(false);
  });

  it('never hides Settings, from a click or from a saved layout', () => {
    expect(setShown(DEFAULT_LAYOUT, 'settings', 'hidden')).toBe(DEFAULT_LAYOUT);
    const saved = normalizeLayout({ order: [...NAV_IDS], tabBar: ['jobs'], hiddenDesktop: ['settings', 'nope'], hiddenPhone: ['settings'] });
    expect(shownOn(saved, 'settings')).toBe('both');
  });

  it('takes a page hidden on a phone out of the tab bar, and never leaves the bar empty', () => {
    const hidden = setShown(DEFAULT_LAYOUT, 'jobs', 'desktop');
    expect(hidden.tabBar).not.toContain('jobs');
    expect(setInTabBar(hidden, 'jobs', true)).toBe(hidden);

    const one: NavLayout = { order: [...NAV_IDS], tabBar: ['overview'], ...shownEverywhere };
    expect(setShown(one, 'overview', 'hidden').tabBar).toEqual(['inventory']);

    let all = DEFAULT_LAYOUT;
    for (const id of NAV_IDS) all = setShown(all, id, 'hidden');
    expect(all.tabBar).toEqual(['settings']);
    expect(normalizeLayout({ order: [...NAV_IDS], tabBar: ['jobs'], hiddenPhone: ['jobs'] }).tabBar).toEqual(['overview']);
  });
});
