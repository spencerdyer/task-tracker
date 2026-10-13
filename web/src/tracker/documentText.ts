// Plain helpers for the ticket document reader; kept apart from react-markdown so jest can test them
import type { Attachment } from './trackerApi';

export type DocKind = 'markdown' | 'json' | 'text';

/** Markdown, plain text, JSON and logs: by type, or by name for files uploaded as octet-stream */
export function docKind(a: Pick<Attachment, 'filename' | 'mime'>): DocKind | null {
  const name = a.filename.toLowerCase();
  const mime = (a.mime || '').toLowerCase();
  if (/\.(md|markdown)$/.test(name) || mime.startsWith('text/markdown')) return 'markdown';
  if (/\.json$/.test(name) || mime.startsWith('application/json')) return 'json';
  if (/\.(txt|log)$/.test(name) || mime.startsWith('text/plain')) return 'text';
  return null;
}

export const isDocument = (a: Pick<Attachment, 'filename' | 'mime'>) => docKind(a) !== null;

export const KIND_LABEL: Record<DocKind, string> = { markdown: 'Markdown', json: 'JSON', text: 'Text' };

export function sizeText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** JSON indented for reading; anything that doesn't parse (or is huge) is shown as it came */
export function prettyJson(text: string): string {
  if (text.length > 4_000_000) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** No piece is longer than this (plus a fence line): one long block laid out at once froze the page */
export const HARD_PIECE = 8_000;

const FENCE = /^\s*(`{3,}|~{3,})/;

/**
 * The text cut into pieces of about `target` characters, so a long file is put on the page a piece at a
 * time instead of all at once. Markdown is cut at a blank line outside a code fence (a piece is whole
 * Markdown), text and JSON at a line break. Past `hard` characters a piece is cut anyway: inside a code
 * fence the fence is closed there and opened again in the next piece, and a line longer than `hard` is cut
 * itself (prose at a space where there is one), so a file that is one fence, an unclosed fence or one long
 * line can't become one huge block.
 */
export function splitPieces(text: string, kind: DocKind, target = 6_000, hard = HARD_PIECE): string[] {
  if (text.length <= target) return [text];
  const pieces: string[] = [];
  let current: string[] = [];
  let size = 0;
  let added = 0;  // lines of the file in `current` (not a reopened fence)
  let fence: string | null = null;  // the open fence's first line
  const flush = () => {
    if (added) pieces.push(current.join('\n'));
    current = []; size = 0; added = 0;
  };
  // Cut here, closing an open fence and opening it again in the next piece
  const cut = () => {
    if (!added) return;
    if (fence) current.push(fence.match(FENCE)![1]);
    flush();
    if (fence) { current.push(fence); size = fence.length + 1; }
  };
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    while (line.length > hard) {
      let at = kind === 'markdown' && !fence ? line.lastIndexOf(' ', hard) : -1;
      if (at < hard / 2) at = hard;
      cut();
      current.push(line.slice(0, at)); added++;
      cut();
      line = line.slice(at);
    }
    if (kind === 'markdown') {
      const marker = line.match(FENCE);
      if (marker) fence = fence ? (marker[1][0] === fence.match(FENCE)![1][0] ? null : fence) : line;
    }
    current.push(line); added++;
    size += line.length + 1;
    if (i === lines.length - 1) break;
    if (size >= target && (kind !== 'markdown' || (!fence && !line.trim()))) flush();
    else if (size >= hard) cut();
  }
  flush();
  return pieces;
}
