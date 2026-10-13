import { useCallback, useEffect, useRef, useState } from 'react';

/** How long nothing may arrive before we say the line has stalled. */
export const STALL_HINT_MS = 8000;
export const STALL_HINT_TEXT = 'Waiting for the connection…';

/**
 * True while `active` and nothing has arrived for `ms`: on a stalled line a reply, a send or an
 * upload otherwise just shows "…" or a spinner for 15–30 s. Call `bump()` whenever bytes arrive
 * (a stream event, upload progress); it clears the hint at once. A request with no progress to
 * report (a short POST) just counts from when it started.
 */
export function useStallHint(active: boolean, ms: number = STALL_HINT_MS) {
  const last = useRef(0);
  const [stalled, setStalled] = useState(false);
  const bump = useCallback(() => {
    last.current = Date.now();
    setStalled(false);
  }, []);
  useEffect(() => {
    if (!active) {
      setStalled(false);
      return undefined;
    }
    last.current = Date.now();
    const timer = setInterval(() => setStalled(Date.now() - last.current >= ms), 500);
    return () => clearInterval(timer);
  }, [active, ms]);
  return { stalled, bump };
}
