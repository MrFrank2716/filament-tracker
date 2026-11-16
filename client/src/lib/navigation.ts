/*
 * The main navigation's order, and which pages sit in the phone tab bar (the rest go under "More").
 * A personal choice saved on the account. Pages can be moved, never hidden, so nothing becomes unreachable.
 */

// Keep in step with NAV_IDS in server/src/routes/auth.ts.
export const NAV_IDS = ['overview', 'inventory', 'locations', 'jobs', 'maintenance', 'machines', 'reorder', 'activity', 'settings'] as const;
export type NavId = (typeof NAV_IDS)[number];

export const MAX_TAB_BAR = 4;

export interface NavLayout {
  /** Every page once, in sidebar order. */
  order: NavId[];
  /** 1 to MAX_TAB_BAR pages for the phone tab bar. They appear there in `order` order. */
  tabBar: NavId[];
}

export const DEFAULT_LAYOUT: NavLayout = {
  order: [...NAV_IDS],
  tabBar: ['overview', 'inventory', 'jobs', 'maintenance'],
};

const isNavId = (value: unknown): value is NavId => typeof value === 'string' && (NAV_IDS as readonly string[]).includes(value);

function knownOnce(value: unknown): NavId[] {
  return Array.isArray(value) ? [...new Set(value.filter(isNavId))] : [];
}

/**
 * Make any saved value usable: unknown pages are dropped, and a page added to the app since the
 * layout was saved joins at the end, so an old layout never hides a new page.
 */
export function normalizeLayout(value: unknown): NavLayout {
  const saved = (value ?? {}) as { order?: unknown; tabBar?: unknown };
  const order = knownOnce(saved.order);
  for (const id of NAV_IDS) if (!order.includes(id)) order.push(id);
  if (!Array.isArray(saved.tabBar)) return { order, tabBar: order.filter((id) => DEFAULT_LAYOUT.tabBar.includes(id)) };
  const picked = knownOnce(saved.tabBar);
  const tabBar = order.filter((id) => picked.includes(id)).slice(0, MAX_TAB_BAR);
  return { order, tabBar: tabBar.length > 0 ? tabBar : [order[0]] };
}

export function isDefaultLayout(layout: NavLayout): boolean {
  return sameLayout(layout, DEFAULT_LAYOUT);
}

export function sameLayout(a: NavLayout, b: NavLayout): boolean {
  return a.order.join() === b.order.join() && [...a.tabBar].sort().join() === [...b.tabBar].sort().join();
}

/** Move the page at `from` to position `to`. */
export function movePage(layout: NavLayout, from: number, to: number): NavLayout {
  if (from === to || from < 0 || to < 0 || from >= layout.order.length || to >= layout.order.length) return layout;
  const order = [...layout.order];
  const [id] = order.splice(from, 1);
  order.splice(to, 0, id);
  return { order, tabBar: layout.tabBar };
}

/** Put a page in the tab bar or take it out. Refused when that would leave it empty or over-full. */
export function setInTabBar(layout: NavLayout, id: NavId, on: boolean): NavLayout {
  const has = layout.tabBar.includes(id);
  if (on === has) return layout;
  if (on && layout.tabBar.length >= MAX_TAB_BAR) return layout;
  if (!on && layout.tabBar.length <= 1) return layout;
  return { order: layout.order, tabBar: on ? [...layout.tabBar, id] : layout.tabBar.filter((other) => other !== id) };
}

/** Sort the app's pages into the user's order and mark the ones that belong in the tab bar. */
export function applyLayout<T extends { id: NavId }>(pages: T[], layout: NavLayout): Array<T & { primary: boolean }> {
  return [...pages]
    .sort((a, b) => layout.order.indexOf(a.id) - layout.order.indexOf(b.id))
    .map((page) => ({ ...page, primary: layout.tabBar.includes(page.id) }));
}
