import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import styles from '@/components/ui/Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  block?: boolean;
  children?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, block, className, children, type = 'button', ...rest }: ButtonProps) {
  const classes = [styles.button, styles[variant], styles[size], block ? styles.block : '', className ?? ''].join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {Icon && <Icon size={size === 'sm' ? 15 : 18} aria-hidden />}
      {children && <span>{children}</span>}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  variant?: Variant;
  size?: Size;
}

/** Icon-only button. `label` is required so it always has an accessible name. */
export function IconButton({ icon: Icon, label, variant = 'ghost', size = 'md', className, type = 'button', ...rest }: IconButtonProps) {
  const classes = [styles.button, styles.iconOnly, styles[variant], styles[size], className ?? ''].join(' ');
  return (
    <button type={type} className={classes} aria-label={label} title={label} {...rest}>
      <Icon size={size === 'sm' ? 16 : 19} aria-hidden />
    </button>
  );
}
