// New Tracker project.
import React, { useState } from 'react';
import { Button, PanelDialog } from '../ui';
import { errorText, trackerApi } from './trackerApi';

const FIELD = 'w-full h-9 px-2.5 rounded-lg border border-nb-border-strong bg-nb-raised text-[13.5px] text-nb-text';
const LABEL = 'block mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-nb-text-3';

export default function NewProjectDialog({ narrow, onClose, onCreated }: {
  narrow: boolean; onClose: () => void; onCreated: (key: string) => void;
}) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    try {
      const p = await trackerApi.createProject(key.trim().toUpperCase(), name.trim(), description);
      onCreated(p.key);
    } catch (err) {
      setError(errorText(err, 'Could not create the project'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PanelDialog open onClose={onClose} title="New project" variant={narrow ? 'sheet' : 'center'} width={440}
      footer={<><span className="flex-1" /><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => save()} disabled={saving || !key.trim() || !name.trim()}>Create project</Button></>}>
      <form onSubmit={save} className="px-4 pb-4 flex flex-col gap-3">
        <div>
          <label className={LABEL} htmlFor="np-name">Name</label>
          <input id="np-name" data-autofocus className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="Lighthouse" />
        </div>
        <div>
          <label className={LABEL} htmlFor="np-key">Key</label>
          <input id="np-key" className={`${FIELD} font-mono uppercase`} value={key} maxLength={10}
            onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="LIGHT" />
          <p className="m-0 mt-1 text-xs text-nb-text-3">2–10 capitals or digits. Tickets are numbered {key || 'LIGHT'}-1, {key || 'LIGHT'}-2…</p>
        </div>
        <div>
          <label className={LABEL} htmlFor="np-desc">Description</label>
          <textarea id="np-desc" rows={2} className={`${FIELD} h-auto py-2 resize-y`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {error && <p role="alert" className="m-0 text-[12.5px] text-nb-danger-text">{error}</p>}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </PanelDialog>
  );
}
