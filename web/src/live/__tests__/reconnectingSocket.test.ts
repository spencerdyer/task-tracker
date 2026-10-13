import { ReconnectingSocket, reconnectDelay, RECONNECT_CAP_MS } from '../reconnectingSocket';

// A stand-in WebSocket the test opens and closes by hand
class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {}
  open() { this.readyState = 1; this.onopen?.(); }
  fail(code = 1006) { this.readyState = 3; this.onclose?.({ code } as CloseEvent); }
  close() { this.fail(1000); }
  send(d: string) { this.sent.push(d); }
}

const flush = () => new Promise((r) => jest.requireActual('timers').setImmediate(r));

function setup(shouldRetry: (e: CloseEvent) => boolean | Promise<boolean> = () => true) {
  const sockets: FakeSocket[] = [];
  const opens: boolean[] = [];
  const socket = new ReconnectingSocket({
    url: () => 'ws://test/api/ws',
    createSocket: (u) => { const s = new FakeSocket(u); sockets.push(s); return s as unknown as WebSocket; },
    onOpen: (reconnected) => opens.push(reconnected),
    shouldRetry,
    random: () => 1, // the top of each jitter range
  });
  return { socket, sockets, opens };
}

beforeAll(() => { (global as any).WebSocket = FakeSocket; });
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('waits double each time, with jitter, up to a 30 s cap', () => {
  expect([0, 1, 2, 3, 4, 5, 6, 10].map((a) => reconnectDelay(a, () => 1)))
    .toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  expect(reconnectDelay(3, () => 0)).toBe(4000); // never less than half
  for (let i = 0; i < 200; i++) expect(reconnectDelay(20)).toBeLessThanOrEqual(RECONNECT_CAP_MS);
});

test('retries back off to the cap while the server is down, then reconnects', async () => {
  const { socket, sockets, opens } = setup();
  socket.start();
  sockets[0].open();
  expect(opens).toEqual([false]);

  const waits: number[] = [];
  sockets[sockets.length - 1].fail();
  for (let i = 0; i < 8; i++) {
    await flush();
    const before = sockets.length;
    const st = socket.status;
    expect(st.state).toBe('waiting');
    waits.push(st.retryAt! - Date.now());
    jest.advanceTimersByTime(st.retryAt! - Date.now() - 1);
    expect(sockets.length).toBe(before); // not a moment early
    jest.advanceTimersByTime(1);
    expect(sockets.length).toBe(before + 1);
    if (i < 7) sockets[sockets.length - 1].fail();
  }
  expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  sockets[sockets.length - 1].open();
  expect(opens).toEqual([false, true]); // the reopen is reported as a reconnect
  expect(socket.status.attempt).toBe(0); // and the backoff starts over
});

test('stops when the socket is refused and sign-in says signed out (403 / 1008)', async () => {
  let signedIn = true;
  const checked: number[] = [];
  const { socket, sockets } = setup((e) => { checked.push(e.code); return signedIn; });
  socket.start();
  sockets[0].open();
  signedIn = false;
  sockets[0].fail(1006); // a refused handshake (HTTP 403) reaches the browser as 1006
  await flush();
  expect(checked).toEqual([1006]);
  expect(socket.status.state).toBe('stopped');
  jest.advanceTimersByTime(10 * 60 * 1000);
  expect(sockets.length).toBe(1); // no more tries

  const b = setup(() => false);
  b.socket.start();
  b.sockets[0].open();
  b.sockets[0].fail(1008); // server closed it: signed out / sign-in required
  await flush();
  jest.advanceTimersByTime(10 * 60 * 1000);
  expect(b.sockets.length).toBe(1);
  expect(b.socket.status.state).toBe('stopped');
});

test('a normal close skips the sign-in check; stop() ends it for good', async () => {
  const check = jest.fn(() => true);
  const { socket, sockets } = setup(check);
  socket.start();
  sockets[0].open();
  sockets[0].fail(1000);
  await flush();
  expect(check).not.toHaveBeenCalled();
  expect(socket.status.state).toBe('waiting');
  socket.stop();
  jest.advanceTimersByTime(60000);
  expect(sockets.length).toBe(1);
  socket.retryNow();
  expect(sockets.length).toBe(1);
});

test('retry now skips the wait and restarts the backoff', async () => {
  const { socket, sockets } = setup();
  socket.start();
  sockets[0].fail();
  await flush();
  jest.advanceTimersByTime(1000);
  sockets[1].fail();
  await flush();
  expect(socket.status.attempt).toBe(2);
  socket.retryNow();
  expect(sockets.length).toBe(3);
  expect(socket.status.state).toBe('connecting');
  jest.advanceTimersByTime(60000);
  expect(sockets.length).toBe(3); // the old timer is gone
});
