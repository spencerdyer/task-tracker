// Project access tokens: what each token can do, when it was last used,
// revoke; make a new one and copy it (shown once) with a ready setup for an agent.
import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, Lock } from 'lucide-react';
import { Button, PanelDialog, Select, Spinner } from '../ui';
import { AccessToken, CreatedToken, Project, errorText, trackerApi } from './trackerApi';
import { copyText } from '../lib/clipboard';

const LABEL = 'block mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-nb-text-3';
const FIELD = 'w-full h-9 px-2.5 rounded-lg border border-nb-border-strong bg-nb-raised text-[13.5px] text-nb-text';

function can(t: AccessToken): string {
  if (!t.can_create && !t.can_edit && !t.can_move && !t.can_comment) return 'Read only';
  const parts = ['Read'];
  if (t.can_create) parts.push('create');
  if (t.can_edit) parts.push('edit');
  if (t.can_move) parts.push('move up to review');
  if (t.can_comment) parts.push('comment');
  return parts.join(', ');
}

function when(iso: string | null): string {
  if (!iso) return 'Never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function Perm({ checked, onChange, disabled, title, sub }: {
  checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean; title: string; sub?: string;
}) {
  return (
    <label className={`flex gap-2.5 items-start px-3 py-2.5 rounded-[9px] border border-nb-border bg-nb-raised text-[13.5px] ${disabled ? 'opacity-80' : 'cursor-pointer'}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)}
        className="mt-0.5 w-4 h-4 shrink-0 accent-(--nb-accent)" />
      <span className="min-w-0">{title}{sub && <span className="block text-xs text-nb-text-2 mt-0.5 leading-snug">{sub}</span>}</span>
    </label>
  );
}

function CopyButton({ text, label, primary }: { text: string; label: string; primary?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <Button variant={primary ? 'primary' : 'secondary'} icon={done ? Check : Copy}
      onClick={async () => { if (await copyText(text)) { setDone(true); setTimeout(() => setDone(false), 1600); } }}>
      {done ? 'Copied' : label}
    </Button>
  );
}

export default function AccessDialog({ project, narrow, stacked, onClose }: { project: Project; narrow: boolean; stacked: boolean; onClose: () => void }) {
  const [tokens, setTokens] = useState<AccessToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [name, setName] = useState('');
  const [canCreate, setCanCreate] = useState(true);
  const [canEdit, setCanEdit] = useState(true);
  const [canMove, setCanMove] = useState(true);
  const [canComment, setCanComment] = useState(true);
  const [limit, setLimit] = useState<'all' | 'owner'>('all');
  const [ownerOnly, setOwnerOnly] = useState('');
  const [expiry, setExpiry] = useState('90');
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState<AccessToken | null>(null);

  const load = useCallback(async () => {
    try { setTokens(await trackerApi.tokens(project.key)); } catch (e) { setError(errorText(e, 'Could not load tokens')); }
  }, [project.key]);
  useEffect(() => { load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Give the token a name, so you can tell it apart later.'); return; }
    if (limit === 'owner' && !ownerOnly.trim()) { setError('Name the owner this token is limited to.'); return; }
    setSaving(true);
    setError(null);
    try {
      const t = await trackerApi.createToken(project.key, {
        name: name.trim(), can_create: canCreate, can_edit: canEdit, can_move: canMove, can_comment: canComment,
        owner_only: limit === 'owner' ? ownerOnly.trim() : null, expires_in_days: expiry === 'never' ? null : Number(expiry),
      });
      setCreated(t);
      setName(''); setOwnerOnly(''); setLimit('all');
      load();
    } catch (err) {
      setError(errorText(err, 'Could not create the token'));
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (t: AccessToken) => {
    try { await trackerApi.revokeToken(t.id); setRevoking(null); load(); } catch (e) { setError(errorText(e, 'Could not revoke the token')); }
  };

  if (created) {
    const setup = [
      `Tracker: ${created.base_url}`,
      `Project: ${project.key}`,
      `Token:   ${created.token}`,
      '',
      'Read the guide before anything else:',
      `curl -s ${created.guide_url} \\`,
      `  -H "Authorization: Bearer ${created.token}"`,
    ].join('\n');
    return (
      <PanelDialog open onClose={onClose} title={`“${created.name}” is ready`} variant={narrow ? 'sheet' : 'center'} width={720}
        footer={<><span className="flex-1" /><Button onClick={() => setCreated(null)}>Done</Button></>}>
        <div className="px-4 pb-4 flex flex-col gap-4">
          <div className="flex gap-2.5 items-start px-3.5 py-3 rounded-[10px] bg-nb-warning-soft text-nb-text text-[13.5px] leading-snug">
            <AlertTriangle size={16} strokeWidth={1.75} className="shrink-0 mt-px text-nb-warning" aria-hidden />
            Copy it now. The server keeps only a fingerprint, so this is the one time you’ll see it.
          </div>
          <div>
            <span className={LABEL}>Token</span>
            <div className="flex gap-2">
              <code className="flex-1 min-w-0 flex items-center h-10 px-3 rounded-lg border border-nb-border-strong bg-nb-raised font-mono text-[13px] truncate select-all">{created.token}</code>
              <CopyButton text={created.token} label="Copy" />
            </div>
          </div>
          <div>
            <span className={LABEL}>Give an agent this</span>
            <pre className="m-0 px-4 py-3.5 rounded-[10px] bg-nb-text text-nb-bg font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-all">{setup}</pre>
            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
              <CopyButton text={setup} label="Copy setup for an agent" primary />
              <span className="text-[12.5px] text-nb-text-2">Paste it into the agent’s instructions or its first message.</span>
            </div>
          </div>
        </div>
      </PanelDialog>
    );
  }

  return (
    <PanelDialog open onClose={onClose} title={`Access to ${project.name} (${project.key})`} variant={narrow ? 'sheet' : 'center'} width={1080}>
      <div className={`flex ${stacked ? 'flex-col' : 'flex-row'} min-h-0`}>
        <div className="flex-1 min-w-0 px-4 pb-4 flex flex-col gap-3.5">
          <p className="m-0 text-[13.5px] text-nb-text-2 leading-snug max-w-[620px]">
            A token lets agents work on this project’s tickets and nothing else. Give one to each group of agent
            sessions; revoking it cuts them all off at once.
          </p>
          {tokens === null ? <div className="py-6 flex justify-center"><Spinner /></div> : tokens.length === 0 ? (
            <p className="m-0 py-6 text-center text-[13px] text-nb-text-3">No tokens yet. Make one on the right and give it to your agents.</p>
          ) : (
            <ul className="m-0 p-0 list-none flex flex-col">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-start gap-3 py-3 border-b border-nb-border flex-wrap">
                  <div className="min-w-[160px] flex-[2_1_180px]">
                    <div className="font-semibold text-[13.5px] wrap-break-word">{t.name}</div>
                    <div className="font-mono text-[11.5px] text-nb-text-3 mt-0.5">
                      {t.prefix}… {t.expires_at ? `· expires ${new Date(t.expires_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}
                    </div>
                  </div>
                  <div className="flex-[2_1_180px] min-w-[140px] text-[13px] text-nb-text-2">
                    {can(t)}{t.owner_only && <> · tickets owned by <b className="text-nb-text">{t.owner_only}</b> only</>}
                  </div>
                  <div className="flex-[1_1_120px] min-w-[110px] text-[13px]">
                    <div className={t.last_used_at ? '' : 'text-nb-text-3'}>{when(t.last_used_at)}</div>
                    {t.last_used_ip && <div className="text-xs text-nb-text-3">{t.last_used_ip}{t.last_author ? ` · ${t.last_author}` : ''}</div>}
                  </div>
                  {revoking?.id === t.id ? (
                    <div className="flex gap-1.5 shrink-0">
                      <Button variant="ghost" onClick={() => setRevoking(null)}>Keep</Button>
                      <Button variant="danger" onClick={() => revoke(t)}>Revoke now</Button>
                    </div>
                  ) : (
                    <Button variant="danger" className="shrink-0" onClick={() => setRevoking(t)}>Revoke</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-start gap-2 px-3.5 py-3 rounded-[10px] bg-nb-surface border border-nb-border text-[13px] text-nb-text-2">
            <Lock size={15} strokeWidth={1.75} className="shrink-0 mt-px" aria-hidden />
            Approving (User acceptance → Done) and sending work back are yours, signed in as the owner. No token can be given them.
          </div>
        </div>

        <form onSubmit={create} className={`flex flex-col gap-3.5 px-4 py-4 bg-nb-sidebar ${stacked ? 'border-t' : 'w-[400px] shrink-0 border-l'} border-nb-border`}>
          <h3 className="m-0 text-[15px] font-semibold">New token</h3>
          <div>
            <label className={LABEL} htmlFor="tok-name">Name</label>
            <input id="tok-name" className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="Agents on my laptop" />
          </div>
          <fieldset className="m-0 p-0 border-0 flex flex-col gap-1.5">
            <legend className={LABEL}>What it can do</legend>
            <Perm checked disabled title="Read tickets and history" sub="Always on: every token can read its project." />
            <Perm checked={canCreate} onChange={setCanCreate} title="Create tickets" />
            <Perm checked={canEdit} onChange={setCanEdit} title="Edit tickets" sub="Title, scope, acceptance, priority, labels, dependencies, owner" />
            <Perm checked={canMove} onChange={setCanMove} title="Move tickets up to User acceptance" sub="To do ↔ In progress ↔ Testing → User acceptance, with a verification first" />
            <Perm checked={canComment} onChange={setCanComment} title="Add notes, verification and files" />
          </fieldset>
          <fieldset className="m-0 p-0 border-0 flex flex-col gap-1.5">
            <legend className={LABEL}>Which tickets</legend>
            <label className="flex gap-2.5 items-center px-3 py-2.5 rounded-[9px] border border-nb-border bg-nb-raised text-[13.5px] cursor-pointer">
              <input type="radio" name="tok-limit" checked={limit === 'all'} onChange={() => setLimit('all')} className="accent-(--nb-accent)" />
              Every ticket in the project
            </label>
            <label className="flex gap-2.5 items-center px-3 py-2 rounded-[9px] border border-nb-border bg-nb-raised text-[13.5px] cursor-pointer flex-wrap">
              <input type="radio" name="tok-limit" checked={limit === 'owner'} onChange={() => setLimit('owner')} className="accent-(--nb-accent)" />
              <span className="shrink-0">Only tickets owned by</span>
              <input aria-label="Owner name" className="flex-1 min-w-[90px] h-[30px] px-2 rounded-md border border-nb-border-strong bg-nb-bg text-[13px] text-nb-text"
                value={ownerOnly} onChange={(e) => { setOwnerOnly(e.target.value); if (e.target.value) setLimit('owner'); }} placeholder="builder" />
            </label>
          </fieldset>
          <div>
            <span className={LABEL}>Expires</span>
            <Select label="Expires" block value={expiry} onChange={(e) => setExpiry(e.target.value)} options={[
              { value: '30', label: 'In 30 days' }, { value: '90', label: 'In 90 days' },
              { value: '365', label: 'In a year' }, { value: 'never', label: 'Never' },
            ]} />
          </div>
          {error && <p role="alert" className="m-0 text-[12.5px] text-nb-danger-text">{error}</p>}
          <Button type="submit" variant="primary" size="lg" disabled={saving}>Create token</Button>
        </form>
      </div>
    </PanelDialog>
  );
}
