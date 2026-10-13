// Plain-text helpers for the Tracker's Markdown; kept apart from react-markdown so jest can test them

/** Agents write one item per line ('SETUP: …' then 'TESTS: …'); Markdown would run those into one
 *  paragraph. Outside code fences, a single line break stays a line break (as in GitHub comments). */
export function keepLineBreaks(text: string): string {
  let fenced = false;
  return text.split('\n').map((line, i, lines) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return line; }
    const next = lines[i + 1];
    if (fenced || !line.trim() || next === undefined || !next.trim() || /^\s*(```|~~~)/.test(next)) return line;
    return line.replace(/\s*$/, '') + '  ';
  }).join('\n');
}
