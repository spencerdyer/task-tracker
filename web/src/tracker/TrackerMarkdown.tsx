// Markdown as the tracker shows it: the project chat and a ticket's scope,
// acceptance and history (notes, verification, comments). No raw HTML (react-markdown's default);
// links open in a new tab. The raw text stays what the editor edits.
import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { keepLineBreaks } from './markdownText';

export const MD_PLUGINS = [remarkGfm];

export const MD: Components = {
  p: ({ children }) => <p className="m-0 mb-1.5 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="list-disc ml-4 mb-1.5 last:mb-0 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal ml-4 mb-1.5 last:mb-0 space-y-0.5">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-nb-accent-text underline break-all">{children}</a>,
  code: ({ children }) => <code className="px-1 rounded-sm bg-nb-surface font-mono text-[12px] wrap-break-word">{children}</code>,
  // The block's code drops inline code's padding (its first line was indented otherwise)
  // An image from elsewhere would load when the owner reads, telling its server when and from where;
  // shown as a link instead
  img: ({ src, alt }) => (
    <a href={typeof src === 'string' ? src : undefined} target="_blank" rel="noreferrer noopener" className="text-nb-accent-text underline break-all">
      {alt ? `Image: ${alt}` : 'Image link'}
    </a>
  ),
  pre: ({ children }) => <pre className="m-0 mb-1.5 last:mb-0 p-2 rounded-md bg-nb-surface overflow-x-auto text-[12px] [&>code]:p-0 [&>code]:bg-transparent">{children}</pre>,
};

// Ticket text also has headings, quotes, rules and tables
export const TICKET_MD: Components = {
  ...MD,
  h1: ({ children }) => <p className="m-0 mb-1 font-ui text-[14px] font-semibold">{children}</p>,
  h2: ({ children }) => <p className="m-0 mb-1 font-ui text-[13.5px] font-semibold">{children}</p>,
  h3: ({ children }) => <p className="m-0 mb-1 font-ui text-[13px] font-semibold">{children}</p>,
  h4: ({ children }) => <p className="m-0 mb-1 font-ui text-[13px] font-semibold">{children}</p>,
  blockquote: ({ children }) => <blockquote className="m-0 mb-1.5 pl-3 border-l-2 border-nb-border-strong text-nb-text-2">{children}</blockquote>,
  hr: () => <hr className="my-2 border-0 border-t border-nb-border" />,
  table: ({ children }) => <div className="mb-1.5 overflow-x-auto"><table className="text-[13px] border-collapse">{children}</table></div>,
  th: ({ children }) => <th className="px-2 py-1 border border-nb-border text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="px-2 py-1 border border-nb-border align-top">{children}</td>,
};

/** A ticket field or history entry, in Markdown */
export const TicketMarkdown = memo(function TicketMarkdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={MD_PLUGINS} components={TICKET_MD}>{keepLineBreaks(text)}</ReactMarkdown>;
});
