import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Check, ChevronDown, LayoutGrid } from 'lucide-react';
import { TypeIcon } from '@/components/ui/Display';
import { useMachineFocus } from '@/context/FocusContext';
import { useCatalog } from '@/hooks/useCatalog';
import styles from '@/components/layout/FocusPicker.module.css';

/**
 * The main toggle: the whole workshop, or one machine and only what belongs to it.
 * A compact pill in each page header, except on Settings and Appearance, which configure the workspace as a whole.
 */
export function FocusPicker() {
  const { machines, machineTypeById } = useCatalog();
  const { machine, setFocus } = useMachineFocus();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  // Anchored to the pill's right edge; where the pill has wrapped under the title on a phone, that would
  // push the list off the left of the screen, so it opens from the left edge instead.
  const [alignLeft, setAlignLeft] = useState(false);

  useLayoutEffect(() => {
    if (!open) {
      setAlignLeft(false);
      return;
    }
    const box = list.current?.getBoundingClientRect();
    if (box && box.left < 8) setAlignLeft(true);
  }, [open]);

  // A route change closes the list.
  useEffect(() => setOpen(false), [pathname]);

  // While open: an outside click closes it, and focus starts on the current choice.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  if (machines.length === 0 || pathname.startsWith('/settings') || pathname.startsWith('/appearance')) return null;

  const iconFor = (machineTypeId: string | null | undefined) =>
    (machineTypeId && machineTypeById.get(machineTypeId)?.icon) || 'Cog';
  const name = machine?.name ?? 'Whole workshop';

  const choose = (id: string | null) => {
    setFocus(id);
    setOpen(false);
    button.current?.focus();
  };

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const options = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const at = options.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      options[(at + step + options.length) % options.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      options[e.key === 'Home' ? 0 : options.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const option = (id: string | null, label: string, icon: ReactNode) => {
    const selected = (machine?.id ?? null) === id;
    return (
      <li
        key={id ?? 'all'}
        role="option"
        aria-selected={selected}
        tabIndex={-1}
        className={styles.option}
        onClick={() => choose(id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            choose(id);
          }
        }}
      >
        {icon}
        <span className={styles.optionLabel}>{label}</span>
        {selected && <Check className={styles.check} size={16} aria-hidden />}
      </li>
    );
  };

  return (
    <div className={styles.picker} ref={root}>
      <button
        ref={button}
        type="button"
        className={`${styles.trigger} ${machine ? styles.focused : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Viewing: ${name}`}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          } else if (e.key === 'Escape' && open) {
            setOpen(false);
          }
        }}
      >
        {machine ? <TypeIcon icon={iconFor(machine.machineTypeId)} size="sm" /> : <LayoutGrid size={16} aria-hidden />}
        <span className={styles.name}>{name}</span>
        <ChevronDown className={styles.chevron} size={16} aria-hidden />
      </button>
      {open && (
        <ul id={listId} ref={list} role="listbox" aria-label="View the whole workshop or one machine" className={`${styles.menu} ${alignLeft ? styles.alignLeft : ''}`} onKeyDown={onListKey}>
          {option(null, 'Whole workshop', <LayoutGrid size={16} aria-hidden />)}
          {machines.map((m) => option(m.id, m.name, <TypeIcon icon={iconFor(m.machineTypeId)} size="sm" />))}
        </ul>
      )}
    </div>
  );
}
