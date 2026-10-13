// The Tracker's Agents view: who is working on what, who is idle, what's free to take,
// and what waits on you. The Machines strip above it is shared with the board.
import { Bot, Cpu, Hand, Inbox } from 'lucide-react';
import { AgentRow, AgentsOverview, WaitingOnYou as Waiting, clockTime, statusName } from './trackerApi';
import WaitingOnYou from './WaitingOnYou';

function ago(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return clockTime(ts);
}

function TicketLine({ k, title, status, onOpen, extra }: { k: string; title: string; status?: string; onOpen: (key: string) => void; extra?: string }) {
  return (
    <button type="button" onClick={() => onOpen(k)}
      className="flex items-baseline gap-2 w-full min-w-0 text-left text-[13px] rounded-md px-1.5 py-1 hover:bg-nb-hover">
      <span className="font-mono text-xs text-nb-accent-text shrink-0">{k}</span>
      <span className="truncate text-nb-text" title={title}>{title}</span>
      {status && <span className="shrink-0 text-[11.5px] text-nb-text-3">{statusName(status)}</span>}
      {extra && <span className="shrink-0 inline-flex items-center gap-1 text-[11.5px] text-nb-text-3"><Cpu size={11} strokeWidth={2} aria-hidden />{extra}</span>}
    </button>
  );
}

function AgentCard({ a, machineNames, onOpen }: { a: AgentRow; machineNames: Record<string, string>; onOpen: (key: string) => void }) {
  return (
    <li className="flex flex-col gap-1.5 p-3 rounded-[10px] bg-nb-raised border border-nb-border min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <Bot size={15} strokeWidth={1.75} className="shrink-0 text-nb-text-2" aria-hidden />
        <span className="font-semibold text-[14px] truncate" title={a.name}>{a.name}</span>
        <span className={`shrink-0 inline-flex items-center h-5 px-2 rounded-full text-[11.5px] font-semibold ${a.idle ? 'bg-nb-surface text-nb-text-3' : 'bg-nb-success-soft text-nb-success'}`}>
          {a.idle ? 'Idle' : 'Working'}
        </span>
        <span className="flex-1" />
        {a.last_activity && <span className="shrink-0 text-xs text-nb-text-3" title={new Date(a.last_activity.ts * 1000).toLocaleString()}>{ago(a.last_activity.ts)}</span>}
      </div>
      {a.current.map((t) => (
        <TicketLine key={t.key} k={t.key} title={t.title} status={t.status} onOpen={onOpen}
          extra={t.resources.length ? t.resources.map((r) => machineNames[r] ?? r).join(', ') : undefined} />
      ))}
      {a.in_review.length > 0 && (
        <div className="flex flex-col">
          <span className="text-[11.5px] text-nb-text-3">Waiting for your review</span>
          {a.in_review.map((t) => <TicketLine key={t.key} k={t.key} title={t.title} onOpen={onOpen} />)}
        </div>
      )}
      {a.idle && a.in_review.length === 0 && a.last_activity && (
        <p className="m-0 text-[12.5px] text-nb-text-3 truncate" title={`${a.last_activity.ticket} ${a.last_activity.title}`}>
          Last: {a.last_activity.what} on {a.last_activity.ticket}
        </p>
      )}
    </li>
  );
}

export default function AgentsView({ data, waiting, machineNames, narrow, onOpen, onShowUnclaimed, onShowReview }: {
  data: AgentsOverview;
  waiting: Waiting | null;  // agents' questions and reviews; blocked tickets with no question asked, apart
  machineNames: Record<string, string>;
  narrow: boolean;
  onOpen: (key: string) => void;
  onShowUnclaimed: () => void;
  onShowReview: () => void;
}) {
  const w = data.waiting_on_user;
  const busy = data.agents.filter((a) => !a.idle).length;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
      <div className="grid gap-2" style={{ gridTemplateColumns: narrow ? '1fr' : 'repeat(2, minmax(0, 1fr))' }}>
        <button type="button" onClick={onShowReview}
          className="flex items-start gap-2.5 p-3 rounded-[10px] text-left border bg-nb-accent-soft min-w-0"
          style={{ borderColor: 'color-mix(in srgb, var(--nb-accent) 40%, transparent)' }}>
          <Inbox size={18} strokeWidth={1.75} className="shrink-0 mt-0.5 text-nb-accent-text" aria-hidden />
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold">{waiting ? waiting.count : w.count} waiting on you</span>
            <span className="block text-[12.5px] text-nb-text-2">
              {w.review.length} to review{(w.asked ?? []).length ? `, ${(w.asked ?? []).length} with a question for you` : ''}
            </span>
          </span>
        </button>
        <button type="button" onClick={onShowUnclaimed}
          className="flex items-start gap-2.5 p-3 rounded-[10px] text-left border border-nb-border bg-nb-raised min-w-0">
          <Hand size={18} strokeWidth={1.75} className="shrink-0 mt-0.5 text-nb-text-2" aria-hidden />
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold">{data.startable_unclaimed.length} free to take</span>
            <span className="block text-[12.5px] text-nb-text-2 truncate">
              {data.startable_unclaimed.length ? `Startable and unclaimed, e.g. ${data.startable_unclaimed[0].key}` : 'Nothing startable is unclaimed'}
            </span>
          </span>
        </button>
      </div>
      {waiting ? ((waiting.count > 0 || (waiting.unasked ?? []).length > 0) && (
        <div className="flex flex-col p-3 rounded-[10px] border border-nb-border bg-nb-surface min-w-0">
          <WaitingOnYou data={waiting} onOpen={onOpen} />
        </div>
      )) : (w.unasked ?? []).length > 0 && (
        <div className="flex flex-col p-3 rounded-[10px] border border-nb-border bg-nb-surface">
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-nb-text-3 mb-1">Blocked on you, no question asked yet</span>
          {(w.unasked ?? []).map((t) => <TicketLine key={t.key} k={t.key} title={t.title} status={t.status} onOpen={onOpen} />)}
        </div>
      )}
      <div className="flex items-center gap-2 text-[12.5px] text-nb-text-2">
        <span className="font-semibold uppercase tracking-wide text-[11.5px] text-nb-text-3">Agents</span>
        <span>{busy} working · {data.agents.length - busy} idle</span>
      </div>
      {data.agents.length === 0 ? (
        <p className="m-0 py-6 text-center text-[13px] text-nb-text-3">No agent has worked in this project yet.</p>
      ) : (
        <ul className="m-0 p-0 list-none grid gap-2" style={{ gridTemplateColumns: narrow ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {data.agents.map((a) => <AgentCard key={a.name} a={a} machineNames={machineNames} onOpen={onOpen} />)}
        </ul>
      )}
    </div>
  );
}
