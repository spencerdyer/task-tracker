import { act, render } from '@testing-library/react';
import { LiveProvider, socketUrl, useSyncEvent, type SyncEvent } from '../LiveProvider';

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.last.push(this); }
  close() { this.readyState = 3; }
  send() {}
}

function Listener({ type, seen }: { type: SyncEvent['type']; seen: SyncEvent[] }) {
  useSyncEvent(type, (e) => seen.push(e));
  return null;
}

describe('live updates', () => {
  beforeAll(() => { (globalThis as any).WebSocket = FakeSocket; });

  it('connects to /api/ws on the page’s own origin', () => {
    expect(socketUrl({ protocol: 'https:', host: 'tracker.example' })).toBe('wss://tracker.example/api/ws');
    expect(socketUrl({ protocol: 'http:', host: '127.0.0.1:5173' })).toBe('ws://127.0.0.1:5173/api/ws');
  });

  it('hands events to their listeners and skips the hello', () => {
    const seen: SyncEvent[] = [];
    const chat: SyncEvent[] = [];
    render(
      <LiveProvider stillSignedIn={async () => true}>
        <Listener type="tracker_changed" seen={seen} />
        <Listener type="tracker_chat" seen={chat} />
      </LiveProvider>,
    );
    const ws = FakeSocket.last[FakeSocket.last.length - 1];
    act(() => {
      ws.onopen?.();
      ws.onmessage?.({ data: JSON.stringify({ type: 'sync_hello', data: {} }) } as MessageEvent);
      ws.onmessage?.({ data: JSON.stringify({ type: 'tracker_changed', data: { project: 'DEMO', ticket: 'DEMO-1' } }) } as MessageEvent);
      ws.onmessage?.({ data: 'not json' } as MessageEvent);
    });
    expect(seen.map((e) => e.data.ticket)).toEqual(['DEMO-1']);
    expect(chat).toEqual([]);
  });
});
