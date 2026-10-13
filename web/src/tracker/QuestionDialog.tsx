// A question an agent asked the owner on a ticket: the context, the options with the agent's
// recommendation, the thread, and an answer box (pick an option and/or write). Opened from the Questions
// view, 'Waiting on you' and the ticket.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, MessageCircleQuestion } from 'lucide-react';
import { Button, PanelDialog, Spinner } from '../ui';
import { DraftKey } from '../lib/http';
import { useSyncEvent } from '../live/LiveProvider';
import { useGrowingTextarea } from '../hooks/useGrowingTextarea';
import { Question, clockTime, errorText, trackerApi } from './trackerApi';
import { Prose } from './TicketDialog';
import { ago } from './WaitingOnYou';

/** A small label: a status, 'Recommended', a choice. */
export function Tag({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span className={`inline-flex items-center h-5 px-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap shrink-0 ${accent ? 'bg-nb-accent-soft text-nb-accent-text' : 'bg-nb-surface text-nb-text-2 border border-nb-border'}`}>
      {children}
    </span>
  );
}

export const QUESTION_STATUS: Record<Question['status'], string> = {
  open: 'Waiting for you',
  answered: 'Answered',
  resolved: 'Resolved',
  withdrawn: 'Withdrawn',
};

export default function QuestionDialog({ questionId, narrow, onClose, onOpenTicket, onChanged, notify }: {
  questionId: number;
  narrow: boolean;
  onClose: () => void;
  onOpenTicket: (key: string) => void;
  onChanged: () => void;
  notify: (text: string, opts?: { tone?: 'error' }) => void;
}) {
  const [q, setQ] = useState<Question | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const sendKey = useRef(new DraftKey());
  useGrowingTextarea(boxRef, text);

  const load = useCallback(() => {
    trackerApi.question(questionId).then((got) => { setQ(got); setError(null); })
      .catch((e) => setError(errorText(e, 'Could not load the question')));
  }, [questionId]);
  useEffect(() => { setQ(null); setChoice(null); setText(''); load(); }, [load]);
  useEffect(() => { if (q) titleRef.current?.focus(); }, [q?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // The agent replies or closes it while it's open here
  useSyncEvent('tracker_question', useCallback((event: { data?: Record<string, any> }) => {
    if (event?.data?.id === questionId) load();
  }, [questionId, load]));

  const active = q?.status === 'open' || q?.status === 'answered';
  const canSend = active && !busy && (!!choice || !!text.trim());
  // Closed while it's open here (the agent resolves it): the answer box and buttons go, and focus with them,
  // so Escape no longer reached the dialog; the title takes it
  useEffect(() => {
    if (q && !active && !titleRef.current?.closest('[role="dialog"]')?.contains(document.activeElement)) titleRef.current?.focus();
  }, [q?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!q || !canSend) return;
    setBusy(true);
    try {
      const got = await trackerApi.replyQuestion(q.id, text.trim(), choice, sendKey.current.for(q.id, text.trim(), choice));
      sendKey.current.done();
      setQ(got);
      setText('');
      setChoice(null);
      notify(`Sent to ${q.asked_by}`);
      onChanged();
      // The send button is disabled once the box is empty, which drops focus to the page: keep it in the dialog,
      // so Escape and Tab still work there.
      requestAnimationFrame(() => (boxRef.current ?? titleRef.current)?.focus());
    } catch (e) {
      notify(errorText(e, "The answer wasn't sent"), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const resolve = async () => {
    if (!q || busy) return;
    setBusy(true);
    try {
      setQ(await trackerApi.resolveQuestion(q.id));
      notify('Resolved');
      onChanged();
    } catch (e) {
      notify(errorText(e, "It wasn't resolved"), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const footer = q && active ? (
    <div className="flex flex-col gap-2 w-full">
      <label htmlFor="question-answer" className="sr-only">Your answer</label>
      <textarea ref={boxRef} id="question-answer" rows={2} value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
        placeholder={q.options.length ? 'Add a note, or answer in your own words' : 'Your answer'}
        className="w-full px-2.5 py-2 rounded-lg border border-nb-border-strong bg-nb-raised text-[13.5px] text-nb-text resize-none" />
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-nb-text-2 mr-auto min-w-0 truncate">
          {choice ? `Answering: ${choice}` : q.status === 'answered' ? `Waiting for ${q.asked_by}` : 'Only you answer'}
        </span>
        <Button variant="secondary" icon={CheckCircle2} onClick={resolve} disabled={busy}>Resolve</Button>
        <Button variant="primary" icon={Check} onClick={send} disabled={!canSend}>Send answer</Button>
      </div>
    </div>
  ) : null;

  return (
    <PanelDialog open onClose={onClose} title="Question" variant={narrow ? 'sheet' : 'center'} width={760} footer={footer}>
      <div className="px-4 pb-5 flex flex-col gap-4 min-w-0">
        {error && !q && <p role="alert" className="m-0 text-[13px] text-nb-danger">{error}</p>}
        {!q && !error && <div className="py-10 flex justify-center"><Spinner size={20} /></div>}
        {q && (
          <>
            <div className="flex flex-col gap-1.5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap min-w-0 text-[12.5px] text-nb-text-2">
                <button type="button" onClick={() => onOpenTicket(q.ticket.key)}
                  className="font-mono text-xs text-nb-accent-text hover:underline shrink-0" title={`Open ${q.ticket.key}`}>
                  {q.ticket.key}
                </button>
                <span className="truncate min-w-0" title={q.ticket.title}>{q.ticket.title}</span>
              </div>
              <h3 ref={titleRef} tabIndex={-1} className="m-0 text-[17px] font-semibold leading-snug wrap-break-word outline-none">{q.title}</h3>
              <div className="flex items-center gap-2 flex-wrap text-[12px] text-nb-text-3">
                <Tag accent={q.status === 'open'}>{QUESTION_STATUS[q.status]}</Tag>
                <span>Asked by {q.asked_by} · {ago(q.created)} ago</span>
                {q.closed_by && <span>· {q.status === 'resolved' ? 'resolved' : 'withdrawn'} by {q.closed_by === 'user' ? 'you' : q.closed_by}</span>}
              </div>
            </div>
            {q.body.trim() && <Prose text={q.body} />}
            {q.options.length > 0 && (
              <div role="radiogroup" aria-label="Options" className="flex flex-col gap-2">
                {q.options.map((o) => {
                  const picked = choice === o.label;
                  const recommended = q.recommended === o.label;
                  return (
                    <button key={o.label} type="button" role="radio" aria-checked={picked} disabled={!active}
                      onClick={() => setChoice(picked ? null : o.label)}
                      className={`flex flex-col gap-1 w-full min-w-0 text-left rounded-lg border px-3 py-2.5 ${picked ? 'border-nb-accent bg-nb-accent-soft' : 'border-nb-border bg-nb-raised hover:bg-nb-hover'} disabled:opacity-70`}>
                      <span className="flex items-center gap-2 min-w-0">
                        <span aria-hidden className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${picked ? 'border-nb-accent bg-nb-accent' : 'border-nb-border-strong'}`} />
                        <span className="font-semibold text-[14px] text-nb-text truncate min-w-0" title={o.label}>{o.label}</span>
                        {recommended && <Tag accent>Recommended</Tag>}
                        {q.chosen === o.label && <Tag>You chose this</Tag>}
                      </span>
                      {o.detail && <span className="pl-[22px] text-[13px] text-nb-text-2 wrap-break-word">{o.detail}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <section aria-label="Replies" className="flex flex-col gap-2 min-w-0">
              <h4 className="m-0 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-nb-text-3">
                <MessageCircleQuestion size={13} strokeWidth={1.75} aria-hidden />Replies<span className="font-normal">{q.replies?.length ?? 0}</span>
              </h4>
              {(q.replies ?? []).length === 0 && <p className="m-0 text-[13px] text-nb-text-3">No replies yet.</p>}
              <ol className="m-0 p-0 list-none flex flex-col gap-2">
                {(q.replies ?? []).map((r) => (
                  <li key={r.id} className={`rounded-lg px-3 py-2 min-w-0 ${r.author === 'user' ? 'bg-nb-accent-soft' : 'bg-nb-surface'}`}>
                    <div className="flex items-center gap-2 flex-wrap text-[12px] text-nb-text-2">
                      <span className="font-semibold text-nb-text">{r.author === 'user' ? 'You' : r.author}</span>
                      <span title={new Date(r.ts * 1000).toLocaleString()}>{clockTime(r.ts)}</span>
                      {r.choice && <Tag accent>Chose {r.choice}</Tag>}
                    </div>
                    {r.body && <Prose text={r.body} className="mt-1 text-[14px]" />}
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </div>
    </PanelDialog>
  );
}
