// The tracker: the owner's projects as a board, tickets with their history, the owner's review (only the
// signed-in owner approves), the agents and their questions, the project chat, and the project access tokens
// agents use. Narrow screens get a list with a stage switcher.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, Cpu, FolderKanban, Inbox, KeyRound, Lock, MoreHorizontal, Paperclip, Plus, RefreshCw, type LucideIcon } from 'lucide-react';
import {
  Button, EmptyState, IconButton, Menu, MenuButton, NARROW_PANEL, SearchField, SegmentedControl, Select, Spinner,
  useContainerWidth, useToast,
} from '../ui';
import type { MenuItem } from '../ui';
import { useSyncEvent } from '../live/LiveProvider';
import { useTrackerView } from './viewStore';
import { showTicketInAddress, ticketFromHash } from './ticketLink';
import {
  AgentsOverview, Project, Resource, Status, STATUSES, TicketSummary, WaitingOnYou as Waiting, errorText, trackerApi,
} from './trackerApi';
import AgentsView from './AgentsView';
import WaitingOnYou from './WaitingOnYou';
import TrackerChat from './TrackerChat';
import MachinesDialog from './MachinesDialog';
import TicketDialog from './TicketDialog';
import ReviewMode from './ReviewMode';
import QuestionsView from './QuestionsView';
import QuestionDialog from './QuestionDialog';
import TicketEditor from './TicketEditor';
import AccessDialog from './AccessDialog';
import NewProjectDialog from './NewProjectDialog';
import {
  columnOrder, dropRank, mergeWaiting, projectOf, resolveSelection, sumCounts, tagResources, toggleProject,
} from './trackerSelection';

const PROJECT_KEY = 'task-tracker.project';  // this tab's last single pick: the selection until the owner saves one
const DONE_SHOWN = 8;
// Owner filter value for tickets nobody has claimed yet
const UNCLAIMED = '__unclaimed__';
// Five columns need about this much room (~190 px each; at 900 the owner was one letter and
// 'Review' an R); below it the board becomes a list with a stage switcher
const BOARD_MIN = 1040;
const CHAT_WIDTH = 380;  // the chat beside the Agents view
const CHAT_BESIDE = 760;  // narrower: Agents and Chat take turns
const WAITING_OPEN = 'task-tracker.waitingOpen';  // the board's 'Waiting on you' strip, open or closed

function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStored(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private window */ }
}

export function PriorityTag({ priority }: { priority: string }) {
  const tone = priority === 'P0' ? 'bg-nb-danger text-[var(--nb-danger-fg)]'
    : priority === 'P1' ? 'bg-nb-accent-soft text-nb-accent-text'
    : priority === 'P2' ? 'bg-nb-surface text-nb-text-2'
    : 'border border-nb-border text-nb-text-3';
  return <span className={`shrink-0 px-1.5 py-px rounded-sm text-[11px] font-semibold ${tone}`}>{priority}</span>;
}

