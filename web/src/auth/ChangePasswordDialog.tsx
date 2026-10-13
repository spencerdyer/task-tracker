// Change the owner password (the current one is asked for again).
import React, { useState } from 'react';
import axios from 'axios';
import { Button, PanelDialog } from '../ui';
import { authApi } from './authApi';
import { newPasswordProblem } from './authLogic';

const FIELD = 'w-full h-9 px-2.5 rounded-lg border border-solid border-nb-border-strong bg-nb-raised text-[13.5px] text-nb-text';
const LABEL = 'block mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-nb-text-3';

export default function ChangePasswordDialog({ narrow, onClose, onDone }: { narrow: boolean; onClose: () => void; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    const problem = !current ? 'Enter your current password.' : newPasswordProblem(next, confirm);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    try {
      await authApi.changePassword(current, next);
      onDone();
    } catch (err) {
      const res = axios.isAxiosError(err) ? err.response : undefined;
      const detail = (res?.data as { detail?: unknown } | undefined)?.detail;
      setError(res?.status === 401 || res?.status === 403 ? 'The current password isn’t right.'
        : typeof detail === 'string' && detail ? detail : 'The password wasn’t changed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelDialog open onClose={onClose} title="Change password" variant={narrow ? 'sheet' : 'center'} width={420}
      footer={<><span className="flex-1" /><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => save()} disabled={busy}>Change password</Button></>}>
      <form onSubmit={save} className="px-4 pb-4 flex flex-col gap-3">
        <div>
          <label className={LABEL} htmlFor="pw-current">Current password</label>
          <input id="pw-current" data-autofocus type="password" autoComplete="current-password" className={FIELD} value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div>
          <label className={LABEL} htmlFor="pw-new">New password</label>
          <input id="pw-new" type="password" autoComplete="new-password" className={FIELD} value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div>
          <label className={LABEL} htmlFor="pw-confirm">The same again</label>
          <input id="pw-confirm" type="password" autoComplete="new-password" className={FIELD} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <p role="alert" className="m-0 text-[12.5px] text-nb-danger-text">{error}</p>}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </PanelDialog>
  );
}
