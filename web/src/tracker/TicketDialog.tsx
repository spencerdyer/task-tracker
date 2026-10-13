// A ticket with its history. In User acceptance it opens with the owner's
// review bar: Approve → Done, or Send back with a note. No agent can do either.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Check, FileText, Film, Lock, Paperclip, X } from 'lucide-react';
import { Button, IconButton, MenuButton, PanelDialog, Select, Spinner, type MenuItem } from '../ui';
import { useSyncEvent } from '../live/LiveProvider';
import { Attachment, Question, STATUSES, Status, Ticket, TicketEvent, TicketLink, clockTime, errorText, statusName, trackerApi } from './trackerApi';
import { QuestionCard } from './QuestionsView';
import { PriorityTag } from './TrackerWidget';
import { ImageViewer, ViewerItem } from './ImageViewer';
import { DraftKey, fileSig } from '../lib/http';
import { TicketMarkdown } from './TrackerMarkdown';
import { AudioAttachment, isAudio } from './AudioAttachment';
import { DocItem, DocumentChip, DocumentReader } from './DocumentReader';
import { isDocument } from './documentText';

const H3 = 'm-0 mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-nb-text-3';

export function Prose({ text, className = '' }: { text: string; className?: string }) {
  // Empty scope or acceptance: a muted note, not "None", which read as the ticket's own text
  if (!text.trim()) return <p className={`m-0 text-[13px] italic text-nb-text-3 ${className}`}>Not written yet</p>;
  // Markdown (lists, code, links, as in the project chat); the editor keeps the raw text
  return <div className={`font-read text-[15px] leading-relaxed text-nb-text wrap-break-word min-w-0 ${className}`}><TicketMarkdown text={text} /></div>;
}

function Links({ list, onOpen }: { list: TicketLink[]; onOpen: (key: string) => void }) {
  if (!list.length) return <span className="text-[13px] text-nb-text-3">None</span>;
  return (
    <div className="flex flex-col gap-1">
      {list.map((d) => (
        <button key={d.key} type="button" onClick={() => onOpen(d.key)}
          className="flex items-baseline gap-1.5 text-left text-[13px] text-nb-accent-text hover:underline min-w-0">
          <span className="font-mono text-xs shrink-0">{d.key}</span>
          <span className="truncate text-nb-text" title={d.title}>{d.title}</span>
          <span className="shrink-0 text-[11.5px] text-nb-text-3">{statusName(d.status)}</span>
        </button>
      ))}
    </div>
  );
}

function who(ev: TicketEvent) {
  return ev.author === 'user' ? 'You' : ev.author;
}

// By type, or by name for files uploaded as application/octet-stream
export const isImage = (a: Attachment) => a.mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif)$/i.test(a.filename);
export const isVideo = (a: Attachment) => a.mime.startsWith('video/') || /\.(mp4|m4v|webm|mov)$/i.test(a.filename);

