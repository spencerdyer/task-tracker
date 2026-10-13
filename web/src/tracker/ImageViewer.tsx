import React from 'react';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { IconButton, PanelDialog } from '../ui';

export interface ViewerItem {
  key: string;
  /** Full-size picture (or video); undefined while it's still loading, null when it's gone */
  src: string | null | undefined;
  title: string;
  caption?: string;
  video?: boolean;
  /** Offer a download of the original */
  download?: string;
}

/**
 * Full-size pictures over the tracker: steps through the items it was opened with,
 * with buttons or the arrow keys. Render it inside the widget's positioned root, not inside another
 * dialog's box, so it covers the widget.
 */
export function ImageViewer({ items, index, onStep, onClose }: {
  items: ViewerItem[];
  index: number;
  onStep: (delta: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  if (!item) return null;
  const many = items.length > 1;
  const arrows = (e: React.KeyboardEvent) => {
    if (!many) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); onStep(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); onStep(1); }
  };
  return (
    <PanelDialog open onClose={onClose} title={item.title || 'Picture'} width={1100}
      footer={
        <div className="flex items-center gap-2 min-w-0 w-full" onKeyDown={arrows}>
          {many && <IconButton icon={ChevronLeft} label="Previous picture" onClick={() => onStep(-1)} />}
          <p className="m-0 flex-1 min-w-0 text-xs text-nb-text-2 line-clamp-2" title={item.caption}>{item.caption}</p>
          {many && <span className="shrink-0 text-xs text-nb-text-3 tabular-nums">{index + 1} of {items.length}</span>}
          {item.download && (
            <a href={item.download} download className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg text-nb-text-2 hover:bg-nb-hover hover:text-nb-text"
              aria-label="Download" title="Download">
              <Download size={15} strokeWidth={1.75} aria-hidden />
            </a>
          )}
          {many && <IconButton icon={ChevronRight} label="Next picture" onClick={() => onStep(1)} />}
        </div>
      }>
      <div
        className="flex items-center justify-center bg-nb-bg min-h-[240px] outline-hidden"
        tabIndex={-1}
        data-autofocus
        aria-label={many ? 'Picture; left and right arrows step through' : 'Picture'}
        onKeyDown={arrows}
      >
        {item.src && item.video ? (
          <video key={item.key} src={item.src} controls className="block max-w-full max-h-[70vh]" />
        ) : item.src ? (
          <img key={item.key} src={item.src} alt={item.title} className="block max-w-full max-h-[70vh] object-contain" />
        ) : (
          <span className="text-sm text-nb-text-3 p-8">{item.src === null ? 'This picture is no longer available.' : 'Loading…'}</span>
        )}
      </div>
    </PanelDialog>
  );
}
