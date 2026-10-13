// Markdown, text, JSON and log attachments read in the ticket: a document chip in the history, and
// a reader over the widget with the app's Markdown (no raw HTML, links in a new tab), copy, download and
// the arrow keys stepping through the ticket's documents. A long file goes on the page a piece at a time.
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, Download, FileText } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { IconButton, PanelDialog, Spinner } from '../ui';
import { MD_PLUGINS, TICKET_MD } from './TrackerMarkdown';
import type { Attachment } from './trackerApi';
import { DocKind, KIND_LABEL, docKind, prettyJson, sizeText, splitPieces } from './documentText';

export interface DocItem {
  attachment: Attachment;
  /** Who attached it and when */
  caption?: string;
}

export function DocumentChip({ attachment, onOpen }: { attachment: Attachment; onOpen: (id: string) => void }) {
  const kind = docKind(attachment) ?? 'text';
  return (
    <button type="button" data-attachment={attachment.id} data-document onClick={() => onOpen(attachment.id)}
      title={attachment.filename} aria-label={`Read ${attachment.filename}`}
      className="inline-flex items-center gap-2 min-w-0 max-w-full h-11 pl-2 pr-3 rounded-lg border border-nb-border bg-nb-raised text-left text-nb-text hover:border-nb-border-strong">
      <span className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md bg-nb-accent-soft text-nb-accent-text" aria-hidden>
        <FileText size={15} strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex flex-col">
        <span className="truncate text-[13px] leading-tight">{attachment.filename}</span>
        <span className="text-[11.5px] leading-tight text-nb-text-3 truncate">
          {KIND_LABEL[kind]}{attachment.size ? ` · ${sizeText(attachment.size)}` : ''}
        </span>
      </span>
    </button>
  );
}

// A reading page: real heading sizes and room between blocks
const READER_MD: Components = {
  ...TICKET_MD,
  p: ({ children }) => <p className="m-0 mb-3 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="m-0 mt-5 mb-2 first:mt-0 font-ui text-[22px] leading-tight font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="m-0 mt-5 mb-2 first:mt-0 font-ui text-[18px] leading-tight font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="m-0 mt-4 mb-1.5 first:mt-0 font-ui text-[16px] font-semibold">{children}</h3>,
  h4: ({ children }) => <h4 className="m-0 mt-3 mb-1 first:mt-0 font-ui text-[14.5px] font-semibold">{children}</h4>,
  ul: ({ children }) => <ul className="list-disc ml-5 mb-3 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal ml-5 mb-3 space-y-1">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="m-0 mb-3 pl-3 border-l-2 border-nb-border-strong text-nb-text-2">{children}</blockquote>,
  hr: () => <hr className="my-5 border-0 border-t border-nb-border" />,
  pre: ({ children }) => <pre className="m-0 mb-3 p-3 rounded-md bg-nb-raised overflow-x-auto text-[12.5px] [&>code]:p-0 [&>code]:bg-transparent">{children}</pre>,
  code: ({ children }) => <code className="px-1 rounded-sm bg-nb-raised font-mono text-[12.5px] wrap-break-word">{children}</code>,
};

const Piece = memo(function Piece({ text, kind }: { text: string; kind: DocKind }) {
  if (kind === 'markdown') return <ReactMarkdown remarkPlugins={MD_PLUGINS} components={READER_MD}>{text}</ReactMarkdown>;
  return <pre className="m-0 whitespace-pre-wrap wrap-break-word font-mono text-[12.5px] leading-relaxed">{text}{'\n'}</pre>;
});

type Loaded = { state: 'loading'; bytes: number } | { state: 'ready'; text: string } | { state: 'failed'; message: string };

/** The file's text, read as it arrives (a byte count while a big one loads) */
function useDocument(url: string | null): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading', bytes: 0 });
  useEffect(() => {
    if (!url) return;
    const abort = new AbortController();
    setLoaded({ state: 'loading', bytes: 0 });
    (async () => {
      try {
        const res = await fetch(url, { signal: abort.signal, credentials: 'same-origin' });
        if (!res.ok) throw new Error(res.status === 404 ? 'This file is no longer on the ticket.' : `Could not load the file (${res.status}).`);
        let text = '';
        if (res.body && typeof TextDecoder !== 'undefined') {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let bytes = 0;
          let last = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            text += decoder.decode(value, { stream: true });
            if (bytes - last > 64 * 1024) { last = bytes; setLoaded({ state: 'loading', bytes }); }
          }
          text += decoder.decode();
        } else {
          text = await res.text();
        }
        if (!abort.signal.aborted) setLoaded({ state: 'ready', text });
      } catch (e) {
        if (!abort.signal.aborted) setLoaded({ state: 'failed', message: e instanceof Error && e.message ? e.message : 'Could not load the file.' });
      }
    })();
    return () => abort.abort();
  }, [url]);
  return loaded;
}

/** The pieces on the page so far: one more each time the end comes into view, and the rest when the
 *  browser is idle, so a 1 MB file is readable at once and never holds up the page */
