/**
 * Copy text to the clipboard. `navigator.clipboard` only exists on secure origins
 * (https or localhost); on a plain-http address on a home network it is undefined.
 * There, fall back to a hidden textarea and execCommand('copy').
 * Resolves true when the text was copied.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the old way (e.g. permission denied)
    }
  }
  const previous = document.activeElement as HTMLElement | null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.opacity = '0';
  // Inside an open dialog so its focus trap doesn't fight the selection
  (previous?.closest('[role="dialog"]') ?? document.body).appendChild(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  previous?.focus?.();
  return ok;
}
