// The project chat: the owner and the agents talk here, so the owner can follow and answer
// on a small screen. Agents post updates and answers; the owner's messages can name one agent (@name)
// or go to the whole project (all its agents). Ticket keys in a message show as cards that open the ticket.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowUp, BellRing, Bot, MessageSquare } from 'lucide-react';
import { Button, EmptyState, IconButton, Select, Spinner } from '../ui';
import { useSyncEvent } from '../live/LiveProvider';
import { ChatMessage, clockTime, errorText, statusName, trackerApi } from './trackerApi';
import { STALL_HINT_TEXT, useStallHint } from '../hooks/useStallHint';
import { DraftKey } from '../lib/http';
import { useGrowingTextarea } from '../hooks/useGrowingTextarea';
import { MD, MD_PLUGINS } from './TrackerMarkdown';

// The Tracker's own chat lines; an agent may be called plain 'tracker'
export const TRACKER_AUTHOR = 'task-tracker';

function when(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : clockTime(ts);
}

const Message = memo(function Message({ m, onOpen }: { m: ChatMessage; onOpen: (key: string) => void }) {
  const mine = m.author === 'user';
  // The tracker's own notes ('the owner answered your question …'): a small system line, not a bubble
  if (m.author === TRACKER_AUTHOR) {
    return (
      <li className="self-center flex flex-col items-center gap-1 min-w-0 max-w-[92%] text-center" data-system="tracker">
        <span className="inline-flex items-center gap-1.5 text-[11.5px] text-nb-text-3 min-w-0 max-w-full">
          <BellRing size={12} strokeWidth={1.75} className="shrink-0" aria-hidden />
          <span className="truncate">Tracker{m.to ? ` to ${m.to}` : ''}</span>
          <span className="shrink-0" title={new Date(m.ts * 1000).toLocaleString()}>{when(m.ts)}</span>
        </span>
        <div className="min-w-0 max-w-full text-[12.5px] leading-snug text-nb-text-2 wrap-break-word">
          <ReactMarkdown remarkPlugins={MD_PLUGINS} components={MD}>{m.body}</ReactMarkdown>
        </div>
      </li>
    );
  }
  return (
    <li className={`flex flex-col gap-1 min-w-0 max-w-[92%] ${mine ? 'self-end items-end' : 'self-start items-start'}`}>
      <span className="flex items-center gap-1.5 text-[11.5px] text-nb-text-3 min-w-0 max-w-full">
        {!mine && <Bot size={12} strokeWidth={1.75} className="shrink-0" aria-hidden />}
        <span className={`truncate ${mine ? '' : 'font-semibold text-nb-text-2'}`}>{mine ? 'You' : m.author}</span>
        {m.to && <span className="truncate">to {m.to === 'user' ? 'you' : m.to}</span>}
        <span className="shrink-0" title={new Date(m.ts * 1000).toLocaleString()}>{when(m.ts)}</span>
      </span>
      <div className={`min-w-0 max-w-full px-3 py-2 rounded-[12px] text-[13.5px] leading-snug wrap-break-word ${mine ? 'bg-nb-accent-soft text-nb-text' : 'bg-nb-raised border border-nb-border text-nb-text'}`}>
        <ReactMarkdown remarkPlugins={MD_PLUGINS} components={MD}>{m.body}</ReactMarkdown>
      </div>
      {m.tickets.map((t) => (
        <button key={t.key} type="button" onClick={() => onOpen(t.key)} title={`Open ${t.key} ${t.title}`}
          className="flex items-baseline gap-2 min-w-0 max-w-full text-left text-[12.5px] rounded-lg border border-nb-border bg-nb-surface hover:bg-nb-hover px-2 py-1.5">
          <span className="font-mono text-xs text-nb-accent-text shrink-0">{t.key}</span>
          <span className="truncate text-nb-text">{t.title}</span>
          <span className="shrink-0 text-[11px] text-nb-text-3">{statusName(t.status)}</span>
        </button>
      ))}
    </li>
  );
});

