// Review mode: the tickets waiting for review, one at a time, oldest
// first: the acceptance beside the latest verification (attachments inline), then Approve, Send back (a
// note needed) or Skip, and the next is already fetched. A to approve, S to send back, N to skip, while
// the note isn't being typed in. Only the signed-in owner can approve; the server enforces it.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Lock } from 'lucide-react';
import { Button, PanelDialog, Spinner } from '../ui';
import { DraftKey } from '../lib/http';
import { ImageViewer, ViewerItem } from './ImageViewer';
import { Ticket, errorText, trackerApi } from './trackerApi';
import { EventRow, Prose, isImage, isVideo } from './TicketDialog';
import { DocItem, DocumentReader } from './DocumentReader';
import { isDocument } from './documentText';
import { isAudio } from './AudioAttachment';
import { PriorityTag } from './TrackerWidget';

type Outcome = 'approved' | 'sent back' | 'skipped';

const H3 = 'm-0 mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-nb-text-3';

export default function ReviewMode({ queue, narrow, onClose, onChanged, notify }: {
  /** Ticket keys, oldest first */
  queue: string[];
  narrow: boolean;
  onClose: () => void;
  onChanged: () => void;
  notify: (message: string, opts?: { tone?: 'info' | 'error' }) => void;
}) {
  const [position, setPosition] = useState(0);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [finished, setFinished] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [said, setSaid] = useState('');  // the live region: what a screen reader hears after each step
  const prefetched = useRef(new Map<string, Promise<Ticket>>());
  const titleRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const moveKey = useRef(new DraftKey());
  const key = queue[position];

  const fetchTicket = useCallback((k: string) => {
    let p = prefetched.current.get(k);
    if (!p) {
      p = trackerApi.ticket(k);
      prefetched.current.set(k, p);
      p.catch(() => prefetched.current.delete(k));  // a failed prefetch is fetched again when shown
    }
    return p;
  }, []);

  // Show this ticket (instantly when it was prefetched), then fetch the next one while it's read
  useEffect(() => {
    if (finished || !key) return;
    let live = true;
    setError(null);
    fetchTicket(key).then((t) => {
      if (!live) return;
      setTicket(t);
      prefetched.current.delete(key);
      setSaid(`Reviewing ${position + 1} of ${queue.length}: ${t.key}, ${t.title}`);
      if (position + 1 < queue.length) fetchTicket(queue[position + 1]).catch(() => {});
    }).catch((e) => { if (live) setError(errorText(e, 'Could not load the ticket')); });
    return () => { live = false; };
  }, [key, position, finished, queue, fetchTicket]);

  const advance = (outcome: Outcome) => {
    setOutcomes((o) => ({ ...o, [key]: outcome }));
    setNote('');
    if (position + 1 >= queue.length) {
      setFinished(true);
      setTicket(null);
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setPosition(position + 1);
  };

  const move = async (status: 'done' | 'todo', outcome: Outcome) => {
    if (status === 'todo' && !note.trim()) {
      notify('Say what must change, so the owner can act on it.', { tone: 'error' });
      noteRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await trackerApi.move(key, status, note.trim(), undefined, moveKey.current.for(key, status, note.trim()));
      moveKey.current.done();
      notify(status === 'done' ? `${key} approved` : `${key} sent back to To do`);
      onChanged();  // the board catches up behind the dialog
      advance(outcome);
    } catch (e) {
      notify(errorText(e), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const inUat = ticket?.status === 'uat';
  const approve = () => { if (!busy && inUat) move('done', 'approved'); };
  const sendBack = () => { if (!busy && inUat) move('todo', 'sent back'); };
  const skip = () => { if (!busy && ticket) advance('skipped'); };

  // A, S, N inside the dialog, never while typing the note (or any field)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (finished || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.closest('textarea, input, select, [contenteditable="true"]')) return;
    const k = e.key.toLowerCase();
    if (k === 'a') { e.preventDefault(); approve(); }
    else if (k === 's') { e.preventDefault(); if (note.trim()) sendBack(); else noteRef.current?.focus(); }
    else if (k === 'n') { e.preventDefault(); skip(); }
  };

  const t = ticket?.key === key ? ticket : null;
  // Each ticket's title takes focus once it's on screen, so a screen reader reads it and A / S / N keep
  // working: between tickets the title unmounts and focus fell to the page
  const shownKey = t?.key;
  useEffect(() => { if (shownKey) titleRef.current?.focus(); }, [shownKey]);
  const verification = t ? [...t.events].reverse().find((ev) => ev.kind === 'verification') : undefined;
  const viewable: ViewerItem[] = (verification?.attachments ?? []).filter((a) => isImage(a) || isVideo(a))
    .map((a) => ({ key: a.id, src: a.url, title: a.filename, video: isVideo(a), download: a.url }));
  const viewIndex = viewing ? viewable.findIndex((v) => v.key === viewing) : -1;
  // The verification's Markdown, text, JSON and log files, in the reader
  const documents: DocItem[] = (verification?.attachments ?? []).filter((a) => !isImage(a) && !isAudio(a) && isDocument(a))
    .map((a) => ({ attachment: a }));
  const readIndex = reading ? documents.findIndex((d) => d.attachment.id === reading) : -1;
  const count = (o: Outcome) => Object.values(outcomes).filter((x) => x === o).length;

  const footer = !finished && t ? (
    <div className="flex flex-col gap-2 w-full" onKeyDown={onKeyDown}>
      {inUat ? (
        <>
          <label htmlFor="review-note" className="sr-only">Review note</label>
          <textarea ref={noteRef} id="review-note" rows={narrow ? 1 : 2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="What you checked, or what must change (needed to send back)"
            className="w-full px-2.5 py-2 rounded-lg border border-nb-border-strong bg-nb-raised text-[13.5px] text-nb-text resize-y" />
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-xs text-nb-text-2 mr-auto min-w-0">
              <Lock size={12} strokeWidth={1.75} aria-hidden className="shrink-0" />
              <span className="truncate">Only you can approve · <kbd>A</kbd> approve · <kbd>S</kbd> send back · <kbd>N</kbd> skip</span>
            </span>
            <Button variant="danger" onClick={sendBack} disabled={busy} aria-keyshortcuts="S">Send back</Button>
            <Button variant="secondary" onClick={skip} disabled={busy} aria-keyshortcuts="N">Skip</Button>
            <button type="button" onClick={approve} disabled={busy} aria-keyshortcuts="A"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-nb-success text-nb-bg text-[13px] font-semibold hover:brightness-110 disabled:opacity-60">
              <Check size={15} strokeWidth={2} aria-hidden /> Approve
            </button>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] text-nb-text-2 mr-auto">
            {t.status === 'done' ? 'Already approved.' : 'Not waiting for review any more.'}
          </span>
          <Button variant="primary" onClick={skip} aria-keyshortcuts="N">Next</Button>
        </div>
      )}
    </div>
  ) : null;

  return (
    <>
      <PanelDialog open onClose={onClose} title={finished ? 'Review' : `Review · ${position + 1} of ${queue.length}`}
        variant={narrow ? 'sheet' : 'center'} width={1040} footer={footer}>
        <div onKeyDown={onKeyDown} className="px-4 pb-5">
          <p className="sr-only" aria-live="polite">{said}</p>
          {finished ? (
            <div className="py-10 flex flex-col items-center gap-3 text-center">
              <h3 ref={summaryRef} tabIndex={-1} className="m-0 text-xl font-semibold focus:outline-hidden">Reviewed {Object.keys(outcomes).length}</h3>
              <p className="m-0 text-[14px] text-nb-text-2">
                {count('approved')} approved · {count('sent back')} sent back · {count('skipped')} skipped
              </p>
              <Button variant="primary" onClick={onClose} autoFocus>Back to the board</Button>
            </div>
          ) : !t ? (
            <div className="p-8 flex justify-center">{error ? <p className="m-0 text-[13px] text-nb-danger-text">{error}</p> : <Spinner size={20} />}</div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex-1 h-1.5 rounded-full bg-nb-border overflow-hidden" aria-hidden>
                  <div className="h-full bg-nb-accent" style={{ width: `${(position / queue.length) * 100}%` }} />
                </div>
                <span className="text-xs font-semibold text-nb-accent-text shrink-0">{position + 1} of {queue.length}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-nb-text-3">{t.key}</span>
                <PriorityTag priority={t.priority} />
                {t.owner && <span className="text-[12.5px] text-nb-text-2 truncate min-w-0">{t.owner}</span>}
                {t.reopened ? <span className="inline-flex items-center h-[22px] px-2 rounded-full text-xs bg-nb-danger-soft text-nb-danger-text">sent back before</span> : null}
              </div>
              <h3 ref={titleRef} tabIndex={-1} className="m-0 text-xl leading-snug font-semibold wrap-break-word focus:outline-hidden">{t.title}</h3>
              <div className={`flex gap-5 ${narrow ? 'flex-col' : ''}`}>
                <div className="flex-1 min-w-0"><h4 className={H3}>Acceptance</h4><Prose text={t.acceptance} /></div>
                <div className="flex-1 min-w-0">
                  <h4 className={H3}>Latest verification</h4>
                  {verification ? <EventRow ev={verification} onView={setViewing} onRead={setReading} />
                    : <p className="m-0 text-[13px] italic text-nb-text-3">No verification recorded</p>}
                </div>
              </div>
            </div>
          )}
        </div>
      </PanelDialog>
      {viewIndex >= 0 && (
        <ImageViewer items={viewable} index={viewIndex} onClose={() => setViewing(null)}
          onStep={(d) => setViewing(viewable[(viewIndex + d + viewable.length) % viewable.length].key)} />
      )}
      {readIndex >= 0 && (
        <DocumentReader items={documents} index={readIndex} onClose={() => setReading(null)}
          onStep={(d) => setReading(documents[(readIndex + d + documents.length) % documents.length].attachment.id)} />
      )}
    </>
  );
}
