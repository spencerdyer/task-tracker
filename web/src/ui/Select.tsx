import { forwardRef, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'children'> {
  options: SelectOption[];
  /** Accessible name (also the tooltip when nothing is selected) */
  label: string;
  size?: 'sm' | 'md';
  /** Stretch to the row instead of sizing to the longest option */
  block?: boolean;
  /** Shown when the value matches no option */
  placeholder?: string;
  leading?: ReactNode;
}

const H = { sm: 'h-7 text-xs', md: 'h-8 text-[13px]' };

/**
 * A native select that never clips: it is as wide as its longest option when the
 * row has room, and truncates the chosen label with an ellipsis (full text in the
 * tooltip) when it doesn't. The caret always keeps its space.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, label, size = 'md', block = false, placeholder, leading, className = '', value, disabled, ...rest },
  ref,
) {
  const current = options.find((o) => o.value === String(value ?? ''));
  const shown = current?.label ?? placeholder ?? '';
  return (
    <span
      className={`relative ${block ? 'flex w-full' : 'inline-flex max-w-full'} min-w-0 items-center gap-1.5 rounded-lg border border-nb-border bg-nb-surface pl-2 pr-1.5 text-nb-text focus-within:border-nb-accent ${H[size]} ${disabled ? 'opacity-50' : 'hover:border-nb-border-strong'} ${className}`}
      title={shown || label}
    >
      {leading}
      {/* Every label stacked in one grid cell: the box takes the longest one's width */}
      <span className="grid min-w-0 flex-1" aria-hidden>
        {options.map((o) => (
          <span key={o.value} className="col-start-1 row-start-1 invisible h-0 whitespace-nowrap overflow-hidden">{o.label}</span>
        ))}
        <span className="col-start-1 row-start-1 truncate">{shown}</span>
      </span>
      <ChevronDown size={size === 'sm' ? 13 : 14} strokeWidth={1.75} className="shrink-0 text-nb-text-3" aria-hidden />
      <select
        ref={ref}
        aria-label={label}
        value={value}
        disabled={disabled}
        data-truncates="true"
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default appearance-none"
        {...rest}
      >
        {!current && placeholder !== undefined && <option value={String(value ?? '')} disabled>{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
    </span>
  );
});
