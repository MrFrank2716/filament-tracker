import type { LucideIcon } from 'lucide-react';

/** One thing the command menu can do: open a page, or carry out an action. */
export interface Command {
  id: string;
  label: string;
  /** The heading it is listed under. */
  group: string;
  icon: LucideIcon;
  /** Other words someone might type to find it. */
  keywords?: string;
  /** Its keyboard shortcut, written like 'mod+k' (see lib/shortcuts.ts). */
  shortcut?: string;
  run: () => void;
}

const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The entries matching what was typed, best first. Every word typed must begin a word of the label or keywords
 * ("memb" finds Members; "pla" finds PLA, not Displays). Labels that start with the text come first, then
 * other label matches, then matches on keywords alone. An empty search returns everything in its given order.
 */
export function searchCommands<T extends Pick<Command, 'label' | 'keywords'>>(commands: T[], query: string): T[] {
  const text = query.trim().toLowerCase();
  const typed = wordsOf(text);
  if (!typed.length) return commands;
  const rank = (command: T): number | null => {
    const inLabel = wordsOf(command.label);
    const all = [...inLabel, ...wordsOf(command.keywords ?? '')];
    if (!typed.every((word) => all.some((known) => known.startsWith(word)))) return null;
    if (command.label.toLowerCase().startsWith(text)) return 0;
    return inLabel.some((known) => known.startsWith(typed[0])) ? 1 : 2;
  };
  return commands
    .map((command, index) => ({ command, index, rank: rank(command) }))
    .filter((entry): entry is { command: T; index: number; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.command);
}
