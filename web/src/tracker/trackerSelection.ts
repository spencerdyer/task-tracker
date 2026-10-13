// Several Tracker projects at once: which projects a viewer shows, and how the per-project lists the
// server gives are merged into one board. Pure functions; the widget fetches each selected project and merges.
import type { Project, Question, Resource, Status, TicketSummary, WaitingOnYou } from './trackerApi';

/** The project a ticket key belongs to: its prefix (LIGHT-12 → LIGHT). */
export const projectOf = (key: string) => key.split('-')[0];

/** The selection to show: the saved one's keys that still exist, in order; else the fallback (today's single pick). */
export function resolveSelection(saved: string[] | null | undefined, projects: Project[], fallback: string | null): string[] {
  const have = new Set(projects.map((p) => p.key));
  const kept = (saved ?? []).filter((k, i, a) => have.has(k) && a.indexOf(k) === i);
  if (kept.length) return kept;
  if (fallback && have.has(fallback)) return [fallback];
  const busiest = [...projects].sort((a, b) => b.awaiting_review - a.awaiting_review)[0];
  return busiest ? [busiest.key] : [];
}

/** A project switched on or off; the last one never goes (an empty board shows nothing to switch back from). */
export function toggleProject(selected: string[], key: string, order: string[]): string[] {
  if (selected.includes(key)) return selected.length > 1 ? selected.filter((k) => k !== key) : selected;
  const next = [...selected, key];
  return order.filter((k) => next.includes(k));   // the projects list's order, so the board doesn't reshuffle
}

/** One column's tickets: grouped by project in selection order, each project's by its own rank. */
export function columnOrder(tickets: TicketSummary[], selected: string[]): TicketSummary[] {
  const at = (t: TicketSummary) => { const i = selected.indexOf(projectOf(t.key)); return i < 0 ? selected.length : i; };
  return [...tickets].sort((a, b) => at(a) - at(b) || a.rank - b.rank);
}

/** The rank a card dropped at `index` among a column's cards takes. Ranks are per project, so only the cards of
 *  its own project count: the nearest one above and below it. */
export function dropRank(dragged: string, cards: { key: string; rank: number }[], index: number): number {
  const mine = projectOf(dragged);
  const above = cards.slice(0, index).filter((c) => projectOf(c.key) === mine && c.key !== dragged);
  const below = cards.slice(index).filter((c) => projectOf(c.key) === mine && c.key !== dragged);
  const before = above.length ? above[above.length - 1].rank : (below[0]?.rank ?? 1) - 1;
  const after = below.length ? below[0].rank : before + 2;
  return (before + after) / 2;
}

/** Per-stage counts over the selected projects. */
export function sumCounts(projects: Project[], selected: string[]): Partial<Record<Status, number>> {
  const out: Partial<Record<Status, number>> = {};
  for (const p of projects) if (selected.includes(p.key))
    for (const [s, n] of Object.entries(p.counts)) out[s as Status] = (out[s as Status] ?? 0) + (n ?? 0);
  return out;
}

/** 'Waiting on you' over several projects: each list merged and ordered as one project's is. */
export function mergeWaiting(list: WaitingOnYou[]): WaitingOnYou {
  return {
    count: list.reduce((n, w) => n + w.count, 0),
    asked: list.flatMap((w) => w.asked ?? []).sort((a, b) => a.waiting_since - b.waiting_since),
    review: list.flatMap((w) => w.review).sort((a, b) => a.since - b.since),   // oldest first
    unasked: list.flatMap((w) => w.unasked ?? []),
  };
}

/** The Questions view's lists over several projects: open waiting longest first, answered and closed newest first. */
export function mergeQuestions(list: Question[][], status: 'open' | 'answered' | 'closed'): Question[] {
  const all = list.flat();
  if (status === 'open') return all.sort((a, b) => a.waiting_since - b.waiting_since);
  if (status === 'answered') return all.sort((a, b) => (b.answered_at ?? 0) - (a.answered_at ?? 0));
  return all.sort((a, b) => (b.closed_at ?? 0) - (a.closed_at ?? 0));
}

/** Machines are per project (their keys can repeat across projects): each tagged with its project. */
export type ProjectResource = Resource & { project: string };
export function tagResources(byProject: Record<string, Resource[]>, selected: string[]): ProjectResource[] {
  return selected.flatMap((p) => (byProject[p] ?? []).map((r) => ({ ...r, project: p })));
}
