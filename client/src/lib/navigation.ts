/*
 * The main navigation's order, and which pages sit in the phone tab bar (the rest go under "More").
 * A personal choice saved on the account. A page can also be taken out of the desktop sidebar, the phone
 * navigation or both; Settings always stays, and a hidden page still opens from a link, so nothing becomes unreachable.
 */

// Keep in step with NAV_IDS in server/src/routes/auth.ts.
export const NAV_IDS = ['overview', 'inventory', 'locations', 'jobs', 'maintenance', 'machines', 'reorder', 'activity', 'settings'] as const;
export type NavId = (typeof NAV_IDS)[number];

export const MAX_TAB_BAR = 4;

/** Where a page shows in the navigation. */
export type NavShown = 'both' | 'desktop' | 'phone' | 'hidden';
export const NAV_SHOWN: Array<{ id: NavShown; label: string }> = [
  { id: 'both', label: 'Both' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'phone', label: 'Phone' },
  { id: 'hidden', label: 'Hidden' },
];

/** The way back to this setting, so it can never be hidden. */
export const ALWAYS_SHOWN: NavId = 'settings';

export interface NavLayout {
  /** Every page once, in sidebar order. */
  order: NavId[];
  /** 1 to MAX_TAB_BAR pages for the phone tab bar. They appear there in `order` order. */
  tabBar: NavId[];
  /** Pages left out of the desktop sidebar. */
  hiddenDesktop: NavId[];
  /** Pages left out of the phone tab bar and its "More" list. Never one that is in `tabBar`. */
  hiddenPhone: NavId[];
}

export const DEFAULT_LAYOUT: NavLayout = {
  order: [...NAV_IDS],
  tabBar: ['overview', 'inventory', 'jobs', 'maintenance'],
  hiddenDesktop: [],
  hiddenPhone: [],
};

const isNavId = (value: unknown): value is NavId => typeof value === 'string' && (NAV_IDS as readonly string[]).includes(value);

function knownOnce(value: unknown): NavId[] {
  return Array.isArray(value) ? [...new Set(value.filter(isNavId))] : [];
}

/** A tab bar is never empty: without a pick it takes the first page that shows on a phone. */
function filledTabBar(order: NavId[], tabBar: NavId[], hiddenPhone: NavId[]): NavId[] {
  const kept = order.filter((id) => tabBar.includes(id) && !hiddenPhone.includes(id)).slice(0, MAX_TAB_BAR);
  return kept.length > 0 ? kept : [order.find((id) => !hiddenPhone.includes(id)) ?? ALWAYS_SHOWN];
}

/**
 * Make any saved value usable: unknown pages are dropped, and a page added to the app since the
 * layout was saved joins at the end and shows everywhere, so an old layout never hides a new page.
 */
export function normalizeLayout(value: unknown): NavLayout {
  const saved = (value ?? {}) as { order?: unknown; tabBar?: unknown; hiddenDesktop?: unknown; hiddenPhone?: unknown };
  const order = knownOnce(saved.order);
  for (const id of NAV_IDS) if (!order.includes(id)) order.push(id);
  const hiddenDesktop = knownOnce(saved.hiddenDesktop).filter((id) => id !== ALWAYS_SHOWN);
  const hiddenPhone = knownOnce(saved.hiddenPhone).filter((id) => id !== ALWAYS_SHOWN);
  const picked = Array.isArray(saved.tabBar) ? knownOnce(saved.tabBar) : DEFAULT_LAYOUT.tabBar;
  return { order, tabBar: filledTabBar(order, picked, hiddenPhone), hiddenDesktop, hiddenPhone };
}

export function isDefaultLayout(layout: NavLayout): boolean {
  return sameLayout(layout, DEFAULT_LAYOUT);
}

const sameSet = (a: NavId[], b: NavId[]) => [...a].sort().join() === [...b].sort().join();

export function sameLayout(a: NavLayout, b: NavLayout): boolean {
  return (
    a.order.join() === b.order.join() &&
    sameSet(a.tabBar, b.tabBar) &&
    sameSet(a.hiddenDesktop, b.hiddenDesktop) &&
    sameSet(a.hiddenPhone, b.hiddenPhone)
  );
}

/** Move the page at `from` to position `to`. */
export function movePage(layout: NavLayout, from: number, to: number): NavLayout {
  if (from === to || from < 0 || to < 0 || from >= layout.order.length || to >= layout.order.length) return layout;
  const order = [...layout.order];
  const [id] = order.splice(from, 1);
  order.splice(to, 0, id);
  return { ...layout, order };
}

/** Put a page in the tab bar or take it out. Refused when that would leave it empty or over-full, or the page is hidden on a phone. */
export function setInTabBar(layout: NavLayout, id: NavId, on: boolean): NavLayout {
  const has = layout.tabBar.includes(id);
  if (on === has) return layout;
  if (on && (layout.tabBar.length >= MAX_TAB_BAR || layout.hiddenPhone.includes(id))) return layout;
  if (!on && layout.tabBar.length <= 1) return layout;
  return { ...layout, tabBar: on ? [...layout.tabBar, id] : layout.tabBar.filter((other) => other !== id) };
}

export function shownOn(layout: NavLayout, id: NavId): NavShown {
  const desktop = !layout.hiddenDesktop.includes(id);
  const phone = !layout.hiddenPhone.includes(id);
  if (desktop && phone) return 'both';
  if (desktop) return 'desktop';
  return phone ? 'phone' : 'hidden';
}

/** Choose where a page shows. A page that leaves the phone also leaves its tab bar, which then refills if empty. */
export function setShown(layout: NavLayout, id: NavId, shown: NavShown): NavLayout {
  if (id === ALWAYS_SHOWN || shownOn(layout, id) === shown) return layout;
  const without = (ids: NavId[]) => ids.filter((other) => other !== id);
  const hiddenDesktop = shown === 'both' || shown === 'desktop' ? without(layout.hiddenDesktop) : [...without(layout.hiddenDesktop), id];
  const hiddenPhone = shown === 'both' || shown === 'phone' ? without(layout.hiddenPhone) : [...without(layout.hiddenPhone), id];
  return { order: layout.order, tabBar: filledTabBar(layout.order, layout.tabBar, hiddenPhone), hiddenDesktop, hiddenPhone };
}

/** Sort the app's pages into the user's order and mark where each shows: sidebar, phone, and the tab bar. */
export function applyLayout<T extends { id: NavId }>(pages: T[], layout: NavLayout): Array<T & { primary: boolean; desktop: boolean; phone: boolean }> {
  return [...pages]
    .sort((a, b) => layout.order.indexOf(a.id) - layout.order.indexOf(b.id))
    .map((page) => ({
      ...page,
      primary: layout.tabBar.includes(page.id),
      desktop: !layout.hiddenDesktop.includes(page.id),
      phone: !layout.hiddenPhone.includes(page.id),
    }));
}
