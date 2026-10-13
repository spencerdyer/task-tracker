import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TicketDialog from '../TicketDialog';
import { trackerApi, type Ticket } from '../trackerApi';

jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }: { children: string }) => <div>{children}</div> }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }));
jest.mock('../../live/LiveProvider', () => ({ useSyncEvent: () => {} }));
// The widget pulls in the chat (react-markdown, ESM); the dialog only needs its priority tag
jest.mock('../TrackerWidget', () => ({ PriorityTag: ({ priority }: { priority: string }) => <span>{priority}</span> }));

// Reviewing a busy board. After approving or sending back, the next ticket waiting for
// review is one press away; an empty send-back puts the cursor in the review box.
const base: Ticket = {
  key: 'B-1', title: 'Sync socket flickers', scope: 'In: x', acceptance: 'Works', priority: 'P2', owner: 'builder',
  labels: [], depends_on: [], resources: ['gpu'], status: 'uat', rank: 1, reopened: 0, created: 0, updated: 0,
  attention: false, counts: {}, attachments: 0, events: [], dependencies: [], blocks: [], project: { key: 'B', name: 'Busy' },
} as unknown as Ticket;

function renderDialog(onOpen = jest.fn(), notify = jest.fn()) {
  render(<TicketDialog ticketKey="B-1" narrow={false} stacked={false} onClose={jest.fn()} onOpen={onOpen} onEdit={jest.fn()}
    onChanged={jest.fn()} notify={notify} nextReview="B-2" reviewLeft={4} machineNames={{ gpu: 'Render box' }} />);
  return { onOpen, notify };
}

describe('TicketDialog review', () => {
  beforeEach(() => { jest.spyOn(trackerApi, 'ticket').mockResolvedValue(base); });
  afterEach(() => jest.restoreAllMocks());

  it('offers the next ticket once this one is approved, and names machines', async () => {
    jest.spyOn(trackerApi, 'move').mockResolvedValue({ ...base, status: 'done' });
    const { onOpen } = renderDialog();
    await screen.findByText('Render box');
    expect(screen.queryByText(/Review next/)).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Approve/ })); });
    const next = await screen.findByRole('button', { name: 'Review next: B-2' });
    expect(screen.getByText('4 more waiting for your review.')).toBeTruthy();
    fireEvent.click(next);
    expect(onOpen).toHaveBeenCalledWith('B-2');
  });

  it('an empty send-back asks for a reason and focuses the box', async () => {
    const move = jest.spyOn(trackerApi, 'move');
    const { notify } = renderDialog();
    await screen.findByText('Render box');
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }));
    expect(move).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/Say what must change/), { tone: 'error' });
    await waitFor(() => expect(document.activeElement?.id).toBe('tracker-review'));
  });
});
