// Light or dark: the device's preference until the person picks one with the toggle, then their pick
// (remembered in this browser). The class goes on <html>, so menus portalled to <body> follow it too.
import { create } from 'zustand';

const KEY = 'task-tracker.theme';
type Choice = 'light' | 'dark' | null;

function stored(): Choice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

const deviceDark = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;

/** The theme to show for a choice and the device's preference. */
export const effectiveDark = (choice: Choice, device: boolean) => (choice ? choice === 'dark' : device);

function apply(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
}

interface ThemeState {
  choice: Choice;
  dark: boolean;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => {
  const choice = stored();
  const dark = effectiveDark(choice, deviceDark());
  if (typeof document !== 'undefined') apply(dark);
  if (typeof window !== 'undefined') {
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
      if (get().choice) return;  // a pick wins over the device
      apply(e.matches);
      set({ dark: e.matches });
    });
  }
  return {
    choice,
    dark,
    toggle: () => {
      const next = !get().dark;
      try { localStorage.setItem(KEY, next ? 'dark' : 'light'); } catch { /* private window: this visit only */ }
      apply(next);
      set({ choice: next ? 'dark' : 'light', dark: next });
    },
  };
});
