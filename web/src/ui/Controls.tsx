import { forwardRef, type KeyboardEventHandler, type ReactNode } from 'react';
import { Search, X, type LucideIcon } from 'lucide-react';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Shown as the tooltip; also the accessible name when the segment is icon-only. */
  hint?: string;
  iconOnly?: boolean;
}

/** A row of mutually exclusive toggle buttons (Edit/Read, list/grid, tile size). */
export function SegmentedControl<T extends string>({
  options, value, onChange, label, size = 'md', className = '',
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const h = size === 'sm' ? 'h-6 text-xs' : 'h-[26px] text-xs';
  return (
    <div role="group" aria-label={label} className={`inline-flex p-0.5 gap-0.5 rounded-lg bg-nb-surface border border-nb-border ${className}`}>
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            aria-label={o.iconOnly ? (o.hint ?? o.label) : undefined}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={`${h} ${o.iconOnly ? 'w-7' : 'px-2.5'} inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-nb-accent ${on ? 'bg-nb-chosen text-nb-text' : 'text-nb-text-2 hover:text-nb-text'}`}
          >
            {Icon && <Icon size={14} strokeWidth={1.75} aria-hidden />}
            {!o.iconOnly && o.label}
          </button>
        );
      })}
    </div>
  );
}

export const SearchField = forwardRef<HTMLInputElement, {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label?: string;
  className?: string;
  size?: 'md' | 'lg';
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}>(function SearchField({ value, onChange, placeholder, label, className = '', size = 'md', onKeyDown }, ref) {
  const h = size === 'lg' ? 'h-10 rounded-[10px] px-3.5 text-sm' : 'h-8 rounded-lg px-2.5 text-[13px]';
  return (
    <label className={`flex items-center gap-2 min-w-0 bg-nb-surface border border-nb-border text-nb-text-3 focus-within:border-nb-accent ${h} ${className}`}>
      <Search size={size === 'lg' ? 17 : 15} strokeWidth={1.75} aria-hidden className="shrink-0" />
      <input
        ref={ref}
        type="search"
        value={value}
        aria-label={label ?? placeholder}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) { e.stopPropagation(); onChange(''); }
          onKeyDown?.(e);
        }}
        className="flex-1 min-w-0 bg-transparent border-0 outline-hidden text-nb-text placeholder:text-nb-text-3 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="shrink-0 text-nb-text-3 hover:text-nb-text">
          <X size={14} strokeWidth={1.75} aria-hidden />
        </button>
      )}
    </label>
  );
});

export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      role="presentation"
      className={`inline-block shrink-0 rounded-full border-2 border-nb-border-strong border-t-nb-accent animate-spin ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function EmptyState({
  icon: Icon, title, children, action, className = '', role,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  role?: 'alert' | 'status';
}) {
  return (
    <div role={role} className={`flex flex-col items-center justify-center text-center gap-3 px-6 py-12 ${className}`}>
      <span className="w-12 h-12 rounded-xl bg-nb-surface border border-nb-border text-nb-text-3 inline-flex items-center justify-center">
        <Icon size={22} strokeWidth={1.5} aria-hidden />
      </span>
      <div className="flex flex-col gap-1 max-w-xs">
        <h3 className="m-0 text-sm font-semibold text-nb-text">{title}</h3>
        {children && <p className="m-0 text-[13px] leading-5 text-nb-text-2">{children}</p>}
      </div>
      {action}
    </div>
  );
}
