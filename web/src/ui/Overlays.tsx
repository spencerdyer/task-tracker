import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, X, type LucideIcon } from 'lucide-react';
import { IconButton } from './Button';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Width of an element, kept current with ResizeObserver. 0 until measured. */
export function useContainerWidth<T extends HTMLElement>(ref: RefObject<T>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** Menus are portalled to the body; the theme class is on <html>, so they keep the dark tokens. */
function themeRoot(): HTMLElement {
  return document.body;
}

/**
 * A dialog scoped to its widget: it covers the nearest positioned ancestor (make the widget
 * root `relative`), not the whole app. `sheet` slides up from the bottom for narrow panels.
 */
export function PanelDialog({
  open, onClose, title, children, footer, variant = 'center', width = 440, className = '',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  variant?: 'center' | 'sheet';
  width?: number;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const titleId = useRef(`nbdlg-${Math.random().toString(36).slice(2, 9)}`).current;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const box = boxRef.current;
    const home = box?.parentElement?.closest<HTMLElement>('.nb-scope') ?? null;
    const first = box?.querySelector<HTMLElement>('[data-autofocus]') ?? box?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? box)?.focus();
    // Back to what opened the dialog; when that's gone (an approved ticket's card, a deleted row), the
    // widget's first control rather than the page, where a keyboard user would start over
    return () => {
      if (previous?.isConnected) previous.focus?.();
      else home?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !boxRef.current) return;
    const items = Array.from(boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const sheet = variant === 'sheet';
  return (
    <div className={`absolute inset-0 z-40 flex ${sheet ? 'items-end' : 'items-center justify-center p-4'}`} onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-nb-scrim" onClick={onClose} aria-hidden />
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex flex-col bg-nb-surface text-nb-text border border-nb-border-strong shadow-nb outline-hidden ${sheet ? 'w-full max-h-[85%] rounded-t-2xl border-b-0' : 'max-h-full rounded-xl'} ${className}`}
        style={sheet ? undefined : { width: `min(${width}px, 100%)` }}
      >
        {sheet && <div className="self-center w-9 h-1 mt-2 rounded-full bg-nb-border-strong" aria-hidden />}
        <div className="flex items-center gap-2 pl-4 pr-2 pt-2.5 pb-1.5">
          <h2 id={titleId} className="m-0 flex-1 text-base font-semibold">{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} size={sheet ? 'lg' : 'md'} />
        </div>
        <div className="flex-1 min-h-0 overflow-auto">{children}</div>
        {footer && <div className="flex items-center gap-2 px-4 py-3 border-t border-nb-border">{footer}</div>}
      </div>
    </div>
  );
}

export type MenuItem =
  | {
      label: string; icon?: LucideIcon; onSelect: () => void; danger?: boolean; shortcut?: string; disabled?: boolean;
      /** A status line under the label (e.g. "Translating: page 3 of 20"); `hintTone: 'danger'` for an error */
      hint?: string; hintTone?: 'danger';
      /** Leave the menu open after choosing it, for an action whose status line updates in place */
      keepOpen?: boolean;
      title?: string;
      /** A switch in a list (which projects are shown): read out as checked or not, a tick when on */
      checked?: boolean;
    }
  | 'separator';

/** A floating action menu at a point (context menu) or under an element (overflow button). */
export function Menu({
  items, onClose, at, anchor, label,
}: {
  items: MenuItem[];
  onClose: () => void;
  at?: { x: number; y: number };
  anchor?: HTMLElement | null;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = at?.x ?? 0, top = at?.y ?? 0;
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      left = r.right - w;
      top = r.bottom + 4;
      if (left < 8) left = r.left;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    if (top + h > window.innerHeight - 8) top = Math.max(8, (anchor ? anchor.getBoundingClientRect().top - h - 4 : top - h));
    setPos({ left, top });
    el.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus();
  }, [at, anchor]);

  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const blur = () => onClose();
    document.addEventListener('mousedown', down);
    window.addEventListener('resize', blur);
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('resize', blur); };
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent) => {
    const list = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? []);
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); onClose(); anchor?.focus(); }
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="nb-scope fixed z-1000 min-w-[200px] max-w-[min(320px,calc(100vw-16px))] max-h-[calc(100vh-16px)] overflow-y-auto py-1 rounded-[10px] bg-nb-raised border border-nb-border-strong shadow-nb text-nb-text font-ui"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      {items.map((it, i) =>
        it === 'separator' ? (
          <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-nb-border" />
        ) : (
          <button
            key={it.label}
            type="button"
            role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={it.checked}
            disabled={it.disabled}
            title={it.title}
            // Back to the button that opened the menu before acting: a dialog the item opens then knows where
            // to return focus when it closes (it used to fall to the page body)
            // An item that leaves the menu open keeps focus in it: Safari doesn't focus a clicked button, and Escape
            // (and the arrow keys) then went nowhere
            onClick={(e) => { if (!it.keepOpen) { onClose(); anchor?.focus(); } else e.currentTarget.focus(); it.onSelect(); }}
            className={`w-full flex items-center gap-2.5 ${it.hint ? 'min-h-8 py-1.5' : 'h-8'} px-3 text-[13px] text-left outline-hidden hover:bg-nb-hover focus:bg-nb-hover disabled:opacity-40 ${it.danger ? 'text-nb-danger-text' : ''}`}
          >
            {it.icon && <it.icon size={15} strokeWidth={1.75} aria-hidden className={`shrink-0 ${it.danger ? '' : 'text-nb-text-2'}`} />}
            {it.hint ? (
              <span className="flex-1 min-w-0">
                <span className="block">{it.label}</span>
                <span className={`block text-[11.5px] leading-snug ${it.hintTone === 'danger' ? 'text-nb-danger-text' : 'text-nb-text-3'}`}>{it.hint}</span>
              </span>
            ) : (
              <span className="flex-1">{it.label}</span>
            )}
            {it.shortcut && <span className="font-mono text-[11px] text-nb-text-3">{it.shortcut}</span>}
            {it.checked !== undefined && (
              <Check size={15} strokeWidth={2} aria-hidden className={`shrink-0 ${it.checked ? 'text-nb-accent-text' : 'invisible'}`} />
            )}
          </button>
        ),
      )}
    </div>,
    themeRoot(),
  );
}

/** Button + Menu pair for overflow ("More actions") menus. */
export function MenuButton({
  items, label, children,
}: {
  items: MenuItem[];
  label: string;
  /** Render prop for the trigger; spread `props` onto a button. */
  children: (props: { ref: Ref<HTMLButtonElement>; onClick: () => void; 'aria-haspopup': 'menu'; 'aria-expanded': boolean }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      {children({ ref: btn, onClick: () => setOpen((o) => !o), 'aria-haspopup': 'menu', 'aria-expanded': open })}
      {open && <Menu items={items} onClose={close} anchor={btn.current} label={label} />}
    </>
  );
}

interface ToastState { id: number; message: string; tone: 'info' | 'error'; action?: { label: string; onClick: () => void } }

/**
 * Panel-scoped toasts. Render `toast.element` inside the widget's `relative` root.
 * Errors stay until dismissed; others clear after 4s.
 */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((message: string, opts: { tone?: 'info' | 'error'; action?: ToastState['action'] } = {}) => {
    clearTimeout(timer.current);
    const t = { id: Date.now(), message, tone: opts.tone ?? 'info', action: opts.action };
    setToast(t);
    if (t.tone !== 'error') timer.current = setTimeout(() => setToast(null), 4000);
  }, []);
  const dismiss = useCallback(() => { clearTimeout(timer.current); setToast(null); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const element = toast ? (
    <div role={toast.tone === 'error' ? 'alert' : 'status'}
      className="absolute left-1/2 bottom-20 -translate-x-1/2 z-50 flex items-center gap-3 w-max max-w-[calc(100%-32px)] min-h-11 pl-3.5 pr-1.5 py-1.5 rounded-xl bg-nb-raised border border-nb-border-strong shadow-nb text-[13px] text-nb-text">
      <span className={`w-2 h-2 shrink-0 rounded-full ${toast.tone === 'error' ? 'bg-nb-danger' : 'bg-nb-success'}`} aria-hidden />
      <span className="flex-1 min-w-0">{toast.message}</span>
      {toast.action && (
        <button type="button" onClick={() => { toast.action!.onClick(); dismiss(); }} className="shrink-0 h-8 px-2 rounded-md font-medium text-nb-accent-text hover:bg-nb-hover">
          {toast.action.label}
        </button>
      )}
      <IconButton icon={X} label="Dismiss" size="sm" onClick={dismiss} />
    </div>
  ) : null;

  return { show, dismiss, element };
}
