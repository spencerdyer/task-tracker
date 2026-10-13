// The owner's sign-in, and on first run the screen that sets the owner password.
import React, { useState } from 'react';
import { FolderKanban, Moon, Sun } from 'lucide-react';
import { Button, IconButton } from '../ui';
import { useTheme } from '../lib/theme';
import { useAuth } from './authStore';
import { MIN_PASSWORD, newPasswordProblem } from './authLogic';

const FIELD = 'w-full h-10 px-3 rounded-lg border border-solid border-nb-border-strong bg-nb-raised text-[14px] text-nb-text focus:outline-hidden focus:border-nb-accent';
const LABEL = 'block mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-nb-text-3';

export function ThemeToggle() {
  const dark = useTheme((s) => s.dark);
  const toggle = useTheme((s) => s.toggle);
  return <IconButton icon={dark ? Sun : Moon} label={dark ? 'Use the light theme' : 'Use the dark theme'} onClick={toggle} />;
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="nb-scope relative min-h-full w-full flex flex-col bg-nb-bg text-nb-text font-ui">
      <div className="flex items-center justify-end p-2"><ThemeToggle /></div>
      <main className="flex-1 flex items-start sm:items-center justify-center px-4 pb-16 pt-4">
        <div className="w-full max-w-[380px] flex flex-col gap-5">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-[10px] bg-nb-accent text-nb-accent-fg shrink-0" aria-hidden>
              <FolderKanban size={19} strokeWidth={1.75} />
            </span>
            <span className="text-[17px] font-semibold">Task Tracker</span>
          </div>
          <h1 className="m-0 text-[22px] leading-tight font-semibold">{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}

export function SignInScreen() {
  const signIn = useAuth((s) => s.signIn);
  const notice = useAuth((s) => s.notice);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    const problem = await signIn(password);
    setBusy(false);
    if (problem) setError(problem);
  };

  return (
    <Frame title="Sign in">
      {notice && <p role="status" className="m-0 px-3 py-2.5 rounded-lg bg-nb-warning-soft text-[13.5px] text-nb-text">{notice}</p>}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className={LABEL} htmlFor="signin-password">Owner password</label>
          <input id="signin-password" type="password" autoComplete="current-password" autoFocus className={FIELD}
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p role="alert" className="m-0 text-[13px] text-nb-danger-text">{error}</p>}
        <Button type="submit" variant="primary" size="lg" disabled={busy || !password}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
    </Frame>
  );
}

export function SetupScreen() {
  const setup = useAuth((s) => s.setup);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = newPasswordProblem(password, confirm);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    const failed = await setup(password);
    setBusy(false);
    if (failed) setError(failed);
  };

  return (
    <Frame title="Set the owner password">
      <p className="m-0 text-[14px] leading-snug text-nb-text-2">
        This tracker has no owner yet. The owner is the only one who signs in here, approves finished work and makes
        access tokens for agents. Choose a password of at least {MIN_PASSWORD} characters.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className={LABEL} htmlFor="setup-password">Password</label>
          <input id="setup-password" type="password" autoComplete="new-password" autoFocus className={FIELD}
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label className={LABEL} htmlFor="setup-confirm">The same again</label>
          <input id="setup-confirm" type="password" autoComplete="new-password" className={FIELD}
            value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <p role="alert" className="m-0 text-[13px] text-nb-danger-text">{error}</p>}
        <Button type="submit" variant="primary" size="lg" disabled={busy || !password || !confirm}>{busy ? 'Saving…' : 'Set password and sign in'}</Button>
      </form>
    </Frame>
  );
}

export function UnreachableScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <Frame title="The server isn’t answering">
      <p role="alert" className="m-0 text-[14px] leading-snug text-nb-text-2">
        The tracker couldn’t reach its server. Check that it is running and that this page’s address is right.
      </p>
      <Button variant="primary" size="lg" onClick={onRetry}>Try again</Button>
    </Frame>
  );
}