function usePieces(pieces: string[], key: string) {
  const [shown, setShown] = useState(1);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { setShown(1); }, [key]);
  useEffect(() => {
    if (shown >= pieces.length) return;
    const node = end.current;
    let observer: IntersectionObserver | undefined;
    if (node && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown((n) => Math.min(pieces.length, n + 1));
      }, { rootMargin: '1200px 0px' });
      observer.observe(node);
    }
    const idle = (window as any).requestIdleCallback as ((cb: () => void, o?: { timeout: number }) => number) | undefined;
    const handle = idle ? idle(() => setShown((n) => Math.min(pieces.length, n + 1)), { timeout: 400 })
      : window.setTimeout(() => setShown((n) => Math.min(pieces.length, n + 1)), 40);
    return () => {
      observer?.disconnect();
      if (idle) (window as any).cancelIdleCallback?.(handle); else window.clearTimeout(handle);
    };
  }, [shown, pieces.length]);
  return { shown: Math.min(shown, pieces.length), end };
}

function Body({ item }: { item: DocItem }) {
  const a = item.attachment;
  const kind = docKind(a) ?? 'text';
  const loaded = useDocument(a.url);
  const text = loaded.state === 'ready' ? (kind === 'json' ? prettyJson(loaded.text) : loaded.text) : '';
  const pieces = useMemo(() => (loaded.state === 'ready' ? splitPieces(text, kind) : []), [loaded.state, text, kind]);
  const { shown, end } = usePieces(pieces, a.id);

  if (loaded.state === 'loading') {
    return (
      <div className="p-10 flex flex-col items-center gap-2 text-[13px] text-nb-text-3" role="status">
        <Spinner size={20} />
        <span>{loaded.bytes ? `Loading… ${sizeText(loaded.bytes)}${a.size ? ` of ${sizeText(a.size)}` : ''}` : 'Loading…'}</span>
      </div>
    );
  }
  if (loaded.state === 'failed') return <p className="m-0 p-8 text-center text-[13px] text-nb-danger-text">{loaded.message}</p>;
  if (!text.trim()) return <p className="m-0 p-8 text-center text-[13px] italic text-nb-text-3">This file is empty.</p>;
  return (
    <div data-document-body data-kind={kind} data-pieces={pieces.length} data-shown={shown}
      className={kind === 'markdown' ? 'font-read text-[16px] leading-relaxed text-nb-text wrap-break-word' : 'text-nb-text'}>
      {pieces.slice(0, shown).map((p, i) => <Piece key={i} text={p} kind={kind} />)}
      {shown < pieces.length && (
        <div ref={end} className="py-4 flex items-center gap-2 text-[12.5px] text-nb-text-3" role="status">
          <Spinner size={14} /> Showing {Math.round((shown / pieces.length) * 100)}%…
        </div>
      )}
    </div>
  );
}

export function DocumentReader({ items, index, onStep, onClose }: {
  items: DocItem[];
  index: number;
  onStep: (delta: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  const [copied, setCopied] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const id = item?.attachment.id;
  // Each document starts at the top, and the arrows keep working after Next or Previous was pressed
  // (Safari doesn't focus a clicked button, so focus would fall to the page)
  useEffect(() => {
    setCopied(false);
    scroller.current?.closest('.overflow-auto')?.scrollTo?.({ top: 0 });
    scroller.current?.focus({ preventScroll: true });
  }, [id]);
  if (!item) return null;
  const a = item.attachment;
  const many = items.length > 1;

  const arrows = (e: KeyboardEvent) => {
    if (!many || e.altKey || e.ctrlKey || e.metaKey) return;
    if ((e.target as HTMLElement).closest('textarea, input, select, [contenteditable="true"]')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); onStep(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); onStep(1); }
  };
  const copy = async () => {
    try {
      const res = await fetch(a.url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error();
      let text = await res.text();
      if (docKind(a) === 'json') text = prettyJson(text);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <PanelDialog open onClose={onClose} title={a.filename} width={860}
      footer={
        <div className="flex items-center gap-1.5 min-w-0 w-full" onKeyDown={arrows}>
          {many && <IconButton icon={ChevronLeft} label="Previous document" onClick={() => onStep(-1)} />}
          <p className="m-0 flex-1 min-w-0 text-xs text-nb-text-2 truncate" title={item.caption}>
            {[KIND_LABEL[docKind(a) ?? 'text'], sizeText(a.size), item.caption].filter(Boolean).join(' · ')}
          </p>
          {many && <span className="shrink-0 text-xs text-nb-text-3 tabular-nums">{index + 1} of {items.length}</span>}
          <IconButton icon={copied ? Check : Copy} label={copied ? 'Copied' : 'Copy the text'} onClick={copy} />
          <a href={a.url} download={a.filename}
            className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg text-nb-text-2 hover:bg-nb-hover hover:text-nb-text"
            aria-label={`Download ${a.filename}`} title="Download">
            <Download size={15} strokeWidth={1.75} aria-hidden />
          </a>
          {many && <IconButton icon={ChevronRight} label="Next document" onClick={() => onStep(1)} />}
        </div>
      }>
      <div ref={scroller} tabIndex={-1} data-autofocus onKeyDown={arrows}
        aria-label={many ? `${a.filename}; left and right arrows step through the ticket's documents` : a.filename}
        className="outline-hidden px-5 pb-6 pt-1">
        <div className="mx-auto w-full max-w-[72ch] min-w-0">
          <Body key={a.id} item={item} />
        </div>
      </div>
    </PanelDialog>
  );
}
