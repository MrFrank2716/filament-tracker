import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Search } from 'lucide-react';
import { Kbd } from '@/components/ui/Display';
import { Modal } from '@/components/ui/Modal';
import { useItems } from '@/hooks/useCatalog';
import { searchCommands, type Command } from '@/lib/commands';
import { shortcutLabel } from '@/lib/shortcuts';
import styles from '@/components/layout/CommandMenu.module.css';

/** How many inventory items a search lists at most; typing more narrows it down. */
const MAX_ITEMS = 6;

/**
 * Search every page and action, and the inventory, and open the result without touching the mouse:
 * type, arrow up or down, Enter. Opened from the navigation or with its shortcut (see AppShell).
 */
export function CommandMenu({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const { items } = useItems();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  // The dialog focuses its Close button when it opens; the search field is what this one is for.
  useEffect(() => input.current?.focus(), []);

  const results = useMemo(() => {
    const found = searchCommands(commands, query);
    if (query.trim().length < 2) return found;
    const stock: Command[] = items.map((item) => ({
      id: `item:${item.id}`,
      label: item.name,
      group: 'Inventory',
      icon: Package,
      keywords: item.sku,
      run: () => navigate(`/inventory?item=${encodeURIComponent(item.id)}`),
    }));
    return [...found, ...searchCommands(stock, query).slice(0, MAX_ITEMS)];
  }, [commands, items, query, navigate]);

  // Listed under their headings, in the order the headings first appear; arrow keys walk the same order.
  const groups = useMemo(() => {
    const byGroup = new Map<string, Command[]>();
    for (const command of results) byGroup.set(command.group, [...(byGroup.get(command.group) ?? []), command]);
    return [...byGroup];
  }, [results]);
  const ordered = groups.flatMap(([, list]) => list);
  const current = ordered[Math.min(active, ordered.length - 1)];
  const optionId = (command: Command) => `${listId}-${command.id}`;

  useEffect(() => {
    if (current) document.getElementById(`${listId}-${current.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [current, listId]);

  const run = (command: Command) => {
    onClose();
    command.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = ordered.length - 1;
    const at = Math.min(active, last);
    if (event.key === 'ArrowDown') setActive(at >= last ? 0 : at + 1);
    else if (event.key === 'ArrowUp') setActive(at <= 0 ? last : at - 1);
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(last);
    else if (event.key === 'Enter' && current) run(current);
    else return;
    event.preventDefault();
  };

  return (
    <Modal title="Search" onClose={onClose}>
      <label className={styles.search}>
        <Search size={18} aria-hidden />
        <input
          ref={input}
          className={styles.input}
          type="text"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={current ? optionId(current) : undefined}
          aria-autocomplete="list"
          aria-label="Search pages, actions and inventory"
          placeholder="Go to a page, do something, or find an item…"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </label>

      <div id={listId} className={styles.list} role="listbox" aria-label="Results">
        {groups.map(([group, list]) => (
          <div key={group} role="group" aria-label={group}>
            <div className={styles.heading} aria-hidden>
              {group}
            </div>
            {list.map((command) => (
              // Chosen with the keyboard from the search field, so the options themselves take no focus.
              <div
                key={command.id}
                id={optionId(command)}
                role="option"
                aria-selected={command === current}
                className={`${styles.option} ${command === current ? styles.active : ''}`}
                onClick={() => run(command)}
                onMouseMove={() => setActive(ordered.indexOf(command))}
              >
                <command.icon size={18} aria-hidden />
                <span className={styles.label}>{command.label}</span>
                {command.shortcut && <Kbd>{shortcutLabel(command.shortcut)}</Kbd>}
              </div>
            ))}
          </div>
        ))}
        {ordered.length === 0 && <p className={styles.none}>Nothing matches “{query.trim()}”.</p>}
      </div>

      <p className={styles.hints} aria-hidden>
        <span>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move
        </span>
        <span>
          <Kbd>Enter</Kbd> to open
        </span>
        <span>
          <Kbd>Esc</Kbd> to close
        </span>
      </p>
    </Modal>
  );
}
