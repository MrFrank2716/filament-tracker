import { describe, expect, it } from 'vitest';
import { isApple, isShortcut, shortcutLabel } from '@/lib/shortcuts';

const press = (key: string, held: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  target: null,
  ...held,
});

describe('shortcutLabel', () => {
  it('shows the Command sign on Apple devices and Ctrl elsewhere', () => {
    expect(shortcutLabel('mod+k', true)).toBe('⌘K');
    expect(shortcutLabel('mod+k', false)).toBe('Ctrl K');
    expect(shortcutLabel('mod+shift+p', true)).toBe('⌘⇧P');
    expect(shortcutLabel('mod+shift+p', false)).toBe('Ctrl Shift P');
    expect(shortcutLabel('escape', false)).toBe('Escape');
  });
});

describe('isApple', () => {
  it('knows Macs, iPhones and iPads from the rest', () => {
    expect(isApple('MacIntel')).toBe(true);
    expect(isApple('iPhone')).toBe(true);
    expect(isApple('Win32')).toBe(false);
    expect(isApple('Linux x86_64')).toBe(false);
  });
});

describe('isShortcut', () => {
  it('wants Command on a Mac and Ctrl elsewhere, not the other one', () => {
    expect(isShortcut(press('k', { metaKey: true }), 'mod+k', true)).toBe(true);
    expect(isShortcut(press('k', { ctrlKey: true }), 'mod+k', true)).toBe(false);
    expect(isShortcut(press('k', { ctrlKey: true }), 'mod+k', false)).toBe(true);
    expect(isShortcut(press('k', { metaKey: true }), 'mod+k', false)).toBe(false);
  });

  it('ignores the bare letter, other letters, and extra keys held', () => {
    expect(isShortcut(press('k'), 'mod+k', false)).toBe(false);
    expect(isShortcut(press('j', { ctrlKey: true }), 'mod+k', false)).toBe(false);
    expect(isShortcut(press('k', { ctrlKey: true, shiftKey: true }), 'mod+k', false)).toBe(false);
    expect(isShortcut(press('k', { ctrlKey: true, altKey: true }), 'mod+k', false)).toBe(false);
    expect(isShortcut(press('K', { ctrlKey: true }), 'mod+k', false)).toBe(true);
  });
});
