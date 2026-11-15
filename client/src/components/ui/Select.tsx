import type { SelectHTMLAttributes } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import styles from '@/components/ui/Select.module.css';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Optional icon drawn inside the control, before the selected value. */
  icon?: LucideIcon;
  /** Shorter control for dense rows such as table cells. */
  compact?: boolean;
  /** Class for the wrapper, which carries width and layout. */
  wrapClassName?: string;
}

/**
 * A native select with our own chevron. Phones keep the system picker; in browsers that
 * support customizable selects (appearance: base-select) the open list is styled too.
 */
export function Select({ icon: Icon, compact, wrapClassName, className, children, ...rest }: SelectProps) {
  const wrap = [styles.wrap, compact && styles.compact, Icon && styles.withIcon, wrapClassName].filter(Boolean).join(' ');
  return (
    <span className={wrap}>
      {Icon && <Icon className={styles.lead} size={16} aria-hidden />}
      <select className={`${styles.select} ${className ?? ''}`} {...rest}>
        {children}
      </select>
      <ChevronDown className={styles.chevron} size={16} aria-hidden />
    </span>
  );
}
