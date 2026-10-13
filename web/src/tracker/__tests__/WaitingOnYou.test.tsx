import { render, screen, fireEvent } from '@testing-library/react';
import WaitingOnYou from '../WaitingOnYou';
import type { WaitingOnYou as Waiting } from '../trackerApi';

const now = Date.now() / 1000;
const data: Waiting = {
  count: 2,
  review: [
    { key: 'WY-3', title: 'Older review', owner: 'lark', priority: 'P2', since: now - 3 * 86400, waiting_hours: 72 },
    { key: 'WY-4', title: 'Newer review', owner: 'wren', priority: 'P2', since: now - 600, waiting_hours: 0.2 },
  ],
  unasked: [{ key: 'WY-1', title: 'Old saves', status: 'todo', owner: 'lark', priority: 'P2', since: now - 7200 }],
};

// Reviews keep the server's order; a blocked ticket with no question is a nudge, not a count
describe('WaitingOnYou', () => {
  it('shows each group and opens what is clicked', () => {
    const onOpen = jest.fn();
    render(<WaitingOnYou data={data} onOpen={onOpen} />);
    const titles = screen.getAllByText(/review$/).map((n) => n.textContent);
    expect(titles).toEqual(['Older review', 'Newer review']);
    expect(screen.getByText('3 days')).toBeTruthy();
    fireEvent.click(screen.getByText('Older review'));
    expect(onOpen).toHaveBeenCalledWith('WY-3');
    expect(screen.getByRole('region', { name: 'Blocked on you, no question asked yet' })).toBeTruthy();
    expect(screen.getByText("lark hasn't asked its question yet")).toBeTruthy();
    fireEvent.click(screen.getByText('Old saves'));
    expect(onOpen).toHaveBeenCalledWith('WY-1');
    // Nothing guessed: no decisions or chat-questions groups
    expect(screen.queryByText(/Your decisions|Questions in the chat/)).toBeNull();
  });
  it('says when nothing waits, and still names an unasked ticket', () => {
    const { rerender } = render(<WaitingOnYou data={{ count: 0, review: [] }} onOpen={jest.fn()} />);
    expect(screen.getByText('Nothing is waiting on you.')).toBeTruthy();
    rerender(<WaitingOnYou data={{ count: 0, review: [], unasked: data.unasked }} onOpen={jest.fn()} />);
    expect(screen.getByText('Nothing is waiting on you.')).toBeTruthy();
    expect(screen.getByText('Old saves')).toBeTruthy();
  });
});
