import { HARD_PIECE, docKind, prettyJson, sizeText, splitPieces } from '../documentText';

// Which ticket files open in the reader, and how a long file is cut into whole Markdown pieces
const att = (id: string, filename: string, mime = 'application/octet-stream') => ({ id, filename, mime, size: 1, url: `/a/${id}` });

describe('documentText', () => {
  it('knows documents by type or by name', () => {
    expect(docKind(att('1', 'chapter-2_all-models.md'))).toBe('markdown');
    expect(docKind(att('2', 'notes', 'text/markdown; charset=utf-8'))).toBe('markdown');
    expect(docKind(att('3', 'declines.json'))).toBe('json');
    expect(docKind(att('4', 'suite-tail.txt'))).toBe('text');
    expect(docKind(att('5', 'server.log'))).toBe('text');
    expect(docKind(att('6', 'x', 'text/plain'))).toBe('text');
    expect(docKind(att('7', 'shot.png', 'image/png'))).toBeNull();
    expect(docKind(att('8', 'report.pdf', 'application/pdf'))).toBeNull();
  });

  it('indents JSON and leaves anything else as it came', () => {
    expect(prettyJson('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(prettyJson('not json {')).toBe('not json {');
  });

  it('cuts Markdown only at a blank line outside a code fence', () => {
    const para = 'word '.repeat(40).trim();
    const fence = ['```', ...Array(30).fill('code line here'), '', 'still code', '```'].join('\n');
    const text = [para, '', para, '', fence, '', para, '', para].join('\n');
    const pieces = splitPieces(text, 'markdown', 150);
    expect(pieces.length).toBeGreaterThan(2);
    expect(pieces.join('\n')).toBe(text);
    for (const p of pieces) expect((p.match(/```/g) ?? []).length % 2).toBe(0);
  });

  it('cuts text at line breaks and keeps every character', () => {
    const text = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
    const pieces = splitPieces(text, 'text', 1000);
    expect(pieces.length).toBeGreaterThan(30);
    expect(pieces.join('\n')).toBe(text);
    expect(splitPieces('short', 'text')).toEqual(['short']);
  });

  it('says sizes plainly', () => {
    expect(sizeText(512)).toBe('512 B');
    expect(sizeText(89036)).toBe('87 KB');
    expect(sizeText(1_200_000)).toBe('1.1 MB');
  });

  // A file that is one code fence, an unclosed fence or one long line must not become one huge piece
  // (laying it out at once stalls the page)
  const MB = 1_000_000;
  const codeLines = (n: number) => Array.from({ length: n }, (_, i) => `step ${i}: the lamp was trimmed and the bell rang`);
  const noFences = (pieces: string[]) => pieces.flatMap((p) => p.split('\n')).filter((l) => !/^\s*(```|~~~)/.test(l));

  it('cuts a 1 MB code fence into closed fences, keeping every line in order', () => {
    const body = codeLines(Math.ceil(MB / 48));
    const text = ['# Log', '', '```text', ...body, '```', '', 'after'].join('\n');
    const t0 = Date.now();
    const pieces = splitPieces(text, 'markdown');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(pieces.length).toBeGreaterThan(100);
    for (const p of pieces) {
      expect(p.length).toBeLessThanOrEqual(HARD_PIECE + 100);
      expect((p.match(/^```/gm) ?? []).length % 2).toBe(0);  // every piece's fences are closed
    }
    expect(pieces[1].startsWith('```text\n')).toBe(true);  // reopened with its language
    expect(noFences(pieces)).toEqual(noFences([text]));
  });

  it('cuts an unclosed fence the same way', () => {
    const text = ['intro', '', '~~~', ...codeLines(Math.ceil(MB / 48))].join('\n');
    const pieces = splitPieces(text, 'markdown');
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(HARD_PIECE + 100);
    expect(pieces.slice(1).every((p) => p.startsWith('~~~'))).toBe(true);
    expect(noFences(pieces)).toEqual(noFences([text]));
  });

  it('cuts a 1 MB single-line log into pieces that join back exactly', () => {
    const line = 'x'.repeat(MB);
    const pieces = splitPieces(line, 'text');
    expect(pieces.length).toBe(Math.ceil(MB / HARD_PIECE));
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(HARD_PIECE);
    expect(pieces.join('')).toBe(line);
  });

  it('cuts a long prose line at a space', () => {
    const line = 'the keeper climbed the stair '.repeat(1000).trim();
    const pieces = splitPieces(line, 'markdown');
    expect(pieces.length).toBeGreaterThan(2);
    for (const p of pieces.slice(1)) expect(p.startsWith(' ')).toBe(true);  // each cut fell on a space
    expect(pieces.join('')).toBe(line);
  });
});
