// 'Waiting on you': agents' questions on tickets and work to review, waiting longest first. Nothing
// is guessed any more: a ticket blocked on the owner with no question asked is listed apart, as a nudge
// for its agent to ask, and not counted.
import React from 'react';
import { CircleDashed, Eye, MessageCircleQuestion } from 'lucide-react';
import { WaitingOnYou as Waiting } from './trackerApi';

export function ago(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}

function Group({ icon: Icon, title, count, children }: { icon: typeof Eye; title: string; count: number; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <section className="flex flex-col min-w-0" aria-label={title}>
      <h3 className="m-0 mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-nb-text-3">
        <Icon size={13} strokeWidth={1.75} aria-hidden className="shrink-0" />{title}<span className="font-normal">{count}</span>
      </h3>
      <ul className="m-0 p-0 list-none flex flex-col">{children}</ul>
    </section>
  );
}

export default function WaitingOnYou({ data, onOpen, onOpenQuestion }: {
  data: Waiting;
  onOpen: (key: string) => void;
  onOpenQuestion?: (id: number) => void;
}) {
  const unasked = data.unasked ?? [];
  return (
    <div className="flex flex-col gap-3 min-w-0">
      {!data.count && <p className="m-0 px-1 py-2 text-[13px] text-nb-text-3">Nothing is waiting on you.</p>}
      {/* Agents' questions on tickets, waiting longest first */}
      <Group icon={MessageCircleQuestion} title="Questions for you" count={data.asked?.length ?? 0}>
        {(data.asked ?? []).map((q) => (
          <li key={`q${q.id}`}>
            <button type="button" onClick={() => (onOpenQuestion ? onOpenQuestion(q.id) : onOpen(q.ticket.key))}
              className="flex flex-col gap-0.5 w-full min-w-0 text-left rounded-md px-1.5 py-1.5 hover:bg-nb-hover">
              <span className="flex items-baseline gap-2 min-w-0 text-[13px]">
                <span className="font-mono text-xs text-nb-accent-text shrink-0">{q.ticket.key}</span>
                <span className="text-nb-text wrap-break-word min-w-0">{q.title}</span>
              </span>
              <span className="text-[11.5px] text-nb-text-3">
                {q.asked_by} · waiting {ago(q.waiting_since)}{q.recommended ? ` · recommends ${q.recommended}` : ''}
              </span>
            </button>
          </li>
        ))}
      </Group>
      <Group icon={Eye} title="To review, oldest first" count={data.review.length}>
        {data.review.map((r) => (
          <li key={r.key}>
            <button type="button" onClick={() => onOpen(r.key)}
              className="flex items-baseline gap-2 w-full min-w-0 text-left text-[13px] rounded-md px-1.5 py-1 hover:bg-nb-hover">
              <span className="font-mono text-xs text-nb-accent-text shrink-0">{r.key}</span>
              <span className="truncate text-nb-text min-w-0 flex-1" title={r.title}>{r.title}</span>
              <span className="shrink-0 text-[11.5px] text-nb-text-3" title={new Date(r.since * 1000).toLocaleString()}>{ago(r.since)}</span>
            </button>
          </li>
        ))}
      </Group>
      {/* Blocked on the owner, but its agent hasn't asked: not counted; the agent's next step */}
      <Group icon={CircleDashed} title="Blocked on you, no question asked yet" count={unasked.length}>
        {unasked.map((u) => (
          <li key={u.key}>
            <button type="button" onClick={() => onOpen(u.key)}
              className="flex flex-col gap-0.5 w-full min-w-0 text-left rounded-md px-1.5 py-1.5 hover:bg-nb-hover">
              <span className="flex items-baseline gap-2 min-w-0 text-[13px]">
                <span className="font-mono text-xs text-nb-accent-text shrink-0">{u.key}</span>
                <span className="truncate text-nb-text min-w-0" title={u.title}>{u.title}</span>
              </span>
              <span className="text-[11.5px] text-nb-text-3">{u.owner ? `${u.owner} hasn't asked its question yet` : 'No one has asked its question yet'}</span>
            </button>
          </li>
        ))}
      </Group>
    </div>
  );
}
