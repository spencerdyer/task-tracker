/**
 * The one HTTP client. Requests go to the page's own origin under /api and carry the session cookie the
 * server set at sign-in (httpOnly: the page never sees a token). Every POST carries an Idempotency-Key, so a
 * request the browser sends again after a dropped connection is answered from the server's memory instead of
 * being stored twice. A 401 from anything but the sign-in routes sends the app back to the sign-in screen.
 */
import axios from 'axios';

export const http = axios.create({ withCredentials: true });

/** Routes that answer 401 as part of signing in; a 401 there isn't a lost session. */
const AUTH_ROUTES = ['/api/auth/status', '/api/auth/login', '/api/auth/setup', '/api/auth/password'];

let onSignedOut: () => void = () => {};
/** Called on a 401 outside the sign-in routes (the auth store registers itself here). */
export function setSignedOutHandler(fn: () => void) { onSignedOut = fn; }

export function idempotencyKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

http.interceptors.request.use((config) => {
  if ((config.method || 'get').toLowerCase() === 'post') {
    const headers = config.headers as unknown as Record<string, unknown>;
    if (headers && !headers['Idempotency-Key']) headers['Idempotency-Key'] = idempotencyKey();
  }
  return config;
});

const GENERIC = /^(internal server error|service unavailable|bad gateway|gateway time-?out|not found|forbidden)$/i;

/** A plain sentence for an error the server didn't explain. */
export function plainErrorText(status: number | undefined): string {
  if (status === undefined) return 'Couldn’t reach the server. Check the connection and try again.';
  if (status === 404) return 'That isn’t there any more. It may have been deleted elsewhere.';
  if (status === 403) return 'You don’t have access to that.';
  if (status === 502 || status === 503 || status === 504) return 'The server is busy or restarting. Try again in a moment.';
  if (status >= 500) return 'Something went wrong on the server. Try again; if it keeps happening, the server log says more.';
  return 'That didn’t work. Try again.';
}

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && !axios.isCancel(error)) {
      const res = error.response;
      const url = error.config?.url ?? '';
      if (res?.status === 401 && !AUTH_ROUTES.some((r) => url.startsWith(r))) onSignedOut();
      // A detail written for people is kept; a bare status name or an HTML error page becomes a sentence
      const data = res?.data as { detail?: unknown } | string | undefined;
      const detail = data && typeof data === 'object' ? data.detail : undefined;
      const useless = typeof detail !== 'string' || !detail.trim() || GENERIC.test(detail.trim()) || detail.trim().startsWith('<');
      if (!useless) error.message = detail as string;
      else if (!res || res.status >= 500 || res.status === 404 || res.status === 403) {
        const text = plainErrorText(res?.status);
        if (res && data && typeof data === 'object') data.detail = text;
        else if (res) (res as { data: unknown }).data = { detail: text };
        error.message = text;
      }
    }
    return Promise.reject(error);
  },
);

/**
 * One Idempotency-Key per draft. The key per request (above) covers the browser's own re-send; this covers
 * the person's: after a lost answer the page says it failed and they press Send again. `for(...)` returns the
 * same key while what is sent is unchanged, so the server answers the repeat from memory instead of storing it
 * twice; a changed draft gets a new key. Call `done()` once the send succeeded, so the next message, even with
 * the same text, is a new one.
 */
export class DraftKey {
  private sig: string | null = null;
  private key = '';

  for(...parts: unknown[]): string {
    const sig = JSON.stringify(parts);
    if (sig !== this.sig) {
      this.sig = sig;
      this.key = idempotencyKey();
    }
    return this.key;
  }

  done(): void {
    this.sig = null;
  }
}

/** Files in a draft, as far as its key is concerned. */
export const fileSig = (files: File[]) => files.map((f) => [f.name, f.size, f.lastModified]);
