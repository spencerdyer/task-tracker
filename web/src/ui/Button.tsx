import { forwardRef, type ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-nb-accent text-nb-accent-fg font-semibold border border-transparent hover:brightness-110',
  secondary: 'bg-nb-surface text-nb-text font-medium border border-nb-border hover:bg-nb-raised',
  ghost: 'bg-transparent text-nb-text-2 font-medium border border-transparent hover:bg-nb-hover hover:text-nb-text',
  danger: 'bg-nb-danger-soft text-nb-danger-text font-medium border border-transparent hover:brightness-110',
};

const SIZE: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  lg: 'h-11 px-4 text-sm gap-2 rounded-[10px]',
};

const ICON_SIZE: Record<Size, number> = { sm: 14, md: 15, lg: 18 };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, className = '', children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nb-accent ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {Icon && <Icon size={ICON_SIZE[size]} strokeWidth={1.75} aria-hidden />}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** Required: icon-only buttons need an accessible name. */
  label: string;
  variant?: 'ghost' | 'outline' | 'accent';
  size?: Size;
  active?: boolean;
}

const ICON_BTN_SIZE: Record<Size, string> = { sm: 'w-7 h-7 rounded-md', md: 'w-8 h-8 rounded-lg', lg: 'w-11 h-11 rounded-[10px]' };
const ICON_BTN_GLYPH: Record<Size, number> = { sm: 14, md: 16, lg: 20 };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, variant = 'ghost', size = 'md', active = false, className = '', type = 'button', ...rest },
  ref,
) {
  const look = active
    ? 'bg-nb-accent-soft text-nb-accent-text border border-transparent'
    : variant === 'outline'
      ? 'bg-nb-surface text-nb-text border border-nb-border hover:bg-nb-raised'
      : variant === 'accent'
        ? 'bg-nb-accent text-nb-accent-fg border border-transparent hover:brightness-110'
        : 'bg-transparent text-nb-text-2 border border-transparent hover:bg-nb-hover hover:text-nb-text';
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={rest.title ?? label}
      className={`inline-flex items-center justify-center shrink-0 transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nb-accent ${ICON_BTN_SIZE[size]} ${look} ${className}`}
      {...rest}
    >
      <Icon size={ICON_BTN_GLYPH[size]} strokeWidth={1.75} aria-hidden />
    </button>
  );
});
