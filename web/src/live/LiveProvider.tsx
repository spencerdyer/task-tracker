// Live updates: one WebSocket at /api/ws on the page's own origin (the session cookie authenticates it).
// The server sends {type, data, server_time}; it says {type: "sync_hello"} on connect. After a drop the
// socket reconnects on its own (1, 2, 4 … 30 s) and, once back, tells every listener to refetch
// ('sync_reconnected'), since events sent meanwhile were missed.
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { ReconnectingSocket } from './reconnectingSocket';

export type SyncEventType =
  | 'tracker_changed'       // a ticket or project changed
  | 'tracker_chat'          // a chat message, or a read marker moved
  | 'tracker_review_ready'  // a ticket reached User acceptance
  | 'tracker_question'      // a question asked, answered, replied to or closed
  | 'tracker_view_changed'  // the projects shown at once changed in another tab or device
  | 'sync_hello'
  | 'sync_reconnected';

export interface SyncEvent {
  type: SyncEventType;
  data: Record<string, any>;
  server_time?: string;
}

type Callback = (event: SyncEvent) => void;
type Subscribe = (type: SyncEventType, cb: Callback) => () => void;

const SubscribeContext = createContext<Subscribe | null>(null);

export const socketUrl = (loc: Pick<Location, 'protocol' | 'host'>) => `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/api/ws`;

export function LiveProvider({ children, stillSignedIn }: {
  children: ReactNode;
  /** Asked after an abnormal close: false stops the socket (the session ended) */
  stillSignedIn: () => Promise<boolean>;
}) {
  const subscribers = useRef(new Map<SyncEventType, Set<Callback>>());
  const subscribe = useRef<Subscribe>((type, cb) => {
    const map = subscribers.current;
    if (!map.has(type)) map.set(type, new Set());
    map.get(type)!.add(cb);
    return () => { map.get(type)?.delete(cb); };
  }).current;
  const signedIn = useRef(stillSignedIn);
  signedIn.current = stillSignedIn;

  useEffect(() => {
    const notify = (event: SyncEvent) => {
      subscribers.current.get(event.type)?.forEach((cb) => {
        try { cb(event); } catch (err) { console.error('Live update listener failed', err); }
      });
    };
    const socket = new ReconnectingSocket({
      url: () => socketUrl(window.location),
      onOpen: (reconnected) => { if (reconnected) notify({ type: 'sync_reconnected', data: {} }); },
      onMessage: (raw) => {
        let event: SyncEvent;
        try { event = JSON.parse(raw.data); } catch { return; }
        if (!event || typeof event.type !== 'string' || event.type === 'sync_hello') return;
        notify({ ...event, data: event.data ?? {} });
      },
      shouldRetry: () => signedIn.current(),
    });
    socket.start();
    // Back online, or the tab shown again: don't sit out the backoff
    const wake = () => socket.retryNow();
    const onVisible = () => { if (document.visibilityState === 'visible') wake(); };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', onVisible);
      socket.stop();
    };
  }, []);

  return <SubscribeContext.Provider value={subscribe}>{children}</SubscribeContext.Provider>;
}

/**
 * Listen for one event type. Subscribes once per type and calls the latest callback through a ref, so callers
 * needn't memoise it. Outside a provider (a component rendered on its own) it does nothing.
 */
export function useSyncEvent(type: SyncEventType, callback: Callback) {
  const subscribe = useContext(SubscribeContext);
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => (subscribe ? subscribe(type, (e) => latest.current(e)) : undefined), [type, subscribe]);
}
