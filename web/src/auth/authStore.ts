// Where the app is with sign-in: checking, first run, signed out, signed in, or the server out of reach.
import axios from 'axios';
import { create } from 'zustand';
import { setSignedOutHandler } from '../lib/http';
import { authApi } from './authApi';
import { Screen, screenFor, signInError } from './authLogic';

interface AuthState {
  screen: Screen;
  /** Shown on the sign-in screen: why it is there (a session that ended) */
  notice: string | null;
  /** Ask the server. `quiet`: while the tracker is open, a server that doesn't answer leaves it open */
  check: (quiet?: boolean) => Promise<Screen>;
  signIn: (password: string) => Promise<string | null>;
  setup: (password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  /** A request was refused for want of a session */
  lost: () => void;
}

const failure = (e: unknown) => {
  const res = axios.isAxiosError(e) ? e.response : undefined;
  return signInError(res?.status, (res?.data as { detail?: unknown } | undefined)?.detail);
};

export const useAuth = create<AuthState>((set, get) => ({
  screen: 'checking',
  notice: null,
  check: async (quiet = false) => {
    const was = get().screen;
    try {
      const screen = screenFor(await authApi.status());
      set(was === 'app' && screen === 'signIn' ? { screen, notice: 'Your session ended. Sign in again.' } : { screen });
      return screen;
    } catch {
      if (!(quiet && was === 'app')) set({ screen: 'unreachable' });
      return 'unreachable';
    }
  },
  signIn: async (password) => {
    try {
      await authApi.login(password);
      set({ screen: 'app', notice: null });
      return null;
    } catch (e) {
      return failure(e);
    }
  },
  setup: async (password) => {
    try {
      await authApi.setup(password);
      set({ screen: 'app', notice: null });
      return null;
    } catch (e) {
      return failure(e);
    }
  },
  signOut: async () => {
    try { await authApi.logout(); } catch { /* signed out here either way */ }
    set({ screen: 'signIn', notice: null });
  },
  lost: () => {
    if (get().screen === 'app') set({ screen: 'signIn', notice: 'Your session ended. Sign in again.' });
  },
}));

setSignedOutHandler(() => useAuth.getState().lost());