function Tag({ children, tone = 'plain', title }: { children: React.ReactNode; tone?: 'plain' | 'warn' | 'danger' | 'accent'; title?: string }) {
  const cls = tone === 'warn' ? 'bg-nb-warning-soft text-nb-warning border-transparent'
    : tone === 'danger' ? 'bg-nb-danger-soft text-nb-danger-text border-transparent'
    : tone === 'accent' ? 'bg-nb-accent-soft text-nb-accent-text border-transparent'
    : 'bg-nb-surface text-nb-text-2 border-nb-border';
  return (
    // max-w-full + truncate: a long chip ('Waiting for Local model (BUSY-200, …)') stays inside the card
    <span title={title} className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-full border text-[11.5px] whitespace-nowrap max-w-full min-w-0 overflow-hidden ${cls}`}>{children}</span>
  );
}

function TicketCard({ t, blocked, machineNames, projectName, onOpen, onDragStart, onContextMenu }: {
  t: TicketSummary;
  /** With several projects shown: whose ticket this is, on the key */
  projectName?: string;
  blocked: string[];
  machineNames: Record<string, string>;
  onOpen: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const checks = t.counts.verification ?? 0;
  return (
    <button
      type="button"
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      data-ticket={t.key}
      className="flex flex-col gap-1.5 w-full text-left px-3 py-2.5 rounded-[10px] bg-nb-raised border border-nb-border hover:border-nb-border-strong focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-nb-accent cursor-pointer"
    >
      <span className="flex items-center gap-2 min-w-0 text-xs text-nb-text-2">
        {/* sr-only words keep the spoken name in the card's own order with pauses: it read
            "DEMO-3builderP2Synthetic ticket 21" */}
        <span className="font-mono text-[11.5px] text-nb-accent-text shrink-0" title={projectName ? `${t.key} in ${projectName}` : undefined}>{t.key}</span>
        {t.owner && (
          <span className="inline-flex items-center gap-1 min-w-0" title={`Owner: ${t.owner}`}>
            <Bot size={12} strokeWidth={1.75} className="shrink-0" aria-hidden />
            <span className="sr-only">, owner </span><span className="truncate">{t.owner}</span>
          </span>
        )}
        <span className="flex-1" />
        <span className="sr-only">, </span><PriorityTag priority={t.priority} /><span className="sr-only">: </span>
      </span>
      {/* Three lines at most; the whole title is in the tooltip and the ticket */}
      <span className="text-[13.5px] leading-snug font-medium text-nb-text wrap-break-word line-clamp-3" title={t.title}>{t.title}</span>
      <span className="flex flex-wrap gap-1">
        {blocked.length > 0 && <Tag tone="warn" title={`Waiting on ${blocked.join(', ')}`}>blocked by {blocked.length}</Tag>}
        {(t.waiting_for ?? []).map((w) => (
          <Tag key={`w-${w.resource}`} tone="warn" title={`${w.name} is busy with ${w.held_by.join(', ')}`}>
            <Cpu size={11} strokeWidth={2} aria-hidden className="shrink-0" /><span className="truncate">Waiting for {w.name} ({w.held_by.join(', ')})</span>
          </Tag>
        ))}
        {(t.resources ?? []).filter((r) => !(t.waiting_for ?? []).some((w) => w.resource === r)).map((r) => (
          <Tag key={`r-${r}`} title="Needs this machine"><Cpu size={11} strokeWidth={2} aria-hidden />{machineNames[r] ?? r}</Tag>
        ))}
        {t.reopened ? <Tag tone="danger">sent back</Tag> : null}
        {t.attention && !t.reopened ? <Tag tone="accent" title="You've said something the owner hasn't answered yet">you replied</Tag> : null}
        {checks > 0 && <Tag title="Verification records"><Check size={11} strokeWidth={2} aria-hidden /><span className="sr-only">, </span>{checks}<span className="sr-only"> {checks === 1 ? 'verification record' : 'verification records'}</span></Tag>}
        {t.attachments > 0 && <Tag title="Attachments"><Paperclip size={11} strokeWidth={2} aria-hidden /><span className="sr-only">, </span>{t.attachments}<span className="sr-only"> {t.attachments === 1 ? 'attachment' : 'attachments'}</span></Tag>}
        {t.labels.map((l) => <Tag key={l}>{l}</Tag>)}
      </span>
    </button>
  );
}

export default function TrackerWidget({ appBar }: {
  /** The app's own bar (name, theme, account), drawn above the tracker's header inside its root, so dialogs cover it too */
  appBar?: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(rootRef);
  const narrow = width > 0 && width < NARROW_PANEL;  // dialogs become sheets
  const listMode = width > 0 && width < BOARD_MIN;
  const toast = useToast();

  const [projects, setProjects] = useState<Project[] | null>(null);
  // The projects shown: the owner's saved selection, else this tab's last single pick
  const savedSelection = useTrackerView((s) => s.projects);
  const saveSelection = useTrackerView((s) => s.save);
  const reloadSelection = useTrackerView((s) => s.reload);
  const [fallbackKey, setFallbackKey] = useState<string | null>(() => readStored(PROJECT_KEY));
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [owner, setOwner] = useState('');
  const [label, setLabel] = useState('');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [stage, setStage] = useState<Status>('uat');
  const [showAllDone, setShowAllDone] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** Closing a ticket puts focus back on its card; an approved ticket's card has left the review list (and
   * Review next opened others), so focus went to the page: then the first card in view takes it */
  const closeTicket = (key: string) => {
    setOpenKey(null);
    requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root || root.querySelector('[role="dialog"]')) return;  // another dialog took over
      if ((document.activeElement as HTMLElement | null)?.dataset?.ticket) return;  // already on a card
      const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-ticket]'));
      (cards.find((c) => c.dataset.ticket === key) ?? cards[0])?.focus();
    });
  };
  const [editor, setEditor] = useState<{ ticketKey?: string; projectKey: string } | null>(null);
  const [access, setAccess] = useState<string | null>(null);  // the project whose tokens are open
  const [newProject, setNewProject] = useState(false);
  const [resourcesBy, setResourcesBy] = useState<Record<string, Resource[]>>({});  // machines are per project
  const [machines, setMachines] = useState<string | null>(null);  // the project whose machines are open
  const [view, setView] = useState<'board' | 'agents' | 'questions'>('board');
  const [openQuestion, setOpenQuestion] = useState<number | null>(null);  // the question open in its dialog
  const [agents, setAgents] = useState<AgentsOverview | null>(null);
  const [unreadBy, setUnreadBy] = useState<Record<string, number>>({});  // agents' chat messages you haven't seen, per project
  const [chatProject, setChatProject] = useState<string | null>(null);  // the chat and agents shown (one project at a time)
  const [agentsPane, setAgentsPane] = useState<'overview' | 'chat'>('overview');  // narrow: one at a time
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [waitingOpen, setWaitingOpen] = useState(() => readStored(WAITING_OPEN) === '1');
  const [dropTarget, setDropTarget] = useState<Status | null>(null);
  const [cardMenu, setCardMenu] = useState<{ t: TicketSummary; at: { x: number; y: number } } | null>(null);
  const dragKey = useRef<string | null>(null);

  const selected = useMemo(() => (projects ? resolveSelection(savedSelection, projects, fallbackKey) : []), [projects, savedSelection, fallbackKey]);
  const selectedKey = selected.join(',');
  const multi = selected.length > 1;
  const projectNames = useMemo(() => Object.fromEntries((projects ?? []).map((p) => [p.key, p.name])), [projects]);
  // The first project shown: the whole view when it's the only one (today's single-project board)
  const project = projects?.find((p) => p.key === selected[0]) ?? null;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  /** Show these projects: saved on the server (other tabs and devices follow), the first kept for this tab. */
  const choose = useCallback((keys: string[]) => {
    if (!keys.length) return;
    writeStored(PROJECT_KEY, keys[0]);
    setFallbackKey(keys[0]);
    saveSelection(keys).catch(() => toast.show('Could not save which projects are shown', { tone: 'error' }));
  }, [saveSelection, toast]);
  /** Show this project too, or only it when it isn't shown (a ticket link, a new project). */
  const reveal = useCallback((key: string) => { if (!selectedRef.current.includes(key)) choose([key]); }, [choose]);
  useSyncEvent('tracker_view_changed', () => { void reloadSelection(); });
  // The chat and the agents overview stay per project: the one chosen in the chat, while it's shown
  const talkKey = chatProject && selected.includes(chatProject) ? chatProject : selected[0] ?? null;
  const talkRef = useRef(talkKey);
  talkRef.current = talkKey;
  const chatUnread = selected.reduce((n, k) => n + (unreadBy[k] ?? 0), 0);

  const loadProjects = useCallback(async () => {
    try {
      setProjects(await trackerApi.projects());
    } catch (e) {
      setLoadError(errorText(e, 'Could not load projects'));
    }
  }, []);

  const viewRef = useRef(view);
  viewRef.current = view;
  // What waits on you, over the projects shown (merged in each list's own order)
  const loadWaiting = useCallback(() => {
    const keys = selectedRef.current;
    if (!keys.length) return;
    Promise.all(keys.map((k) => trackerApi.waitingOnYou(k))).then((ws) => {
      if (selectedRef.current.join(',') === keys.join(',')) setWaiting(ws.length === 1 ? ws[0] : mergeWaiting(ws));
    }).catch(() => {});
  }, []);
  const loadAgents = useCallback(() => {
    const key = talkRef.current;
    if (key) trackerApi.agents(key).then((a) => { if (talkRef.current === key) setAgents(a); }).catch(() => {});
  }, []);
  const loadTickets = useCallback(async () => {
    const keys = selectedRef.current;
    if (!keys.length) return;
    try {
      const parts = await Promise.all(keys.map((k) => Promise.all([trackerApi.tickets(k), trackerApi.resources(k).catch(() => [] as Resource[])])));
      if (selectedRef.current.join(',') !== keys.join(',')) return;  // the selection moved on meanwhile
      setTickets(parts.flatMap(([list]) => list));
      setResourcesBy(Object.fromEntries(keys.map((k, i) => [k, parts[i][1]])));
      setLoadError(null);
      if (viewRef.current === 'agents') loadAgents();
      loadWaiting();
    } catch (e) {
      setLoadError(errorText(e, 'Could not load tickets'));
    }
  }, [loadAgents, loadWaiting]);

  useEffect(() => { loadProjects(); void reloadSelection(); }, [loadProjects, reloadSelection]);
  // The Agents view loads its own overview; live updates refresh it through loadTickets
  useEffect(() => {
    if (view !== 'agents' || !talkKey) return;
    setAgents(null);
    trackerApi.agents(talkKey).then((a) => { if (talkRef.current === talkKey) setAgents(a); })
      .catch((e) => toast.show(errorText(e, 'Could not load agents'), { tone: 'error' }));
  }, [view, talkKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A link to a ticket (#ticket=KEY, on load or pasted later): its project (shown if it isn't), then the ticket
  // Followed once when the projects arrive and on each real hashchange only: `reveal` is a new function on
  // every render, so with it in the dependencies a closed ticket was reopened from the address at once.
  const haveProjects = projects !== null;
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  useEffect(() => {
    if (!haveProjects) return;
    const follow = () => {
      const key = ticketFromHash(window.location.hash);
      if (!key) return;
      revealRef.current(projectOf(key));
      setOpenKey(key);
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, [haveProjects]);
  // The open ticket is in the address, so it can be shared and survives a reload
  const lastOpen = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (lastOpen.current !== undefined && lastOpen.current !== openKey) showTicketInAddress(openKey);
    lastOpen.current = openKey;
  }, [openKey]);
  useEffect(() => {
    if (!selectedKey) return;
    setTickets(null);
    setWaiting(null);
    setOwner(''); setLabel('');
    loadTickets();
  }, [selectedKey, loadTickets]);

  // Agents and other devices change the board: follow along
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>();
  const onChanged = useCallback((event: { data?: Record<string, any> }) => {
    const data = event?.data;
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      loadProjects();
      if (!data?.project || selectedRef.current.includes(data.project)) loadTickets();
    }, 250);
  }, [loadProjects, loadTickets]);
  useSyncEvent('tracker_changed', onChanged);
  // The chat's unread counts, per project shown: the Agents tab's badge adds them up
  const loadUnread = useCallback(() => {
    const keys = selectedRef.current;
    Promise.all(keys.map((k) => trackerApi.chatUnread(k).then((r) => [k, r.count] as const)))
      .then((pairs) => setUnreadBy((cur) => ({ ...cur, ...Object.fromEntries(pairs) }))).catch(() => {});
  }, []);
  useEffect(() => { loadUnread(); }, [selectedKey, loadUnread]);
  const onChat = useCallback((event: { data?: Record<string, any> }) => {
    const data = event?.data;
    if (!data?.project || !selectedRef.current.includes(data.project)) return;
    if (data.kind !== 'read' || data.for === 'user') loadUnread();
    // A question asked or answered in the chat changes what waits on the owner
    if (data.kind === 'message') loadWaiting();
  }, [loadUnread, loadWaiting]);
  useSyncEvent('tracker_chat', onChat);
  // An agent asks, or a question is answered or closed: what waits on the owner changes
  const onQuestion = useCallback((event: { data?: Record<string, any> }) => {
    if (!event?.data?.project || selectedRef.current.includes(event.data.project)) loadWaiting();
  }, [loadWaiting]);
  useSyncEvent('tracker_question', onQuestion);
  useSyncEvent('sync_reconnected', () => loadUnread());
  useSyncEvent('sync_reconnected', onChanged);
  // A ticket reached review: the board and 'Waiting on you' change
  useSyncEvent('tracker_review_ready', onChanged);
  useSyncEvent('sync_reconnected', () => { void reloadSelection(); });
  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  const byKey = useMemo(() => new Map((tickets ?? []).map((t) => [t.key, t])), [tickets]);
  // A finished ticket isn't waiting on anything any more, whatever its dependencies say
  const blockedBy = useCallback((t: TicketSummary) => t.status === 'done' ? [] : t.depends_on.filter((k) => {
    const dep = byKey.get(k);
    return dep && dep.status !== 'done';
  }), [byKey]);

  // Machines are per project (the same key can name two machines): each ticket reads its own project's
  const namesBy = useMemo(() => Object.fromEntries(Object.entries(resourcesBy).map(([k, rs]) => [k, Object.fromEntries(rs.map((r) => [r.key, r.name]))])), [resourcesBy]);
  const machineNamesOf = useCallback((key: string | null | undefined): Record<string, string> => (key ? namesBy[projectOf(key)] ?? {} : {}), [namesBy]);
  const machineNames = talkKey ? namesBy[talkKey] ?? {} : {};
  const strip = useMemo(() => tagResources(resourcesBy, selected), [resourcesBy, selectedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => (projects ? sumCounts(projects, selected) : {}), [projects, selectedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const owners = useMemo(() => Array.from(new Set((tickets ?? []).map((t) => t.owner).filter(Boolean))).sort(), [tickets]);
  const agentNames = useMemo(() => Array.from(new Set([...(agents?.agents ?? []).map((a) => a.name), ...owners]))
    .filter((n) => n && n !== 'user').sort(), [agents, owners]);
  const asked = waiting?.asked?.length ?? 0;
  const viewOptions = useMemo(() => [
    { value: 'board' as const, label: 'Board' },
    // 'Agents · 3' read as three agents; it's the chat's unread count
    { value: 'agents' as const, label: chatUnread ? `Agents · ${chatUnread} new` : 'Agents', hint: chatUnread ? `${chatUnread} unread in the chat` : undefined },
    // Agents' questions waiting for your answer
    { value: 'questions' as const, label: asked ? `Questions · ${asked}` : 'Questions', hint: asked ? `${asked} waiting for your answer` : undefined },
  ], [chatUnread, asked]);
  const chatBeside = width >= CHAT_BESIDE;
  const labels = useMemo(() => Array.from(new Set((tickets ?? []).flatMap((t) => t.labels))).sort(), [tickets]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (tickets ?? []).filter((t) => {
      if (reviewOnly && t.status !== 'uat') return false;
      if (owner === UNCLAIMED ? !!t.owner : owner && t.owner !== owner) return false;
      if (label && !t.labels.includes(label)) return false;
      if (q && !(`${t.key} ${t.title} ${t.owner} ${t.labels.join(' ')}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [tickets, query, owner, label, reviewOnly]);
  const columns = useMemo(() => STATUSES.map((s) => ({
    ...s,
    // Several projects: grouped by project in the order shown, each by its own rank
    tickets: columnOrder(visible.filter((t) => t.status === s.key), selected),
  })), [visible, selectedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const reviewCount = (tickets ?? []).filter((t) => t.status === 'uat').length;
  // The review column's order (filters included): the ticket dialog's 'Review next'
  const reviewQueue = useMemo(() => columns.find((c) => c.key === 'uat')?.tickets.map((t) => t.key) ?? [], [columns]);
  // Review mode: oldest first, as 'Waiting on you' lists them, then anything else in Review
  const reviewOrder = useMemo(() => {
    const oldest = (waiting?.review ?? []).map((r) => r.key).filter((k) => reviewQueue.includes(k));
    return [...oldest, ...reviewQueue.filter((k) => !oldest.includes(k))];
  }, [waiting, reviewQueue]);
  const [reviewing, setReviewing] = useState<string[] | null>(null);
  // With a search or filter on, the counts are of what's shown (not 'To do 116' over 'Nothing here')
  const filtering = !!(query.trim() || owner || label || reviewOnly);

  // ---- moving cards (drag on the board; the ticket dialog and card menu do the same)
  const moveTo = useCallback(async (t: TicketSummary, status: Status, rank?: number) => {
    if (t.status === 'uat' && status !== 'uat' && status !== 'done') {
      setOpenKey(t.key);  // sending back needs a note: the review bar asks for it
      toast.show('Say what must change in the review bar, then send it back.');
      return;
    }
    try {
      if (status === t.status) {
        if (rank !== undefined) await trackerApi.updateTicket(t.key, { rank });
      } else {
        await trackerApi.move(t.key, status, '', rank);
      }
      await loadTickets();
    } catch (e) {
      toast.show(errorText(e, 'Could not move the ticket'), { tone: 'error' });
    }
  }, [loadTickets, toast]);

  const onDrop = (status: Status, e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDropTarget(null);
    const key = dragKey.current;
    dragKey.current = null;
    const t = key ? byKey.get(key) : undefined;
    if (!t) return;
    const col = columns.find((c) => c.key === status);
    const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-card]')).filter((c) => c.dataset.card !== key);
    let index = cards.findIndex((c) => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
    if (index < 0) index = cards.length;
    if (!col) return;
    // Ranks are per project: only the dropped card's own project's neighbours count
    moveTo(t, status, dropRank(t.key, cards.map((c) => ({ key: c.dataset.card!, rank: byKey.get(c.dataset.card!)?.rank ?? 0 })), index));
  };

  const cardMenuItems = (t: TicketSummary): MenuItem[] => [
    { label: 'Open', onSelect: () => setOpenKey(t.key) },
    { label: 'Edit', onSelect: () => setEditor({ ticketKey: t.key, projectKey: projectOf(t.key) }) },
    'separator',
    ...STATUSES.filter((s) => s.key !== t.status).map((s) => ({
      label: s.key === 'done' ? 'Approve → Done' : `Move to ${s.name}`,
      onSelect: () => moveTo(t, s.key),
    })),
  ];

  // Each project switched on or off where you are; the menu stays open for the next
  const projectItems: MenuItem[] = [
    ...(projects ?? []).map((p) => ({
      label: `${p.key} · ${p.name}${p.awaiting_review ? ` (${p.awaiting_review} to review)` : ''}`,
      checked: selected.includes(p.key),
      keepOpen: true,
      onSelect: () => choose(toggleProject(selected, p.key, (projects ?? []).map((x) => x.key))),
    })),
    ...(projects && projects.length ? ['separator' as const] : []),
    { label: 'New project…', icon: Plus, onSelect: () => setNewProject(true) },
  ];

  // Something of one project (tokens, machines, a new ticket): with several shown, one item for each
  const perProject = (label: string, icon: LucideIcon, open: (key: string) => void): MenuItem[] =>
    multi ? selected.map((k) => ({ label: `${label} · ${k}`, icon, onSelect: () => open(k) }))
      : [{ label, icon, onSelect: () => { if (project) open(project.key); }, disabled: !project }];
  const moreItems: MenuItem[] = [
    ...perProject('Access tokens', KeyRound, setAccess),
    ...perProject('Machines…', Cpu, setMachines),
    { label: 'Refresh', icon: RefreshCw, onSelect: () => { loadProjects(); loadTickets(); } },
    { label: 'New project…', icon: Plus, onSelect: () => setNewProject(true) },
  ];
  const newTicketIn = (key: string) => setEditor({ projectKey: key });
  const newTicketItems = selected.map((k) => ({ label: `New ticket in ${k} · ${projectNames[k] ?? k}`, onSelect: () => newTicketIn(k) }));

  const selectOwner = (
    <Select label="Owner" size="sm" value={owner} onChange={(e) => setOwner(e.target.value)}
      options={[{ value: '', label: 'Owner: All' }, { value: UNCLAIMED, label: 'Unclaimed' }, ...owners.map((o) => ({ value: o, label: o }))]} />
  );
  const selectLabel = (
    <Select label="Label" size="sm" value={label} onChange={(e) => setLabel(e.target.value)}
      options={[{ value: '', label: 'Label: All' }, ...labels.map((l) => ({ value: l, label: l }))]} />
  );

  // ---- render
  const header = (
    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-nb-border bg-nb-sidebar flex-wrap">
      <MenuButton items={projectItems} label="Projects">
        {(props) => (
          <button {...props} type="button"
            className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-nb-border bg-nb-raised text-[13px] font-semibold text-nb-text hover:border-nb-border-strong min-w-0 ${listMode ? 'flex-1' : 'max-w-[260px]'}`}>
            {multi ? (
              <>
                <span className="font-mono text-xs font-normal text-nb-accent-text truncate min-w-0" title={selected.map((k) => projectNames[k] ?? k).join(', ')}>{selected.join(' + ')}</span>
                <span className="shrink-0">{selected.length} projects</span>
              </>
            ) : project ? (
              <>
                <span className="font-mono text-xs font-normal text-nb-accent-text shrink-0">{project.key}</span>
                <span className="truncate" title={project.name}>{project.name}</span>
              </>
            ) : <span className="truncate">Projects</span>}
            <ChevronDown size={14} strokeWidth={1.75} className="shrink-0 ml-auto" aria-hidden />
          </button>
        )}
      </MenuButton>
      {!listMode && (
        <>
          <SegmentedControl label="Tracker view" size="sm" value={view} onChange={setView}
            options={viewOptions} />
          {view === 'board' && (
            <>
          <SearchField value={query} onChange={setQuery} placeholder="Search tickets" className="w-[240px] min-w-[140px] shrink" />
          {selectOwner}
          {selectLabel}
          <button type="button" aria-pressed={reviewOnly} onClick={() => setReviewOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[13px] whitespace-nowrap ${reviewOnly ? 'border-nb-accent bg-nb-accent-soft text-nb-accent-text' : 'border-nb-border bg-nb-raised text-nb-text hover:border-nb-border-strong'}`}>
            Needs your review
            {reviewCount > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-nb-accent text-nb-accent-fg text-[11px] font-semibold inline-flex items-center justify-center">{reviewCount}</span>
            )}
          </button>
            </>
          )}
        </>
      )}
      {/* The actions wrap as one group, so More never ends up alone on a row */}
      <span className="flex items-center gap-2 ml-auto shrink-0">
        {!listMode && (multi ? (
          <>
            <MenuButton items={perProject('Access', KeyRound, setAccess)} label="Access">
              {(props) => <Button {...props} variant="secondary" icon={KeyRound}>Access</Button>}
            </MenuButton>
            <MenuButton items={newTicketItems} label="New ticket">
              {(props) => <Button {...props} variant="primary" icon={Plus}>New ticket</Button>}
            </MenuButton>
          </>
        ) : (
          <>
            <Button variant="secondary" icon={KeyRound} onClick={() => project && setAccess(project.key)} disabled={!project}>Access</Button>
            <Button variant="primary" icon={Plus} onClick={() => project && newTicketIn(project.key)} disabled={!project}>New ticket</Button>
          </>
        ))}
        {listMode && (
          multi ? (
            <MenuButton items={newTicketItems} label="New ticket">
              {(props) => <IconButton {...props} icon={Plus} label="New ticket" variant="accent" />}
            </MenuButton>
          ) : <IconButton icon={Plus} label="New ticket" variant="accent" onClick={() => project && newTicketIn(project.key)} disabled={!project} />
        )}
        <MenuButton items={moreItems} label="More">
          {(props) => <IconButton {...props} icon={MoreHorizontal} label="More" variant="outline" />}
        </MenuButton>
      </span>
    </div>
  );

  let body: React.ReactNode;
  if (loadError && !tickets) {
    body = <EmptyState icon={FolderKanban} title="The Tracker didn't load" role="alert" action={<Button onClick={() => { setLoadError(null); loadProjects(); }}>Try again</Button>}>{loadError}</EmptyState>;
  } else if (projects === null || (project && tickets === null)) {
    body = <div className="flex-1 flex items-center justify-center"><Spinner size={20} /></div>;
  } else if (!project) {
    body = (
      <EmptyState icon={FolderKanban} title="No projects yet"
        action={<Button variant="primary" icon={Plus} onClick={() => setNewProject(true)}>New project</Button>}>
        A project holds one board of tickets. Agents get access to a project with a token.
      </EmptyState>
    );
  } else if (view === 'questions') {
    body = <QuestionsView projects={selected} onOpen={setOpenQuestion} />;
  } else if (view === 'agents') {
    const overview = agents ? (
      <AgentsView data={agents} waiting={waiting} machineNames={machineNames} narrow={listMode || chatBeside && width < BOARD_MIN + CHAT_WIDTH} onOpen={setOpenKey}
        onShowUnclaimed={() => { setView('board'); setOwner(UNCLAIMED); setReviewOnly(false); }}
        onShowReview={() => { setView('board'); setOwner(''); if (listMode) setStage('uat'); else setReviewOnly(true); }} />
    ) : <div className="flex-1 flex items-center justify-center"><Spinner size={20} /></div>;
    const chat = (
      <TrackerChat project={talkKey ?? project.key} projects={selected} unreadBy={unreadBy} onProject={setChatProject}
        agentNames={agentNames} visible={chatBeside || agentsPane === 'chat'}
        onOpen={setOpenKey} onUnread={(n, key) => setUnreadBy((cur) => ({ ...cur, [key]: n }))} />
    );
    body = chatBeside ? (
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col">{overview}</div>
        <div className="shrink-0 min-h-0 border-l border-nb-border flex flex-col" style={{ width: CHAT_WIDTH }}>{chat}</div>
      </div>
    ) : (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-3 pt-2">
          <SegmentedControl label="Agents or chat" size="sm" value={agentsPane} onChange={setAgentsPane}
            options={[{ value: 'overview', label: 'Overview' }, { value: 'chat', label: chatUnread ? `Chat · ${chatUnread} new` : 'Chat' }]} />
        </div>
        {/* Several projects: the overview is one project's, as the chat is; its selector is on the chat's tab here */}
        {multi && agentsPane === 'overview' && talkKey && (
          <div className="px-3 pt-2">
            <Select label="Agents project" size="sm" value={talkKey} onChange={(e) => setChatProject(e.target.value)}
              options={selected.map((k) => ({ value: k, label: `${k} · ${projectNames[k] ?? k}` }))} />
          </div>
        )}
        {agentsPane === 'chat' ? <div className="flex-1 min-h-0 flex flex-col">{chat}</div> : overview}
      </div>
    );
  } else if (listMode) {
    const col = columns.find((c) => c.key === stage)!;
    const list = stage === 'done' && !showAllDone ? col.tickets.slice(-DONE_SHOWN).reverse() : col.tickets;
    body = (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-3 pt-2.5 flex flex-col gap-2">
          <SearchField value={query} onChange={setQuery} placeholder="Search tickets" />
          <div role="tablist" aria-label="Stage" className="flex gap-0.5 p-[3px] rounded-[9px] bg-nb-surface overflow-x-auto">
            {columns.map((c) => {
              const active = c.key === stage;
              return (
                <button key={c.key} role="tab" type="button" aria-selected={active} onClick={() => setStage(c.key)}
                  className={`inline-flex items-center gap-1 h-[30px] px-2.5 rounded-[7px] text-[12.5px] whitespace-nowrap shrink-0 ${active ? 'bg-nb-raised text-nb-accent-text font-semibold shadow-xs' : 'text-nb-text-2 hover:text-nb-text'}`}>
                  {c.short}
                  {c.key === 'uat' && c.tickets.length > 0
                    ? <span className="min-w-4 h-4 px-1 rounded-full bg-nb-accent text-nb-accent-fg text-[10.5px] inline-flex items-center justify-center">{c.tickets.length}</span>
                    : c.key !== 'done' && <span className="text-nb-text-3">{c.tickets.length}</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-3 flex flex-col gap-2">
          {stage === 'uat' && list.length > 0 && (
            <div className="flex items-center gap-1.5 px-0.5 text-[12.5px] text-nb-text-2">
              <Lock size={12} strokeWidth={1.75} aria-hidden /> Waiting for your approval
            </div>
          )}
          {list.length === 0 && <p className="m-0 py-8 text-center text-[13px] text-nb-text-3">Nothing in {col.name}.</p>}
          {list.map((t) => (
            <TicketCard key={t.key} t={t} blocked={blockedBy(t)} machineNames={machineNamesOf(t.key)} projectName={multi ? projectNames[projectOf(t.key)] : undefined} onOpen={() => setOpenKey(t.key)}
              onContextMenu={(e) => { e.preventDefault(); setCardMenu({ t, at: { x: e.clientX, y: e.clientY } }); }} />
          ))}
          {stage === 'done' && col.tickets.length > DONE_SHOWN && !showAllDone && (
            <Button variant="ghost" onClick={() => setShowAllDone(true)}>Show all {col.tickets.length}</Button>
          )}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="flex-1 min-h-0 grid gap-3 p-3" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        {columns.map((c) => {
          const review = c.key === 'uat';
          const list = c.key === 'done' && !showAllDone ? c.tickets.slice(-DONE_SHOWN).reverse() : c.tickets;
          return (
            <section key={c.key} aria-label={c.name}
              onDragOver={(e) => { e.preventDefault(); setDropTarget(c.key); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null); }}
              onDrop={(e) => onDrop(c.key, e)}
              style={review ? { borderColor: 'color-mix(in srgb, var(--nb-accent) 40%, transparent)' } : undefined}
              className={`flex flex-col min-w-0 min-h-0 p-2.5 rounded-xl border ${review ? 'bg-nb-accent-soft' : 'bg-nb-surface border-transparent'} ${dropTarget === c.key ? 'outline-solid outline-2 outline-nb-accent' : ''}`}>
              <div className="flex items-center gap-2 px-1 pb-2.5">
                {/* "Review": "User acceptance" was cut off beside "Only you approve" */}
                <h2 className="m-0 text-[13px] font-semibold truncate shrink-0" title={c.name}>{review ? 'Review' : c.name}</h2>
                <span className="text-xs text-nb-text-3" title={filtering ? `${c.tickets.length} of ${counts[c.key] ?? c.tickets.length} match` : undefined}>
                  {filtering ? c.tickets.length : counts[c.key] ?? c.tickets.length}
                </span>
                <span className="flex-1" />
                {review && <span className="text-[11.5px] font-semibold text-nb-accent-text whitespace-nowrap truncate min-w-0" title="Only you approve">Only you approve</span>}
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-0.5">
                {list.map((t) => (
                  <div key={t.key} data-card={t.key}>
                    <TicketCard t={t} blocked={blockedBy(t)} machineNames={machineNamesOf(t.key)} projectName={multi ? projectNames[projectOf(t.key)] : undefined} onOpen={() => setOpenKey(t.key)}
                      onDragStart={(e) => { dragKey.current = t.key; e.dataTransfer.setData('text/plain', t.key); e.dataTransfer.effectAllowed = 'move'; }}
                      onContextMenu={(e) => { e.preventDefault(); setCardMenu({ t, at: { x: e.clientX, y: e.clientY } }); }} />
                  </div>
                ))}
                {c.key === 'done' && c.tickets.length > DONE_SHOWN && !showAllDone && (
                  <Button variant="ghost" onClick={() => setShowAllDone(true)}>Show all {c.tickets.length}</Button>
                )}
                {list.length === 0 && <p className="m-0 py-6 text-center text-[12.5px] text-nb-text-3">{filtering ? 'None match' : 'Nothing here'}</p>}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="nb-scope relative h-full w-full flex flex-col bg-nb-bg text-nb-text font-ui overflow-hidden">
      {appBar}
      {header}
      {project && strip.length > 0 && (
        // One row that scrolls sideways on a phone; it took three rows above the tickets
        <div className={`flex items-center gap-1.5 px-3 pt-2 ${listMode ? 'flex-nowrap overflow-x-auto' : 'flex-wrap'}`} role="group" aria-label="Machines">
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-nb-text-3 mr-0.5 shrink-0">Machines</span>
          {strip.map((r) => {
            const holder = r.holders[0];
            return (
              // One holder: open its ticket. Several ('+5'): the Machines dialog lists them all
              <button key={`${r.project}:${r.key}`} type="button" onClick={() => (holder && r.holders.length === 1 ? setOpenKey(holder.ticket) : setMachines(r.project))}
                title={r.busy ? `${r.name} is busy: ${r.holders.map((h) => `${h.ticket} ${h.title} (${h.owner || 'no owner'})`).join('; ')}` : `${r.name} is free${r.description ? `\n${r.description}` : ''}`}
                className={`inline-flex items-center gap-1.5 h-7 px-2 rounded-full border text-[12px] min-w-0 max-w-full ${listMode ? 'shrink-0' : ''} ${r.busy ? 'bg-nb-warning-soft border-transparent text-nb-text' : 'bg-nb-raised border-nb-border text-nb-text-2'}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.busy ? 'bg-nb-warning' : 'bg-nb-success'}`} aria-hidden />
                {multi && <span className="font-mono text-[11px] text-nb-accent-text shrink-0">{r.project}</span>}
                <span className="font-medium shrink-0">{r.name}</span>
                <span className="truncate text-nb-text-2">{holder ? `${holder.ticket}${holder.owner ? ` · ${holder.owner}` : ''}${r.holders.length > 1 ? ` +${r.holders.length - 1}` : ''}` : 'free'}</span>
              </button>
            );
          })}
        </div>
      )}
      {listMode && project && (
        <div className="px-3 pt-2">
          <SegmentedControl label="Tracker view" size="sm" value={view} onChange={setView}
            options={viewOptions} />
        </div>
      )}
      {listMode && project && view === 'board' && (
        <div className="flex gap-2 px-3 pt-2 flex-wrap *:min-w-0">
          {selectOwner}
          {selectLabel}
        </div>
      )}
      {view === 'board' && project && waiting && (waiting.count > 0 || (waiting.unasked ?? []).length > 0) && (
        <div className="mx-3 mt-2 rounded-[10px] border bg-nb-accent-soft min-w-0 flex flex-col max-h-[45%]"
          style={{ borderColor: 'color-mix(in srgb, var(--nb-accent) 40%, transparent)' }}>
          <button type="button" aria-expanded={waitingOpen}
            onClick={() => { const next = !waitingOpen; setWaitingOpen(next); writeStored(WAITING_OPEN, next ? '1' : '0'); }}
            className="flex items-center gap-2 px-3 py-2 text-left min-w-0">
            <Inbox size={16} strokeWidth={1.75} className="shrink-0 text-nb-accent-text" aria-hidden />
            <span className="text-[13.5px] font-semibold shrink-0">Waiting on you</span>
            {waiting.count > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-nb-accent text-nb-accent-fg text-[11px] font-semibold inline-flex items-center justify-center shrink-0">{waiting.count}</span>}
            <span className="text-[12.5px] text-nb-text-2 truncate min-w-0">
              {[asked && `${asked} question${asked === 1 ? '' : 's'} for you`,
                waiting.review.length && `${waiting.review.length} to review`,
                // Not counted: its agent should ask a question
                (waiting.unasked ?? []).length && `${(waiting.unasked ?? []).length} blocked, no question asked yet`].filter(Boolean).join(' · ')}
            </span>
            <span className="flex-1" />
            <ChevronDown size={15} strokeWidth={1.75} aria-hidden className={`shrink-0 text-nb-text-2 transition-transform ${waitingOpen ? 'rotate-180' : ''}`} />
          </button>
          {reviewOrder.length > 0 && (
            <div className="px-3 pb-2">
              <Button variant="primary" onClick={() => setReviewing(reviewOrder)}>
                Review {reviewOrder.length}, oldest first
              </Button>
            </div>
          )}
          {waitingOpen && (
            <div className="px-2 pb-2 overflow-y-auto min-h-0">
              <WaitingOnYou data={waiting} onOpen={setOpenKey} onOpenQuestion={setOpenQuestion} />
            </div>
          )}
        </div>
      )}
      {body}

      {openKey && (
        <TicketDialog ticketKey={openKey} narrow={narrow} stacked={listMode} onClose={() => closeTicket(openKey)} onOpen={setOpenKey}
          onEdit={(key) => setEditor({ ticketKey: key, projectKey: projectOf(key) })} onOpenQuestion={setOpenQuestion}
          moveItems={(t) => cardMenuItems(t as unknown as TicketSummary).slice(3)}
          machineNames={machineNamesOf(openKey)}
          nextReview={reviewQueue.find((k) => k !== openKey) ?? null} reviewLeft={reviewQueue.filter((k) => k !== openKey).length}
          onChanged={() => { loadProjects(); loadTickets(); }} notify={toast.show} />
      )}
      {openQuestion !== null && (
        <QuestionDialog questionId={openQuestion} narrow={narrow} onClose={() => setOpenQuestion(null)}
          onOpenTicket={(key) => { setOpenQuestion(null); setOpenKey(key); }}
          onChanged={() => { loadTickets(); }} notify={toast.show} />
      )}
      {reviewing && (
        <ReviewMode queue={reviewing} narrow={narrow} onClose={() => { setReviewing(null); loadTickets(); }}
          onChanged={() => { loadProjects(); loadTickets(); }}
          notify={toast.show} />
      )}
      {editor && (
        <TicketEditor projectKey={editor.projectKey} ticketKey={editor.ticketKey} narrow={narrow} owners={owners} resources={resourcesBy[editor.projectKey] ?? []}
          onClose={() => setEditor(null)}
          onSaved={(key) => { setEditor(null); loadProjects(); loadTickets(); if (!editor.ticketKey) setOpenKey(key); }} />
      )}
      {machines && projects?.find((p) => p.key === machines) && (
        <MachinesDialog project={projects.find((p) => p.key === machines)!} resources={resourcesBy[machines] ?? []} narrow={narrow} onClose={() => setMachines(null)}
          onChanged={() => loadTickets()} />
      )}
      {access && projects?.find((p) => p.key === access) && (
        <AccessDialog project={projects.find((p) => p.key === access)!} narrow={narrow} stacked={listMode} onClose={() => setAccess(null)} />
      )}
      {newProject && (
        <NewProjectDialog narrow={narrow} onClose={() => setNewProject(false)}
          onCreated={(key) => { setNewProject(false); loadProjects().then(() => choose([key])); }} />
      )}
      {cardMenu && <Menu items={cardMenuItems(cardMenu.t)} at={cardMenu.at} label={`${cardMenu.t.key} actions`} onClose={() => setCardMenu(null)} />}
      {toast.element}
    </div>
  );
}
