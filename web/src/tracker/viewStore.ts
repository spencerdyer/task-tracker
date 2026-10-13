// Which projects the board shows at once, kept on the server so every tab and device follows it
// (event tracker_view_changed). Saves go one at a time; a reload that arrives while one is in flight
// waits for it, so the echo of our own save never brings back an older selection.
import { create } from 'zustand';
import { trackerApi } from './trackerApi';

interface ViewState {
  /** null until loaded or until the owner first picks (the widget then uses this tab's last pick) */
  projects: string[] | null;
  save: (keys: string[]) => Promise<void>;
  reload: () => Promise<void>;
}

const saves = { chain: Promise.resolve() as Promise<unknown>, pending: 0, reloadWanted: false };
const clean = (raw: unknown): string[] | null =>
  Array.isArray(raw) && raw.length ? raw.filter((k): k is string => typeof k === 'string') : null;

export const useTrackerView = create<ViewState>((set, get) => ({
  projects: null,
  save: (keys) => {
    set({ projects: keys });
    saves.pending += 1;
    const saved = saves.chain.then(() => trackerApi.saveView(keys)).then(() => undefined);
    saves.chain = saved.catch(() => { saves.reloadWanted = true; }).finally(() => {
      saves.pending -= 1;
      if (saves.pending === 0 && saves.reloadWanted) {
        saves.reloadWanted = false;
        void get().reload();
      }
    });
    return saved;
  },
  reload: async () => {
    if (saves.pending > 0) { saves.reloadWanted = true; return; }
    try {
      const projects = clean(await trackerApi.view());
      if (saves.pending === 0) set({ projects });
      else saves.reloadWanted = true;
    } catch { /* keep what is shown; the next event or reconnect tries again */ }
  },
}));
