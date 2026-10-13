// The Tracker's Questions view: agents' questions to the owner as cards, waiting longest first;
// Answered (waiting for the agent) and Closed beside them. A card opens the question.
import { useCallback, useEffect, useState } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import { EmptyState, SegmentedControl, Spinner } from '../ui';
import { useSyncEvent } from '../live/LiveProvider';
import { Question, errorText, trackerApi } from './trackerApi';
import { ago } from './WaitingOnYou';
import { Tag } from './QuestionDialog';
import { mergeQuestions } from './trackerSelection';

type Filter = 'open' | 'answered' | 'closed';

export function QuestionCard({ q, onOpen }: { q: Question; onOpen: (id: number) => void }) {
  const since = q.status === 'open' ? q.waiting_since : q.status === 'answered' ? (q.answered_at ?? q.updated) : (q.closed_at ?? q.updated);
  return (
    <button type="button" onClick={() => onOpen(q.id)} data-question={q.id}
      className="flex flex-col gap-1 w-full min-w-0 text-left rounded-[10px] border border-nb-border bg-nb-raised px-3 py-2.5 hover:bg-nb-hover shadow-nb">
      <span className="flex items-baseline gap-2 min-w-0 text-[12.5px]">
        <span className="font-mono text-xs text-nb-accent-text shrink-0">{q.ticket.key}</span>
        <span className="truncate text-nb-text-2 min-w-0" title={q.ticket.title}>{q.ticket.title}</span>
      </span>
      <span className="text-[14px] font-semibold text-nb-text wrap-break-word">{q.title}</span>
      {q.last_reply && (
        <span className="text-[12.5px] text-nb-text-2 truncate min-w-0" title={q.last_reply.preview}>
          {q.last_reply.author === 'user' ? 'You' : q.last_reply.author}: {q.last_reply.choice ? `chose ${q.last_reply.choice}` : ''}{q.last_reply.choice && q.last_reply.preview ? ' · ' : ''}{q.last_reply.preview}
        </span>
      )}
      <span className="flex items-center gap-1.5 flex-wrap text-[11.5px] text-nb-text-3 min-w-0">
        <span>{q.asked_by}</span>
        <span>· {q.status === 'open' ? 'waiting' : q.status} {ago(since)}{q.status === 'open' ? '' : ' ago'}</span>
        {q.reply_count > 0 && <span>· {q.reply_count} {q.reply_count === 1 ? 'reply' : 'replies'}</span>}
        {q.recommended && q.status === 'open' && <Tag accent>Recommends {q.recommended}</Tag>}
        {q.chosen && q.status !== 'open' && <Tag>You chose {q.chosen}</Tag>}
      </span>
    </button>
  );
}

export default function QuestionsView({ projects, onOpen, onCounts }: {
  /** The projects shown: one, or several merged */
  projects: string[];
  onOpen: (id: number) => void;
  onCounts?: (open: number, answered: number) => void;
}) {
  const [filter, setFilter] = useState<Filter>('open');
  const [list, setList] = useState<Question[] | null>(null);
  const [counts, setCounts] = useState({ open: 0, answered: 0 });
  const [error, setError] = useState<string | null>(null);

  const key = projects.join(',');
  const load = useCallback(() => {
    const status = filter === 'closed' ? 'closed' : filter;
    // One request per project; several are merged in the order one project's list has
    Promise.all(key.split(',').filter(Boolean).map((p) => trackerApi.questions(p, { status }))).then((rs) => {
      const open = rs.reduce((n, r) => n + r.open, 0), answered = rs.reduce((n, r) => n + r.answered, 0);
      setList(rs.length === 1 ? rs[0].questions : mergeQuestions(rs.map((r) => r.questions), status));
      setCounts({ open, answered });
      onCounts?.(open, answered);
      setError(null);
    }).catch((e) => setError(errorText(e, 'Could not load the questions')));
  }, [key, filter, onCounts]);
  useEffect(() => { setList(null); load(); }, [load]);
  useSyncEvent('tracker_question', useCallback((event: { data?: Record<string, any> }) => {
    if (!event?.data?.project || key.split(',').includes(event.data.project)) load();
  }, [key, load]));
  useSyncEvent('sync_reconnected', load);

  const empty = {
    open: ['Nothing is waiting on you', 'When an agent needs a decision from you, its question shows here.'],
    answered: ['No answered questions', 'Questions you answered wait here until the agent closes them.'],
    closed: ['Nothing closed yet', 'Resolved and withdrawn questions are kept here.'],
  }[filter];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 pt-2.5">
        <SegmentedControl label="Which questions" size="sm" value={filter} onChange={setFilter}
          options={[
            { value: 'open', label: counts.open ? `Waiting on you · ${counts.open}` : 'Waiting on you' },
            { value: 'answered', label: counts.answered ? `Answered · ${counts.answered}` : 'Answered' },
            { value: 'closed', label: 'Closed' },
          ]} />
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-3 flex flex-col gap-2">
        {error && <p role="alert" className="m-0 text-[13px] text-nb-danger">{error}</p>}
        {!list && !error && <div className="py-10 flex justify-center"><Spinner size={20} /></div>}
        {list && list.length === 0 && <EmptyState icon={MessageCircleQuestion} title={empty[0]}>{empty[1]}</EmptyState>}
        {list?.map((q) => <QuestionCard key={q.id} q={q} onOpen={onOpen} />)}
      </div>
    </div>
  );
}
