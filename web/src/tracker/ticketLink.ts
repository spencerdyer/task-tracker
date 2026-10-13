// A ticket's address in the page: #ticket=KEY opens it (shareable, and kept across a reload).

/** The ticket a location hash names, or null. Keys are a project key (capitals and digits) and a number. */
export function ticketFromHash(hash: string): string | null {
  const m = /^#ticket=([A-Za-z0-9]{1,10}-\d{1,9})$/.exec(hash.trim());
  return m ? m[1].toUpperCase() : null;
}

/** The hash for a ticket, or '' for none. */
export const hashFor = (key: string | null) => (key ? `#ticket=${key}` : '');

/** Point the address at this ticket (or at none) without adding a history entry or firing hashchange. */
export function showTicketInAddress(key: string | null) {
  if (typeof window === 'undefined') return;
  const want = hashFor(key);
  if (window.location.hash === want || (!want && !ticketFromHash(window.location.hash))) return;
  const url = `${window.location.pathname}${window.location.search}${want}`;
  window.history.replaceState(window.history.state, '', url);
}
