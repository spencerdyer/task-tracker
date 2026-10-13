import { hashFor, showTicketInAddress, ticketFromHash } from '../ticketLink';

describe('ticket links', () => {
  it('reads a ticket key from the hash', () => {
    expect(ticketFromHash('#ticket=DEMO-12')).toBe('DEMO-12');
    expect(ticketFromHash('#ticket=light-3')).toBe('LIGHT-3');
    expect(ticketFromHash('#ticket=DEMO')).toBeNull();
    expect(ticketFromHash('#ticket=DEMO-1;alert(1)')).toBeNull();
    expect(ticketFromHash('')).toBeNull();
    expect(hashFor('DEMO-1')).toBe('#ticket=DEMO-1');
    expect(hashFor(null)).toBe('');
  });

  it('puts the open ticket in the address and takes it out again', () => {
    showTicketInAddress('DEMO-4');
    expect(window.location.hash).toBe('#ticket=DEMO-4');
    showTicketInAddress(null);
    expect(window.location.hash).toBe('');
  });
});
