// Several tracker projects at once, the merge rules.
import {
  columnOrder, dropRank, mergeQuestions, mergeWaiting, projectOf, resolveSelection, sumCounts, tagResources, toggleProject,
} from '../trackerSelection';
import type { Project, Question, TicketSummary, WaitingOnYou } from '../trackerApi';

const P = (key: string, awaiting = 0, counts = {}): Project => ({ key, name: key, description: '', counts, awaiting_review: awaiting });
const T = (key: string, rank: number): TicketSummary => ({ key, rank } as unknown as TicketSummary);

test('the saved selection, else today\'s single pick', () => {
  const projects = [P('LIGHT', 1), P('DEMO', 5), P('QA')];
  expect(resolveSelection(['DEMO', 'ZZ', 'LIGHT', 'DEMO'], projects, 'QA')).toEqual(['DEMO', 'LIGHT']);
  expect(resolveSelection(null, projects, 'QA')).toEqual(['QA']);           // this tab's stored project
  expect(resolveSelection([], projects, 'GONE')).toEqual(['DEMO']);           // most waiting for review
  expect(resolveSelection(null, [], null)).toEqual([]);
});

test('switching projects on and off keeps the list\'s order and never empties', () => {
  const order = ['LIGHT', 'DEMO', 'QA'];
  expect(toggleProject(['QA'], 'LIGHT', order)).toEqual(['LIGHT', 'QA']);
  expect(toggleProject(['LIGHT', 'QA'], 'LIGHT', order)).toEqual(['QA']);
  expect(toggleProject(['QA'], 'QA', order)).toEqual(['QA']);
});

test('a column groups by project, then each project\'s rank', () => {
  const got = columnOrder([T('DEMO-1', 1), T('LIGHT-9', 5), T('DEMO-2', 0.5), T('LIGHT-3', 2)], ['LIGHT', 'DEMO']).map((t) => t.key);
  expect(got).toEqual(['LIGHT-3', 'LIGHT-9', 'DEMO-2', 'DEMO-1']);
  expect(projectOf('DEMO-12')).toBe('DEMO');
});

test('a dropped card takes its rank from its own project\'s neighbours only', () => {
  const cards = [{ key: 'LIGHT-1', rank: 1 }, { key: 'LIGHT-2', rank: 3 }, { key: 'DEMO-1', rank: 100 }, { key: 'DEMO-2', rank: 200 }];
  expect(dropRank('LIGHT-7', cards, 1)).toBe(2);          // between LIGHT-1 and LIGHT-2
  expect(dropRank('LIGHT-7', cards, 4)).toBe(4);          // after LIGHT-2, the DEMO cards don't count
  expect(dropRank('DEMO-9', cards, 0)).toBe(99.5);       // before DEMO-1 (half way to one less)
  expect(dropRank('DEMO-9', cards, 3)).toBe(150);
  expect(dropRank('QA-1', cards, 2)).toBe(1);          // a project with nothing in the column
});

test('counts add up over the selection', () => {
  expect(sumCounts([P('LIGHT', 0, { todo: 2, uat: 1 }), P('DEMO', 0, { todo: 3 }), P('QA', 0, { todo: 9 })], ['LIGHT', 'DEMO']))
    .toEqual({ todo: 5, uat: 1 });
});

test('Waiting on you and Questions merge in each list\'s own order', () => {
  const q = (id: number, waiting_since: number, answered_at: number | null = null, closed_at: number | null = null) =>
    ({ id, waiting_since, answered_at, closed_at } as unknown as Question);
  const w = (count: number, asked: Question[], since: number[]): WaitingOnYou => ({
    count, asked, unasked: [],
    review: since.map((s) => ({ key: `X-${s}`, title: '', owner: '', priority: 'P2', since: s, waiting_hours: 0 })),
  });
  const m = mergeWaiting([w(2, [q(1, 50)], [30]), w(3, [q(2, 10)], [10, 40])]);
  expect(m.count).toBe(5);
  expect(m.asked!.map((x) => x.id)).toEqual([2, 1]);
  expect(m.review.map((r) => r.since)).toEqual([10, 30, 40]);
  expect(mergeQuestions([[q(1, 5, 9)], [q(2, 1, 20)]], 'answered').map((x) => x.id)).toEqual([2, 1]);
  expect(mergeQuestions([[q(1, 5)], [q(2, 1)]], 'open').map((x) => x.id)).toEqual([2, 1]);
});

test('machines keep their project, so equal keys stay apart', () => {
  const r = (key: string) => ({ key, name: key, description: '', busy: false, holders: [] });
  expect(tagResources({ LIGHT: [r('gpu')], DEMO: [r('gpu')] }, ['DEMO', 'LIGHT']).map((x) => `${x.project}:${x.key}`)).toEqual(['DEMO:gpu', 'LIGHT:gpu']);
});
