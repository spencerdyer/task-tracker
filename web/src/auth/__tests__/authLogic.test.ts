import { MIN_PASSWORD, newPasswordProblem, screenFor, signInError } from '../authLogic';

describe('sign-in rules', () => {
  it('shows first run, sign-in or the tracker from the server’s answer', () => {
    expect(screenFor({ setup_needed: true, signed_in: false })).toBe('setup');
    expect(screenFor({ setup_needed: false, signed_in: false })).toBe('signIn');
    expect(screenFor({ setup_needed: false, signed_in: true })).toBe('app');
  });

  it('checks a new password and its confirmation', () => {
    expect(newPasswordProblem('short', 'short')).toMatch(`at least ${MIN_PASSWORD}`);
    expect(newPasswordProblem('long enough', 'long enougH')).toMatch(/aren’t the same/);
    expect(newPasswordProblem('long enough', 'long enough')).toBeNull();
  });

  it('says why a sign-in failed', () => {
    expect(signInError(401, 'Unauthorized')).toBe('That password isn’t right.');
    expect(signInError(429, 'Wait 4 s before trying again.')).toBe('Wait 4 s before trying again.');
    expect(signInError(429, undefined)).toMatch(/Too many tries/);
    expect(signInError(undefined, undefined)).toMatch(/Couldn’t reach the server/);
    expect(signInError(500, 'The database is locked.')).toBe('The database is locked.');
  });
});
