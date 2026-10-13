// An audio attachment played where it is: play/pause, a seek bar, the time, and Download / Open in a
// new tab in a menu. One plays at a time across the page. The file is fetched by the page itself, so the
// sign-in cookie goes with it (a sandboxed tab of its own can lose it).
import { CSSProperties, useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, MoreHorizontal, Pause, Play, Volume2 } from 'lucide-react';
import { IconButton, MenuButton } from '../ui';
import type { Attachment } from './trackerApi';

// The audio element now playing anywhere on the page: starting another pauses it
let current: HTMLAudioElement | null = null;

export const isAudio = (a: Attachment) =>
  a.mime.startsWith('audio/') || /\.(m4a|mp3|wav|aac|ogg|oga|opus|flac|caf|aiff?)$/i.test(a.filename);

export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function AudioAttachment({ attachment }: { attachment: Attachment }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const name = attachment.filename;

  useEffect(() => () => {
    const el = audio.current;
    if (el && current === el) current = null;
    el?.pause();
  }, []);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => setFailed(true));
    } else {
      el.pause();
    }
  };

  const download = () => {
    const link = document.createElement('a');
    link.href = attachment.url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div data-attachment={attachment.id} data-audio
      className="flex items-center gap-2 min-w-0 w-full max-w-[420px] h-11 pl-1 pr-1 rounded-lg border border-nb-border bg-nb-raised text-nb-text">
      <audio ref={audio} src={attachment.url} preload="metadata"
        onPlay={(e) => {
          if (current && current !== e.currentTarget) current.pause();
          current = e.currentTarget;
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onError={() => setFailed(true)} />
      <IconButton icon={playing ? Pause : Play} label={`${playing ? 'Pause' : 'Play'} ${name}`} size="md" variant="outline"
        className="shrink-0" onClick={toggle} disabled={failed} />
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
        <div className="flex items-center gap-1.5 min-w-0 text-[12px] leading-none">
          <Volume2 size={12} strokeWidth={1.75} className="shrink-0 text-nb-text-3" aria-hidden />
          <span className="truncate text-nb-text-2" title={name}>{name}</span>
          <span className="ml-auto shrink-0 tabular-nums text-nb-text-3" aria-hidden>
            {failed ? 'Can’t play' : `${clock(time)} / ${clock(duration)}`}
          </span>
        </div>
        <input type="range" min={0} max={duration || 0} step={0.1} value={Math.min(time, duration || 0)}
          disabled={failed || !duration}
          aria-label={`Position in ${name}`}
          aria-valuetext={`${clock(time)} of ${clock(duration)}`}
          onChange={(e) => {
            const el = audio.current;
            if (!el) return;
            el.currentTime = Number(e.target.value);
            setTime(el.currentTime);
          }}
          className="nb-range w-full m-0 cursor-pointer disabled:cursor-default"
          style={{ '--nb-range-fill': `${duration ? Math.min(100, (time / duration) * 100) : 0}%` } as CSSProperties} />
      </div>
      <MenuButton label={`Options for ${name}`} items={[
        { label: 'Download', icon: Download, onSelect: download },
        { label: 'Open in a new tab', icon: ExternalLink, onSelect: () => { window.open(attachment.url, '_blank', 'noopener'); } },
      ]}>
        {(props) => (
          <button {...props} type="button" aria-label={`Options for ${name}`} title="More"
            className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-md text-nb-text-2 hover:bg-nb-hover hover:text-nb-text">
            <MoreHorizontal size={15} strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </MenuButton>
    </div>
  );
}
