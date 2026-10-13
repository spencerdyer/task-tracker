import { useCallback, useEffect, useLayoutEffect, type RefObject } from 'react';

// A text box that grows with what's typed. On a small screen the boxes stayed one or two lines high:
// `field-sizing: content` isn't in Safari, and the composers counted only newlines, not wrapped lines.
//
// - `maxFraction` (composers): grow up to that share of the visible height (the smaller of the visual
//   viewport, which shrinks for the on-screen keyboard, and the panel the box is in, for squeezed desktop
//   panels), then scroll inside, keeping the caret in view while typing at the end.
// - `maxFraction: null` (a page-sized editor such as the Journal's): grow to fit everything and keep the
//   caret in view by scrolling the page around it.

export interface GrowingTextareaOptions {
  /** Share of the visible height the box may take before it scrolls inside; null = no cap */
  maxFraction?: number | null;
}

/** The height the box may grow to: a share of what's visible of the page and of its panel */
export function growLimit(el: HTMLElement, fraction: number): number {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  let visible = vv?.height || window.innerHeight || 0;
  const panel = el.closest('[data-grow-root], .nb-scope') as HTMLElement | null;
  if (panel && panel.clientHeight > 0) visible = Math.min(visible, panel.clientHeight);
  return Math.max(48, Math.floor(visible * fraction));
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

export function useGrowingTextarea(
  ref: RefObject<HTMLTextAreaElement>,
  value: string,
  { maxFraction = 0.4 }: GrowingTextareaOptions = {},
): () => void {
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const atEnd = el.selectionEnd >= el.value.length;
    const focused = typeof document !== 'undefined' && document.activeElement === el;
    // Measure what the text needs: height auto, then the scroll height (plus the borders)
    const before = el.scrollTop;
    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const borders = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const natural = el.scrollHeight + borders;
    const max = maxFraction == null ? Infinity : growLimit(el, maxFraction);
    el.style.height = `${Math.min(natural, max)}px`;
    const scrolls = natural > max;
    el.style.overflowY = scrolls ? 'auto' : 'hidden';
    if (scrolls) {
      // Inside the box: follow the caret when it's at the end (typing, pasting); else stay where it was
      el.scrollTop = focused && atEnd ? el.scrollHeight : before;
    } else if (focused && atEnd && maxFraction == null) {
      // A page-sized editor: keep the end of the text (the caret) above the bottom of the page
      const page = scrollParent(el);
      if (page) {
        const over = el.getBoundingClientRect().bottom - page.getBoundingClientRect().bottom;
        if (over > 0) page.scrollTop += over + 16;
      }
    }
  }, [ref, maxFraction]);

  // On every change of the text, before the browser paints
  useLayoutEffect(fit, [fit, value]);

  // And when the room changes: the keyboard opening, the window or panel resized, the box's width
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vv = window.visualViewport;
    let raf: number | null = null;
    const later = () => { if (raf === null) raf = requestAnimationFrame(() => { raf = null; fit(); }); };
    vv?.addEventListener('resize', later);
    window.addEventListener('resize', later);
    let lastWidth = el.clientWidth;
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => { if (el.clientWidth !== lastWidth) { lastWidth = el.clientWidth; later(); } })
      : null;
    ro?.observe(el);
    const panel = el.closest('[data-grow-root], .nb-scope');
    if (panel && maxFraction != null) ro?.observe(panel);
    return () => {
      vv?.removeEventListener('resize', later);
      window.removeEventListener('resize', later);
      ro?.disconnect();
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [ref, fit, maxFraction]);

  return fit;
}