export function EventRow({ ev, onView, onRead }: {
  ev: TicketEvent;
  onView: (attachmentId: string) => void;
  /** Open a Markdown / text / JSON / log file in the reader */
  onRead?: (attachmentId: string) => void;
}) {
  const files = ev.attachments;
  const images = files.filter(isImage);
  const sounds = files.filter((a) => !isImage(a) && isAudio(a));
  const docs = onRead ? files.filter((a) => !isImage(a) && !isAudio(a) && isDocument(a)) : [];
  const others = files.filter((a) => !isImage(a) && !isAudio(a) && !docs.includes(a));
  const via = ev.token ? <span className="text-nb-text-3"> via “{ev.token}”</span> : null;
  const header = (() => {
    if (ev.kind === 'status') return <>moved {statusName(ev.status_from ?? '')} → {statusName(ev.status_to ?? '')}</>;
    if (ev.kind === 'created') return <>created the ticket</>;
    if (ev.kind === 'edit') return <>edited</>;
    if (ev.kind === 'note') return <>added a note</>;
    if (ev.kind === 'comment') return <>commented</>;
    return null;
  })();
  const boxed = ev.kind === 'verification' || ev.kind === 'comment' || ev.kind === 'note' || (ev.kind === 'status' && ev.body);
  const content = (
    <>
      <div className="flex items-center gap-2 flex-wrap text-[12.5px] text-nb-text-2">
        {ev.kind === 'verification' && (
          <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-nb-success-soft text-nb-success font-semibold text-[11.5px]">
            <Check size={11} strokeWidth={2} aria-hidden /> Verification
          </span>
        )}
        <span><b className="font-semibold text-nb-text">{who(ev)}</b>{via} {header}</span>
        <span className="text-nb-text-3">· {clockTime(ev.ts)}</span>
      </div>
      {ev.body && ev.kind !== 'edit' && <Prose text={ev.body} className="text-[14.5px] mt-1" />}
      {ev.kind === 'edit' && ev.body && <p className="m-0 mt-0.5 text-[12.5px] text-nb-text-3">{ev.body}</p>}
      {images.length > 0 && (
        <div className="flex gap-2 flex-wrap mt-2">
          {images.map((a) => (
            <button key={a.id} type="button" data-attachment={a.id} onClick={() => onView(a.id)} title={a.filename} aria-label={`View ${a.filename}`}
              className="block w-[150px] h-[96px] p-0 rounded-lg overflow-hidden border border-nb-border-strong bg-nb-selected hover:border-nb-accent">
              <img src={a.url} alt={a.filename} loading="lazy" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {sounds.length > 0 && (
        <div className="flex flex-col gap-1.5 mt-2 min-w-0">
          {sounds.map((a) => <AudioAttachment key={a.id} attachment={a} />)}
        </div>
      )}
      {docs.length > 0 && onRead && (
        <div className="flex gap-1.5 flex-wrap mt-2 min-w-0">
          {docs.map((a) => <DocumentChip key={a.id} attachment={a} onOpen={onRead} />)}
        </div>
      )}
      {others.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mt-2">
          {others.map((a) => isVideo(a) ? (
            <button key={a.id} type="button" data-attachment={a.id} onClick={() => onView(a.id)}
              className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-nb-border bg-nb-raised text-[12.5px] text-nb-text hover:border-nb-border-strong max-w-full">
              <Film size={13} strokeWidth={1.75} className="shrink-0" aria-hidden />
              <span className="truncate">{a.filename}</span>
            </button>
          ) : (
            <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-nb-border bg-nb-raised text-[12.5px] text-nb-text hover:border-nb-border-strong max-w-full">
              <FileText size={13} strokeWidth={1.75} className="shrink-0" aria-hidden />
              <span className="truncate">{a.filename}</span>
            </a>
          ))}
        </div>
      )}
    </>
  );
  return boxed
    ? <div className={`px-3.5 py-3 rounded-[10px] border ${ev.author === 'user' ? 'bg-nb-accent-soft border-transparent' : 'bg-nb-raised border-nb-border'}`}>{content}</div>
    : <div>{content}</div>;
}

export default function TicketDialog({ ticketKey, narrow, stacked, onClose, onOpen, onEdit, onChanged, notify, moveItems, nextReview, reviewLeft = 0, machineNames = {}, onOpenQuestion }: {
  ticketKey: string;
  narrow: boolean;
  /** Too tight for the side column: details go under the history */
  stacked: boolean;
  onClose: () => void;
  onOpen: (key: string) => void;
  onEdit: (key: string) => void;
  onChanged: () => void;
  notify: (message: string, opts?: { tone?: 'info' | 'error' }) => void;
  /** The board's Move to… items for this ticket: on a touch screen there's no drag or right-click */
  moveItems?: (t: Ticket) => MenuItem[];
  /** The next ticket waiting for review, offered once this one is approved or sent back */
  nextReview?: string | null;
  reviewLeft?: number;
  /** Machine keys → names, so details read 'Render box', not 'gpu' */
  machineNames?: Record<string, string>;
  /** Opens one of the ticket's questions */
  onOpenQuestion?: (id: number) => void;
}) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const reviewBox = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Review next swaps the ticket inside the open dialog: once the next one is in, its title takes focus,
  // so a screen reader reads the new ticket instead of the page
  const shownKey = useRef(ticketKey);
  useEffect(() => {
    if (!ticket || ticket.key !== ticketKey || shownKey.current === ticketKey) return;
    shownKey.current = ticketKey;
    titleRef.current?.focus();
  }, [ticket, ticketKey]);
  const [backTo, setBackTo] = useState<Status>('todo');
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // The attachment open in the viewer
  const [viewing, setViewing] = useState<string | null>(null);
  // The document open in the reader
  const [reading, setReading] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTicket(await trackerApi.ticket(ticketKey));
      setError(null);
    } catch (e) {
      setError(errorText(e, 'Could not load the ticket'));
    }
  }, [ticketKey]);
  useEffect(() => { setTicket(null); setReview(''); setReviewed(false); setComment(''); setFiles([]); load(); }, [load]);
  // Agents' questions on this ticket, open ones first
  const [questions, setQuestions] = useState<Question[]>([]);
  const loadQuestions = useCallback(() => {
    trackerApi.questions(ticketKey.split('-')[0], { ticket: ticketKey }).then((r) => setQuestions(r.questions)).catch(() => {});
  }, [ticketKey]);
  useEffect(() => { setQuestions([]); loadQuestions(); }, [loadQuestions]);
  useSyncEvent('tracker_question', useCallback((event: { data?: Record<string, any> }) => {
    if (event?.data?.ticket === ticketKey) loadQuestions();
  }, [ticketKey, loadQuestions]));
  useSyncEvent('tracker_changed', useCallback((event: { data?: Record<string, any> }) => {
    if (event?.data?.ticket === ticketKey) load();
  }, [ticketKey, load]));

  // A second press after a lost answer gets the first answer back, not a second comment or a
  // "can't move from Done" error
  const moveKey = useRef(new DraftKey());
  const commentKey = useRef(new DraftKey());
  const move = async (status: Status, note = '') => {
    const t = await trackerApi.move(ticketKey, status, note, undefined, moveKey.current.for(ticketKey, status, note));
    moveKey.current.done();
    return t;
  };

  const act = async (fn: () => Promise<Ticket>, done: string) => {
    setBusy(true);
    try {
      setTicket(await fn());
      onChanged();
      notify(done);
      return true;
    } catch (e) {
      notify(errorText(e), { tone: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const reviewDone = (ok: boolean) => {
    if (!ok) return;
    setReview(''); setReviewed(true);
    // With nothing left to review the Review next button doesn't come: the title takes focus
    if (!nextReview) requestAnimationFrame(() => titleRef.current?.focus());
  };
  const approve = () => act(() => move('done', review.trim()), `${ticketKey} approved`).then(reviewDone);
  const sendBack = () => {
    if (!review.trim()) {
      notify('Say what must change, so the owner can act on it.', { tone: 'error' });
      reviewBox.current?.focus();  // the toast is at the panel's foot; the box is where to type
      return;
    }
    act(() => move(backTo, review.trim()), `${ticketKey} sent back to ${statusName(backTo)}`).then(reviewDone);
  };
  const moveTo = (status: Status) => act(() => move(status), `${ticketKey} moved to ${statusName(status)}`);
  const sendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim() && !files.length) return;
    const ok = await act(() => trackerApi.comment(ticketKey, comment, files, commentKey.current.for(ticketKey, comment, fileSig(files))), 'Comment added');
    if (ok) { commentKey.current.done(); setComment(''); setFiles([]); }
  };

  const t = ticket;
  const inUat = t?.status === 'uat';
  const lastAgent = t ? [...t.events].reverse().find((e) => e.author !== 'user' && e.token)?.token : null;
  // Every picture and video on the ticket, in the order the history shows them (newest event first)
  const viewable: ViewerItem[] = t ? [...t.events].reverse().flatMap((ev) => ev.attachments
    .filter((a) => isImage(a) || isVideo(a))
    .map((a) => ({ key: a.id, src: a.url, title: a.filename, video: isVideo(a), download: a.url,
      caption: [who(ev), ev.kind === 'created' ? 'created the ticket' : ev.kind, clockTime(ev.ts), ev.body.split('\n')[0].slice(0, 120)].filter(Boolean).join(' · ') }))) : [];
  const viewIndex = viewing ? viewable.findIndex((v) => v.key === viewing) : -1;
  // Every Markdown, text, JSON and log file, in the same order, for the reader
  const documents: DocItem[] = t ? [...t.events].reverse().flatMap((ev) => ev.attachments
    .filter((a) => !isImage(a) && !isAudio(a) && isDocument(a))
    .map((a) => ({ attachment: a, caption: [who(ev), clockTime(ev.ts)].join(' · ') }))) : [];
  const readIndex = reading ? documents.findIndex((d) => d.attachment.id === reading) : -1;
  const closeReader = () => {
    const id = reading;
    setReading(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-attachment="${id}"]`)?.focus());
  };
  const stepRead = (delta: number) => {
    if (readIndex < 0 || !documents.length) return;
    setReading(documents[(readIndex + delta + documents.length) % documents.length].attachment.id);
  };
  // Back to the picture's thumbnail: Safari doesn't focus a clicked button, so the viewer can't
  const closeViewer = () => {
    const id = viewing;
    setViewing(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-attachment="${id}"]`)?.focus());
  };
  const stepView = (delta: number) => {
    if (viewIndex < 0 || !viewable.length) return;
    setViewing(viewable[(viewIndex + delta + viewable.length) % viewable.length].key);
  };

  return (
    <>
    <PanelDialog open onClose={onClose} title={t ? t.key : ticketKey} variant={narrow ? 'sheet' : 'center'} width={1040}>
      {!t ? (
        <div className="p-8 flex justify-center">{error ? <p className="m-0 text-[13px] text-nb-danger-text">{error}</p> : <Spinner size={20} />}</div>
      ) : (
        <div className="px-4 pb-5 flex flex-col gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center h-[22px] px-2 rounded-full text-xs font-semibold border ${inUat ? 'bg-nb-accent-soft text-nb-accent-text border-transparent' : 'bg-nb-raised text-nb-text-2 border-nb-border'}`}>
              {statusName(t.status)}
            </span>
            <PriorityTag priority={t.priority} />
            {t.owner && (
              <span className="inline-flex items-center gap-1 h-[22px] px-2 rounded-full text-xs bg-nb-raised border border-nb-border text-nb-text-2 min-w-0">
                <Bot size={12} strokeWidth={1.75} className="shrink-0" aria-hidden /><span className="truncate">{t.owner}</span>
              </span>
            )}
            {lastAgent && <span className="text-[12.5px] text-nb-text-3">via token “{lastAgent}”</span>}
            {t.reopened ? <span className="inline-flex items-center h-[22px] px-2 rounded-full text-xs bg-nb-danger-soft text-nb-danger-text">sent back</span> : null}
            <span className="flex-1" />
            {moveItems && (
              <MenuButton items={moveItems(t)} label={`Move ${t.key}`}>
                {(p) => <Button {...p} variant="secondary">Move…</Button>}
              </MenuButton>
            )}
            <Button variant="secondary" onClick={() => onEdit(t.key)}>Edit</Button>
          </div>
          <h3 ref={titleRef} tabIndex={-1} className="m-0 text-xl leading-snug font-semibold wrap-break-word focus:outline-hidden">{t.title}</h3>

          {!inUat && reviewed && nextReview && (
            <div className="flex items-center gap-2 flex-wrap p-3 rounded-xl bg-nb-surface border border-nb-border">
              <span className="text-[13px] text-nb-text-2 mr-auto">
                {reviewLeft === 1 ? '1 more waiting for your review.' : `${reviewLeft} more waiting for your review.`}
              </span>
              {/* Approve took its own button away: focus moves here, not to the page */}
              <Button variant="primary" autoFocus onClick={() => onOpen(nextReview)}>Review next: {nextReview}</Button>
            </div>
          )}

          {inUat && (
            <div className="flex flex-col gap-2.5 p-3.5 rounded-xl bg-nb-accent-soft border"
              style={{ borderColor: 'color-mix(in srgb, var(--nb-accent) 40%, transparent)' }}>
              <label htmlFor="tracker-review" className="text-[13px] font-semibold">Your review</label>
              <textarea ref={reviewBox} id="tracker-review" rows={2} value={review} onChange={(e) => setReview(e.target.value)}
                placeholder="What you checked, or what must change if you send it back"
                className="w-full px-2.5 py-2 rounded-lg border border-nb-border-strong bg-nb-raised text-[13.5px] text-nb-text resize-y" />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-xs text-nb-text-2 mr-auto">
                  <Lock size={12} strokeWidth={1.75} aria-hidden /> Only you can approve. No access token can.
                </span>
                <Select label="Send back to" size="sm" value={backTo} onChange={(e) => setBackTo(e.target.value as Status)}
                  options={STATUSES.filter((s) => s.key !== 'uat' && s.key !== 'done').map((s) => ({ value: s.key, label: `Back to ${s.name}` }))} />
                <Button variant="danger" onClick={sendBack} disabled={busy}>Send back</Button>
                <button type="button" onClick={approve} disabled={busy}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-nb-success text-nb-bg text-[13px] font-semibold hover:brightness-110 disabled:opacity-60">
                  <Check size={15} strokeWidth={2} aria-hidden /> Approve → Done
                </button>
              </div>
            </div>
          )}

          <div className={`flex gap-6 ${stacked ? 'flex-col' : ''}`}>
            <div className="flex-1 min-w-0 flex flex-col gap-4">
              {questions.length > 0 && (
                <div>
                  <h4 className={H3}>Questions</h4>
                  <div className="flex flex-col gap-2">
                    {questions.map((q) => <QuestionCard key={q.id} q={q} onOpen={(id) => onOpenQuestion?.(id)} />)}
                  </div>
                </div>
              )}
              <div><h4 className={H3}>Scope</h4><Prose text={t.scope} /></div>
              <div><h4 className={H3}>Acceptance</h4><Prose text={t.acceptance} /></div>
              <div>
                <h4 className={H3}>History</h4>
                <div className="flex flex-col gap-3 border-l-2 border-nb-border ml-1.5 pl-4">
                  {[...t.events].reverse().map((ev) => <EventRow key={ev.id} ev={ev} onView={setViewing} onRead={setReading} />)}
                </div>
              </div>
            </div>
            <aside className={`flex flex-col gap-4 ${stacked ? '' : 'w-[280px] shrink-0'}`}>
              <div>
                <h4 className={H3}>Details</h4>
                <dl className="m-0 grid grid-cols-[90px_1fr] gap-y-1.5 text-[13px]">
                  <dt className="text-nb-text-3">Status</dt>
                  <dd className="m-0">
                    <Select label="Status" size="sm" block value={t.status}
                      onChange={(e) => {
                        const next = e.target.value as Status;
                        if (inUat && next !== 'done') { notify('Use Send back in the review bar, with a note.'); return; }
                        moveTo(next);
                      }}
                      options={STATUSES.map((s) => ({ value: s.key, label: s.name }))} />
                  </dd>
                  <dt className="text-nb-text-3">Owner</dt><dd className="m-0 wrap-break-word">{t.owner || '—'}</dd>
                  <dt className="text-nb-text-3">Labels</dt><dd className="m-0 wrap-break-word">{t.labels.join(', ') || '—'}</dd>
                  <dt className="text-nb-text-3">Machines</dt>
                  <dd className="m-0 wrap-break-word">
                    {(t.resources ?? []).map((r) => machineNames[r] ?? r).join(', ') || '—'}
                    {(t.waiting_for ?? []).map((w) => (
                      <span key={w.resource} className="block text-xs text-nb-warning">Waiting for {w.name} ({w.held_by.join(', ')})</span>
                    ))}
                  </dd>
                  <dt className="text-nb-text-3">Created</dt><dd className="m-0">{clockTime(t.created)}</dd>
                  <dt className="text-nb-text-3">Updated</dt><dd className="m-0">{clockTime(t.updated)}</dd>
                </dl>
              </div>
              <div><h4 className={H3}>Depends on</h4><Links list={t.dependencies} onOpen={onOpen} /></div>
              <div><h4 className={H3}>Blocks</h4><Links list={t.blocks} onOpen={onOpen} /></div>
              <form onSubmit={sendComment} className="flex flex-col gap-2 pt-3 border-t border-nb-border">
                {/* Name the agent it's for: "the owner" read as you, who own the board */}
                <label htmlFor="tracker-comment" className={H3}>{t.owner ? `Comment for ${t.owner}` : 'Comment'}</label>
                <textarea id="tracker-comment" rows={4} value={comment} onChange={(e) => setComment(e.target.value)}
                  placeholder={t.owner ? `${t.owner} sees it at the start of their next turn` : 'Add a comment'}
                  className="w-full px-2.5 py-2 rounded-lg border border-nb-border-strong bg-nb-raised text-[13.5px] text-nb-text resize-y" />
                {files.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {files.map((f, i) => (
                      <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 h-6 pl-2 pr-0.5 rounded-full bg-nb-raised border border-nb-border text-xs max-w-full">
                        <span className="truncate">{f.name}</span>
                        <IconButton icon={X} label={`Remove ${f.name}`} size="sm" onClick={() => setFiles(files.filter((_, j) => j !== i))} />
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input ref={fileInput} type="file" multiple hidden accept="image/*,.txt,.md,.json,.log,.pdf"
                    onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
                  <IconButton icon={Paperclip} label="Attach files" variant="outline" onClick={() => fileInput.current?.click()} />
                  <Button type="submit" variant="secondary" className="flex-1" disabled={busy || (!comment.trim() && !files.length)}>Add comment</Button>
                </div>
              </form>
            </aside>
          </div>
        </div>
      )}
    </PanelDialog>
    {/* A sibling of the ticket's dialog, so it covers the widget and its Escape closes only the viewer */}
    {viewIndex >= 0 && <ImageViewer items={viewable} index={viewIndex} onStep={stepView} onClose={closeViewer} />}
    {readIndex >= 0 && <DocumentReader items={documents} index={readIndex} onStep={stepRead} onClose={closeReader} />}
    </>
  );
}