export default function TrackerChat({ project, projects = [], unreadBy = {}, onProject, agentNames, visible, onOpen, onUnread }: {
  /** The chat shown: one project's (the chat stays per project) */
  project: string;
  /** The projects the Tracker shows; with several, a selector picks which project's chat */
  projects?: string[];
  /** Unread messages per project, for the selector */
  unreadBy?: Record<string, number>;
  onProject?: (key: string) => void;
  agentNames: string[];
  /** On screen: what arrives is read */
  visible: boolean;
  onOpen: (key: string) => void;
  onUnread: (count: number, project: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [moreBefore, setMoreBefore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const { stalled: sendStalled } = useStallHint(sending);
  const draftKey = useRef(new DraftKey());  // Send again after a lost answer → stored once
  const listRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  useGrowingTextarea(boxRef, draft);  // grows with the message, then scrolls inside
  const caretAt = useRef<number | null>(null);  // after picking an @name: type on after it
  useLayoutEffect(() => {
    if (caretAt.current === null || !boxRef.current) return;
    boxRef.current.setSelectionRange(caretAt.current, caretAt.current);
    caretAt.current = null;
  }, [draft]);
  const atBottom = useRef(true);
  const lastId = useRef(0);
  const readUpto = useRef(0);
  const projectRef = useRef(project);
  projectRef.current = project;
  // Another project's chat has other agents: start again on the whole project
  useEffect(() => { setFilter(''); }, [project]);

  const load = useCallback(async () => {
    setMessages(null); setError(null); lastId.current = 0; readUpto.current = 0; atBottom.current = true;
    try {
      const page = await trackerApi.chat(project);
      if (projectRef.current !== project) return;
      setMessages(page.messages);
      setMoreBefore(page.more_before);
      lastId.current = page.messages[page.messages.length - 1]?.id ?? 0;
    } catch (e) {
      setError(errorText(e, 'Could not load the chat'));
    }
  }, [project]);
  useEffect(() => { load(); }, [load]);

  const fetchNew = useCallback(async () => {
    try {
      const page = await trackerApi.chat(project, { since: lastId.current });
      if (projectRef.current !== project || !page.messages.length) return;
      lastId.current = page.messages[page.messages.length - 1].id;
      setMessages((cur) => {
        const have = new Set((cur ?? []).map((m) => m.id));
        return [...(cur ?? []), ...page.messages.filter((m) => !have.has(m.id))];
      });
    } catch { /* the next event or reconnect tries again */ }
  }, [project]);
  const onEvent = useCallback((event: { data?: Record<string, any> }) => {
    const data = event?.data;
    if (data?.project === projectRef.current && data.kind === 'message') fetchNew();
  }, [fetchNew]);
  useSyncEvent('tracker_chat', onEvent);
  useSyncEvent('sync_reconnected', () => { fetchNew(); });

  const loadEarlier = async () => {
    const first = messages?.[0];
    if (!first) return;
    const el = listRef.current;
    const fromBottom = el ? el.scrollHeight - el.scrollTop : 0;
    try {
      const page = await trackerApi.chat(project, { before: first.id });
      setMessages((cur) => [...page.messages, ...(cur ?? [])]);
      setMoreBefore(page.more_before);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - fromBottom; });  // stay where you were
    } catch (e) {
      setError(errorText(e, 'Could not load earlier messages'));
    }
  };

  // Follow the conversation while you're at its end; leave the view alone when you've scrolled up
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, filter]);
  const onScroll = () => {
    const el = listRef.current;
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  // What's on screen is read
  useEffect(() => {
    const latest = messages?.length ? messages[messages.length - 1].id : 0;
    if (!visible || !latest || latest <= readUpto.current) return;
    readUpto.current = latest;
    trackerApi.chatRead(project, latest).then((r) => onUnread(r.unread, project)).catch(() => {});
  }, [visible, messages, project, onUnread]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const msg = await trackerApi.postChat(project, body, filter || null, draftKey.current.for(project, body, filter || null));
      draftKey.current.done();
      atBottom.current = true;
      lastId.current = Math.max(lastId.current, msg.id);
      setMessages((cur) => (cur?.some((m) => m.id === msg.id) ? cur : [...(cur ?? []), msg]));
      // Only what was sent: the message often shows (through the live event) before this answer, and anything
      // typed since then is the next message
      setDraft((cur) => (cur.trim() === body ? '' : cur));
    } catch (e) {
      setError(errorText(e, 'Could not send'));
    } finally {
      setSending(false);
    }
  };

  // Agents on the board, and anyone who has spoken here
  const names = useMemo(() => Array.from(new Set([...agentNames, ...(messages ?? []).map((m) => m.author)]))
    .filter((n) => n !== 'user' && n !== TRACKER_AUTHOR).sort((a, b) => a.localeCompare(b)), [agentNames, messages]);
  const mention = /^@([A-Za-z0-9_.-]*)$/.exec(draft);
  const suggestions = mention ? names.filter((n) => n.toLowerCase().startsWith(mention[1].toLowerCase())).slice(0, 6) : [];
  const shown = useMemo(() => {
    if (!messages || !filter) return messages;
    const f = filter.toLowerCase();
    return messages.filter((m) => m.author.toLowerCase() === f || (m.to ?? '').toLowerCase() === f);
  }, [messages, filter]);
  // The project itself (all its agents: no `to`, as 'everyone' was) or one agent
  const filterOptions = useMemo(() => [
    { value: '', label: `${project} · all agents` },
    ...names.map((n) => ({ value: n, label: n })),
  ], [names, project]);

  return (
    <section className="flex flex-col min-h-0 min-w-0 h-full" aria-label="Project chat">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-nb-border min-w-0">
        <MessageSquare size={15} strokeWidth={1.75} className="shrink-0 text-nb-text-2" aria-hidden />
        <span className="font-semibold text-[14px] truncate">Chat</span>
        <span className="flex-1" />
        {projects.length > 1 && onProject && (
          <Select label="Chat project" size="sm" value={project} onChange={(e) => onProject(e.target.value)}
            options={projects.map((k) => ({ value: k, label: unreadBy[k] ? `${k} · ${unreadBy[k]} new` : k }))} />
        )}
        <Select label="Show messages from or to" size="sm" value={filter} onChange={(e) => setFilter(e.target.value)} options={filterOptions} />
      </div>
      {/* A log: new messages are read out as they arrive */}
      <div ref={listRef} onScroll={onScroll} role="log" aria-label="Project chat" className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        {error && <p className="m-0 mb-2 text-[12.5px] text-nb-danger-text">{error}</p>}
        {shown === null ? (
          <div className="h-full flex items-center justify-center"><Spinner size={18} /></div>
        ) : shown.length === 0 ? (
          <EmptyState icon={MessageSquare} title={filter ? `Nothing with ${filter} yet` : 'No messages yet'}>
            Agents post their updates here. Write @name to talk to one of them, or write to all of {project}'s agents.
          </EmptyState>
        ) : (
          <>
            {moreBefore && !filter && (
              <div className="flex justify-center mb-2"><Button size="sm" variant="ghost" onClick={loadEarlier}>Earlier messages</Button></div>
            )}
            <ul className="m-0 p-0 list-none flex flex-col gap-3">
              {shown.map((m) => <Message key={m.id} m={m} onOpen={onOpen} />)}
            </ul>
          </>
        )}
      </div>
      {sendStalled && (
        <p className="m-0 border-t border-nb-border px-3 pt-1.5 text-[12px] text-nb-text-3 truncate" title={STALL_HINT_TEXT}>{STALL_HINT_TEXT}</p>
      )}
      <div className={`relative ${sendStalled ? '' : 'border-t border-nb-border '}p-2 flex items-end gap-2`}>
        {/* Always on the page, so the waiting hint is read out when it appears */}
        <span role="status" className="sr-only">{sendStalled ? STALL_HINT_TEXT : ''}</span>
        {suggestions.length > 0 && (
          <div className="absolute left-2 right-2 bottom-full mb-1 flex flex-wrap gap-1 p-1.5 rounded-lg bg-nb-raised border border-nb-border shadow-nb" role="listbox" aria-label="Agents">
            {suggestions.map((n) => (
              <button key={n} type="button" role="option" aria-selected={false} onClick={() => {
                const text = `@${n} `;
                caretAt.current = text.length;
                setDraft(text);
                boxRef.current?.focus();
              }}
                className="h-7 px-2 rounded-md text-[12.5px] hover:bg-nb-hover text-nb-text">@{n}</button>
            ))}
          </div>
        )}
        <textarea ref={boxRef} value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} aria-label="Message"
          placeholder={filter ? `Message ${filter}…` : `Message all agents on ${project}, or @name…`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
          }}
          className="flex-1 min-w-0 resize-none min-h-[36px] px-3 py-2 rounded-[10px] bg-nb-surface border border-nb-border text-[14px] text-nb-text placeholder:text-nb-text-3 focus:outline-hidden focus:border-nb-accent" />
        <IconButton label="Send" icon={ArrowUp} variant="accent" onClick={send} disabled={!draft.trim() || sending} />
      </div>
    </section>
  );
}
