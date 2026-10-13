// A project's shared machines: add, rename, describe, remove (only when no ticket needs it).
import { useState } from 'react';
import { Cpu, Trash2 } from 'lucide-react';
import { Button, IconButton, PanelDialog } from '../ui';
import { Project, Resource, errorText, trackerApi } from './trackerApi';

const FIELD = 'w-full h-9 px-2.5 rounded-lg border border-nb-border-strong bg-nb-raised text-[13.5px] text-nb-text';
const LABEL = 'block mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-nb-text-3';

function Row({ project, r, onChanged, onError }: { project: string; r: Resource; onChanged: () => void; onError: (m: string) => void }) {
  const [name, setName] = useState(r.name);
  const [description, setDescription] = useState(r.description);
  const dirty = name !== r.name || description !== r.description;
  const save = async () => {
    try { await trackerApi.updateResource(project, r.key, { name, description }); onChanged(); } catch (e) { onError(errorText(e)); }
  };
  const remove = async () => {
    try { await trackerApi.deleteResource(project, r.key); onChanged(); } catch (e) { onError(errorText(e)); }
  };
  return (
    <li className="flex flex-col gap-2 py-3 border-b border-nb-border">
      <div className="flex items-center gap-2 min-w-0">
        <Cpu size={15} strokeWidth={1.75} className="shrink-0 text-nb-text-2" aria-hidden />
        <span className="font-mono text-xs text-nb-accent-text shrink-0">{r.key}</span>
        <input aria-label={`Name of ${r.key}`} className={`${FIELD} h-8 flex-1 min-w-0`} value={name} onChange={(e) => setName(e.target.value)} />
        <IconButton icon={Trash2} label={`Remove ${r.key}`} onClick={remove} disabled={r.busy} />
      </div>
      <textarea aria-label={`What ${r.key} is`} rows={2} className={`${FIELD} h-auto py-1.5 resize-y`} value={description}
        onChange={(e) => setDescription(e.target.value)} placeholder="What it is and where it runs" />
      <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
        <span className={r.busy ? 'text-nb-warning' : 'text-nb-text-3'}>
          {r.busy ? `Busy: ${r.holders.map((h) => `${h.ticket} (${h.owner || 'no owner'})`).join(', ')}` : 'Free'}
        </span>
        <span className="flex-1" />
        {dirty && <Button size="sm" variant="primary" onClick={save}>Save</Button>}
      </div>
    </li>
  );
}

export default function MachinesDialog({ project, resources, narrow, onClose, onChanged }: {
  project: Project; resources: Resource[]; narrow: boolean; onClose: () => void; onChanged: () => void;
}) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await trackerApi.createResource(project.key, { key: key.trim(), name: name.trim() || key.trim(), description });
      setKey(''); setName(''); setDescription('');
      onChanged();
    } catch (err) {
      setError(errorText(err, 'Could not add the machine'));
    }
  };

  return (
    <PanelDialog open onClose={onClose} title={`Machines in ${project.name}`} variant={narrow ? 'sheet' : 'center'} width={560}>
      <div className="px-4 pb-4 flex flex-col gap-3">
        <p className="m-0 text-[13.5px] text-nb-text-2 leading-snug">
          Machines only one agent should lean on at a time. A machine is busy while a ticket that needs it is in progress or
          testing; to-dos that need a busy machine wait.
        </p>
        {resources.length > 0 && (
          <ul className="m-0 p-0 list-none">
            {resources.map((r) => <Row key={r.key} project={project.key} r={r} onChanged={onChanged} onError={setError} />)}
          </ul>
        )}
        <form onSubmit={add} className="flex flex-col gap-2 pt-1">
          <span className={LABEL}>Add a machine</span>
          <div className="flex gap-2 flex-wrap">
            <input aria-label="Key" className={`${FIELD} font-mono w-[140px]`} placeholder="gpu-box" value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />
            <input aria-label="Name" className={`${FIELD} flex-1 min-w-[140px]`} placeholder="GPU box" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <textarea aria-label="Description" rows={2} className={`${FIELD} h-auto py-1.5 resize-y`} placeholder="What it is and where it runs"
            value={description} onChange={(e) => setDescription(e.target.value)} />
          {error && <p role="alert" className="m-0 text-[12.5px] text-nb-danger-text">{error}</p>}
          <div><Button type="submit" variant="secondary" disabled={!key.trim()}>Add machine</Button></div>
        </form>
      </div>
    </PanelDialog>
  );
}
