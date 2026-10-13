// New ticket / edit ticket.
import React, { useEffect, useState } from 'react';
import { Button, PanelDialog, Select, Spinner } from '../ui';
import { PRIORITIES, Priority, Resource, TicketFields, errorText, trackerApi } from './trackerApi';

const FIELD = 'w-full px-2.5 py-2 rounded-lg border border-nb-border-strong bg-nb-raised text-[13.5px] text-nb-text';
const LABEL = 'block mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-nb-text-3';

const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export default function TicketEditor({ projectKey, ticketKey, narrow, owners, resources, onClose, onSaved }: {
  projectKey: string;
  ticketKey?: string;
  narrow: boolean;
  owners: string[];
  resources: Resource[];
  onClose: () => void;
  onSaved: (key: string) => void;
}) {
  const [loading, setLoading] = useState(!!ticketKey);
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [priority, setPriority] = useState<Priority>('P2');
  const [owner, setOwner] = useState('');
  const [labels, setLabels] = useState('');
  const [depends, setDepends] = useState('');
  const [machines, setMachines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ticketKey) return;
    trackerApi.ticket(ticketKey).then((t) => {
      setTitle(t.title); setScope(t.scope); setAcceptance(t.acceptance); setPriority(t.priority);
      setOwner(t.owner); setLabels(t.labels.join(', ')); setDepends(t.depends_on.join(', ')); setMachines(t.resources ?? []);
    }).catch((e) => setError(errorText(e, 'Could not load the ticket'))).finally(() => setLoading(false));
  }, [ticketKey]);

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!title.trim()) { setError('A ticket needs a title.'); return; }
    const fields: TicketFields = {
      title: title.trim(), scope, acceptance, priority, owner: owner.trim(),
      labels: split(labels), depends_on: split(depends).map((d) => d.toUpperCase()), resources: machines,
    };
    setSaving(true);
    try {
      const t = ticketKey ? await trackerApi.updateTicket(ticketKey, fields) : await trackerApi.createTicket(projectKey, fields);
      onSaved(t.key);
    } catch (err) {
      setError(errorText(err, 'Could not save the ticket'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PanelDialog open onClose={onClose} title={ticketKey ? `Edit ${ticketKey}` : 'New ticket'} variant={narrow ? 'sheet' : 'center'} width={620}
      footer={
        <>
          {error && <span role="alert" className="mr-auto text-[12.5px] text-nb-danger-text">{error}</span>}
          <span className={error ? '' : 'flex-1'} />
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => save()} disabled={saving || loading}>{ticketKey ? 'Save' : 'Create ticket'}</Button>
        </>
      }>
      {loading ? <div className="p-8 flex justify-center"><Spinner size={20} /></div> : (
        <form onSubmit={save} className="px-4 pb-4 flex flex-col gap-3.5">
          <div>
            <label className={LABEL} htmlFor="tk-title">Title</label>
            <input id="tk-title" data-autofocus className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div>
            <label className={LABEL} htmlFor="tk-scope">Scope</label>
            <textarea id="tk-scope" rows={4} className={`${FIELD} resize-y`} value={scope} onChange={(e) => setScope(e.target.value)}
              placeholder="What is in, and what is out" />
          </div>
          <div>
            <label className={LABEL} htmlFor="tk-acc">Acceptance</label>
            <textarea id="tk-acc" rows={3} className={`${FIELD} resize-y`} value={acceptance} onChange={(e) => setAcceptance(e.target.value)}
              placeholder="What you'll see that proves it works" />
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <div>
              <span className={LABEL}>Priority</span>
              <Select label="Priority" block value={priority} onChange={(e) => setPriority(e.target.value as Priority)}
                options={PRIORITIES.map((p) => ({ value: p, label: p }))} />
            </div>
            <div>
              <label className={LABEL} htmlFor="tk-owner">Owner</label>
              <input id="tk-owner" className={FIELD} list="tk-owners" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Agent name" />
              <datalist id="tk-owners">{owners.map((o) => <option key={o} value={o} />)}</datalist>
            </div>
            <div>
              <label className={LABEL} htmlFor="tk-labels">Labels</label>
              <input id="tk-labels" className={FIELD} value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="backend, web" />
            </div>
            <div>
              <label className={LABEL} htmlFor="tk-deps">Depends on</label>
              <input id="tk-deps" className={FIELD} value={depends} onChange={(e) => setDepends(e.target.value)} placeholder={`${projectKey}-1, ${projectKey}-2`} />
            </div>
          </div>
          {resources.length > 0 && (
            <fieldset className="m-0 p-0 border-0">
              <legend className={LABEL}>Machines it needs for a sustained run</legend>
              <div className="flex gap-1.5 flex-wrap">
                {resources.map((r) => {
                  const on = machines.includes(r.key);
                  return (
                    <button key={r.key} type="button" aria-pressed={on} title={r.description}
                      onClick={() => setMachines(on ? machines.filter((m) => m !== r.key) : [...machines, r.key])}
                      className={`inline-flex items-center h-8 px-2.5 rounded-lg border text-[13px] ${on ? 'border-nb-accent bg-nb-accent-soft text-nb-accent-text font-semibold' : 'border-nb-border bg-nb-raised text-nb-text-2'}`}>
                      {r.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
      )}
    </PanelDialog>
  );
}
