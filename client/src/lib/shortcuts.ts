/*
 * Keyboard shortcuts. Every shortcut here needs Command (Mac) or Ctrl (everywhere else): a barcode scanner
 * types like a keyboard, so a shortcut on a bare letter would fire in the middle of a scan.
 *
 * A shortcut is written 'mod+k', where mod is Command on Apple devices and Ctrl elsewhere.
 */

export const SEARCH_SHORTCUT = 'mod+k';

/** Apple keyboards have Command where others have Ctrl. */
export function isApple(platform: string = typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

const parse = (shortcut: string) => {
  const parts = shortcut.toLowerCase().split('+');
  return { key: parts.at(-1) ?? '', mod: parts.includes('mod'), shift: parts.includes('shift') };
};

/** How a shortcut is shown next to its action: "⌘K" on a Mac, "Ctrl K" elsewhere. */
export function shortcutLabel(shortcut: string, apple: boolean = isApple()): string {
  const { key, mod, shift } = parse(shortcut);
  const name = key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
  if (apple) return `${mod ? '⌘' : ''}${shift ? '⇧' : ''}${name}`;
  return [mod ? 'Ctrl' : '', shift ? 'Shift' : '', name].filter(Boolean).join(' ');
}

/** True while the focus is somewhere text is typed. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

interface KeyPress {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
}

/**
 * Whether a key press is this shortcut. A shortcut without Command or Ctrl never fires while someone is typing
 * in a field; one with it does, since it cannot be mistaken for text.
 */
export function isShortcut(event: KeyPress, shortcut: string, apple: boolean = isApple()): boolean {
  const { key, mod, shift } = parse(shortcut);
  if (event.key.toLowerCase() !== key || event.altKey || event.shiftKey !== shift) return false;
  const held = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (mod) return held;
  return !event.metaKey && !event.ctrlKey && !isTyping(event.target);
}
