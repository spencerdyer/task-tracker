/**
 * A WebSocket that reconnects on its own: waits grow 1 s, 2 s, 4 s … up to
 * 30 s, each with jitter so a restarted server isn't hit by every tab at once.
 * After an abnormal close it asks `shouldRetry` first (the provider re-checks
 * sign-in there), so a refused or signed-out socket stops instead of retrying.
 */

export const RECONNECT_BASE_MS = 1000;
export const RECONNECT_CAP_MS = 30000;

/** Wait before retry number `attempt` (0-based): half the backoff plus up to half again. */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const backoff = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.round(backoff / 2 + random() * (backoff / 2));
}

export type SocketState = 'connecting' | 'open' | 'waiting' | 'stopped';

export interface SocketStatus {
  state: SocketState;
  /** Failed tries since the socket was last open */
  attempt: number;
  /** When the next try starts (epoch ms), while waiting */
  retryAt: number | null;
  /** Has been open at least once */
  everOpen: boolean;
}

export interface ReconnectingSocketOptions {
  url: () => string;
  /** reconnected: an open after a drop (or after failed first tries), not the first */
  onOpen?: (reconnected: boolean) => void;
  onMessage?: (event: MessageEvent) => void;
  onStatus?: (status: SocketStatus) => void;
  /** Called after each abnormal close; false stops retrying */
  shouldRetry?: (event: CloseEvent) => Promise<boolean> | boolean;
  createSocket?: (url: string) => WebSocket;
  random?: () => number;
}

export class ReconnectingSocket {
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private retryAt: number | null = null;
  private everOpen = false;
  private failedSinceOpen = false;
  private stopped = true;   // stop() was called (unmount, sign-out): never again
  private halted = false;   // gave up after a refused socket; retryNow() may try again
  private state: SocketState = 'stopped';

  constructor(private opts: ReconnectingSocketOptions) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.halted = false;
    this.connect();
  }

  /** Close for good (unmount, sign-out); no reconnect follows */
  stop() {
    this.stopped = true;
    this.clearTimer();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.setState('stopped');
  }

  /** Try now instead of waiting (Retry button, browser back online, tab shown again) */
  retryNow() {
    if (this.stopped || this.ws) return;
    this.halted = false;
    this.clearTimer();
    this.attempt = 0;
    this.connect();
  }

  send(data: string): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(data);
    return true;
  }

  get status(): SocketStatus {
    return { state: this.state, attempt: this.attempt, retryAt: this.retryAt, everOpen: this.everOpen };
  }

  private connect() {
    const make = this.opts.createSocket ?? ((u: string) => new WebSocket(u));
    const ws = make(this.opts.url());
    this.ws = ws;
    this.setState('connecting');
    ws.onopen = () => {
      if (this.ws !== ws) return;
      const reconnected = this.everOpen || this.failedSinceOpen;
      this.everOpen = true;
      this.failedSinceOpen = false;
      this.attempt = 0;
      this.setState('open');
      this.opts.onOpen?.(reconnected);
    };
    ws.onmessage = (event) => {
      if (this.ws === ws) this.opts.onMessage?.(event);
    };
    ws.onerror = () => ws.close();
    ws.onclose = (event) => {
      if (this.ws !== ws) return;  // replaced or stopped
      this.ws = null;
      this.failedSinceOpen = true;
      void this.afterClose(event);
    };
  }

  private async afterClose(event: CloseEvent) {
    this.setState('waiting');  // no retryAt yet: sign-in is being re-checked
    let retry = true;
    if (event.code !== 1000 && this.opts.shouldRetry) {
      try {
        retry = await this.opts.shouldRetry(event);
      } catch {
        retry = true;
      }
    }
    if (this.stopped || this.ws) return;  // stopped or retried meanwhile
    if (!retry) {
      this.halted = true;
      this.setState('stopped');
      return;
    }
    const delay = reconnectDelay(this.attempt, this.opts.random);
    this.attempt += 1;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped && !this.halted && !this.ws) this.connect();
    }, delay);
    this.retryAt = Date.now() + delay;
    this.setState('waiting');
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.retryAt = null;
  }

  private setState(state: SocketState) {
    this.state = state;
    if (state !== 'waiting' || !this.timer) this.retryAt = null;
    this.opts.onStatus?.(this.status);
  }
}
