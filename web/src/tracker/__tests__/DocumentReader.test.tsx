import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TicketDialog from '../TicketDialog';
import { trackerApi, type Ticket } from '../trackerApi';

jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }: { children: string }) => <div data-md>{children}</div> }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }));
jest.mock('../../live/LiveProvider', () => ({ useSyncEvent: () => {} }));
jest.mock('../TrackerWidget', () => ({ PriorityTag: ({ priority }: { priority: string }) => <span>{priority}</span> }));

// Markdown, text and JSON files on a ticket open in a reader; arrows step through them
const file = (id: string, filename: string, mime: string) => ({ id, filename, mime, size: 2048, url: `/api/tracker/attachments/${id}` });
const ev = (id: number, ts: number, body: string, attachments: ReturnType<typeof file>[]) =>
  ({ id, ts, author: 'builder', kind: 'note', body, attachments, token: null });
const ticket = {
  key: 'DEMO-1', title: 'Bench', scope: '', acceptance: '', priority: 'P2', owner: 'builder', labels: [], depends_on: [], resources: [],
  status: 'in_progress', rank: 1, reopened: 0, created: 0, updated: 0, attention: false, counts: {}, attachments: 4,
  dependencies: [], blocks: [], project: { key: 'DEMO', name: 'Demo' },
  events: [
    ev(1, 1, 'Chapters attached.', [file('md1', 'chapter-2_haiku.md', 'text/markdown'), file('md2', 'chapter-2_opus.md', 'text/markdown')]),
    ev(2, 2, 'Data.', [file('js1', 'declines.json', 'application/json'), file('png', 'shot.png', 'image/png')]),
  ],
} as unknown as Ticket;

const bodies: Record<string, string> = {
  md1: '# Haiku\n\nThe lamp was lit.', md2: '# Opus\n\nThe sea was grey.', js1: '{"declines":[1]}',
};

describe('DocumentReader', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    jest.spyOn(trackerApi, 'ticket').mockResolvedValue(ticket);
    fetchMock = jest.fn(async (url: string) => {
      const id = url.split('/').pop()!;
      return { ok: true, status: 200, body: null, text: async () => bodies[id] } as unknown as Response;
    });
    (global as any).fetch = fetchMock;
  });
  afterEach(() => jest.restoreAllMocks());

  function open() {
    render(<TicketDialog ticketKey="DEMO-1" narrow={false} stacked={false} onClose={jest.fn()} onOpen={jest.fn()} onEdit={jest.fn()}
      onChanged={jest.fn()} notify={jest.fn()} />);
  }

  it('shows document chips, opens one rendered, and steps with the arrows', async () => {
    open();
    const chip = await screen.findByRole('button', { name: 'Read chapter-2_haiku.md' });
    expect(screen.getByRole('button', { name: 'Read declines.json' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Read shot.png/ })).toBeNull();
    fireEvent.click(chip);
    expect(await screen.findByText(/The lamp was lit/)).toBeTruthy();
    expect(screen.getByText('2 of 3')).toBeTruthy();  // newest first: json, haiku, opus
    const body = document.querySelector('[data-document-body]')!.parentElement!.parentElement!;
    fireEvent.keyDown(body, { key: 'ArrowRight' });
    expect(await screen.findByText(/The sea was grey/)).toBeTruthy();
    fireEvent.keyDown(document.querySelector('[data-document-body]')!, { key: 'ArrowLeft' });
    fireEvent.click(screen.getByRole('button', { name: 'Previous document' }));
    // JSON is indented in a monospace view
    await waitFor(() => expect(document.querySelector('[data-kind="json"] pre')?.textContent).toContain('"declines": [\n    1\n  ]'));
  });

  it('says when a file is gone', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, body: null, text: async () => '' } as unknown as Response);
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Read declines.json' }));
    expect(await screen.findByText('This file is no longer on the ticket.')).toBeTruthy();
  });
});
