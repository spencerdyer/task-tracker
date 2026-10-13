import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewMode from '../ReviewMode';
import { trackerApi, type Ticket } from '../trackerApi';

jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }: { children: string }) => <div>{children}</div> }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }));
jest.mock('../../live/LiveProvider', () => ({ useSyncEvent: () => {} }));
jest.mock('../TrackerWidget', () => ({ PriorityTag: ({ priority }: { priority: string }) => <span>{priority}</span> }));

// Review mode steps through the queue oldest first: the next ticket is already fetched, A / S / N
// act while the note isn't being typed in, each ticket's title takes focus, and a summary ends it.
const ticket = (key: string, status = 'uat'): Ticket => ({
  key, title: `Title ${key}`, scope: '', acceptance: `Accept ${key}`, priority: 'P2', owner: 'agent', labels: [],
  depends_on: [], resources: [], status, rank: 1, reopened: 0, created: 0, updated: 0, attention: false, counts: {},
  attachments: 0, dependencies: [], blocks: [], project: { key: 'R', name: 'R' },
  events: [{ id: `v-${key}`, kind: 'verification', author: 'agent', body: `Checked ${key}`, ts: 0, attachments: [] }],
} as unknown as Ticket);

function renderReview(queue: string[], notify = jest.fn(), onChanged = jest.fn()) {
  render(<ReviewMode queue={queue} narrow={false} onClose={jest.fn()} onChanged={onChanged} notify={notify} />);
  return { notify, onChanged };
}

const press = (key: string) => fireEvent.keyDown(document.activeElement ?? document.body, { key });

describe('ReviewMode', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shows the acceptance beside the latest verification and prefetches the next', async () => {
    const get = jest.spyOn(trackerApi, 'ticket').mockImplementation(async (k: string) => ticket(k));
    renderReview(['R-1', 'R-2', 'R-3']);
    expect(await screen.findByText('Title R-1')).toBeTruthy();
    expect(screen.getByText('Accept R-1')).toBeTruthy();
    expect(screen.getByText('Checked R-1')).toBeTruthy();
    await waitFor(() => expect(get).toHaveBeenCalledWith('R-2'));  // fetched while R-1 is read
    expect(get).not.toHaveBeenCalledWith('R-3');
  });

  it('A approves, S needs a note, N skips; focus moves to each title; then a summary', async () => {
    jest.spyOn(trackerApi, 'ticket').mockImplementation(async (k: string) => ticket(k));
    const move = jest.spyOn(trackerApi, 'move').mockImplementation(async (k: string, s: string) => ticket(k, s));
    const { notify } = renderReview(['R-1', 'R-2', 'R-3']);
    await screen.findByText('Title R-1');
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Title R-1'));

    await act(async () => { press('a'); });
    await screen.findByText('Title R-2');
    expect(move).toHaveBeenCalledWith('R-1', 'done', '', undefined, expect.anything());
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Title R-2'));

    // S with no note: nothing is sent, the note box takes focus; letters typed there aren't shortcuts
    await act(async () => { press('s'); });
    expect(move).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement?.id).toBe('review-note'));
    fireEvent.change(document.activeElement!, { target: { value: 'Needs a dark-mode pass' } });
    fireEvent.keyDown(document.activeElement!, { key: 'a' });
    expect(move).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send back' })); });
    expect(move).toHaveBeenLastCalledWith('R-2', 'todo', 'Needs a dark-mode pass', undefined, expect.anything());
    await screen.findByText('Title R-3');
    expect(notify).not.toHaveBeenCalledWith(expect.anything(), { tone: 'error' });

    await waitFor(() => expect(document.activeElement?.textContent).toBe('Title R-3'));
    await act(async () => { press('n'); });
    expect(move).toHaveBeenCalledTimes(2);  // skipped: nothing sent
    expect(await screen.findByText('1 approved · 1 sent back · 1 skipped')).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Reviewed 3'));
  });

  it('a ticket reviewed elsewhere meanwhile offers only Next', async () => {
    jest.spyOn(trackerApi, 'ticket').mockImplementation(async (k: string) => ticket(k, 'done'));
    renderReview(['R-1']);
    expect(await screen.findByText('Already approved.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText(/0 approved · 0 sent back · 1 skipped/)).toBeTruthy();
  });
});
