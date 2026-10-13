// Plain rules for the sign-in screens, kept apart from React so they can be tested on their own.
import type { AuthStatus } from './authApi';

export type Screen = 'checking' | 'setup' | 'signIn' | 'app' | 'unreachable';

/** Which screen the server's answer calls for. */
export function screenFor(status: AuthStatus): Screen {
  if (status.setup_needed) return 'setup';
  return status.signed_in ? 'app' : 'signIn';
}

/** The shortest owner password the first-run screen accepts (the server may ask for more). */
export const MIN_PASSWORD = 8;

/** What's wrong with a new password and its confirmation, or null when it can be sent. */
export function newPasswordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password !== confirm) return 'The two passwords aren’t the same.';
  return null;
}

/** A sentence for a failed sign-in, from the HTTP status and the server's own words. */
export function signInError(status: number | undefined, detail: unknown): string {
  if (status === 401 || status === 403) return 'That password isn’t right.';
  if (status === 429) return typeof detail === 'string' && detail ? detail : 'Too many tries. Wait a moment, then try again.';
  if (typeof detail === 'string' && detail) return detail;
  return status === undefined ? 'Couldn’t reach the server. Check the connection and try again.' : 'Signing in didn’t work. Try again.';
}
