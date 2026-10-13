// The whole app: sign-in first (or the first-run owner password), then the tracker with live updates.
import { useEffect } from 'react';
import { Spinner } from './ui';
import { useAuth } from './auth/authStore';
import { SetupScreen, SignInScreen, UnreachableScreen } from './auth/SignInScreen';
import { LiveProvider } from './live/LiveProvider';
import TrackerWidget from './tracker/TrackerWidget';
import AppBar from './AppBar';

/** After the live socket closes abnormally: is the session still good? (A server that's only down keeps it.) */
async function stillSignedIn(): Promise<boolean> {
  const screen = await useAuth.getState().check(true);
  return screen === 'app' || screen === 'unreachable';
}

export default function App() {
  const screen = useAuth((s) => s.screen);
  const check = useAuth((s) => s.check);
  useEffect(() => { void check(); }, [check]);

  if (screen === 'checking') {
    return <div className="nb-scope h-full flex items-center justify-center bg-nb-bg"><Spinner size={22} /></div>;
  }
  if (screen === 'setup') return <SetupScreen />;
  if (screen === 'signIn') return <SignInScreen />;
  if (screen === 'unreachable') return <UnreachableScreen onRetry={() => { void check(); }} />;
  return (
    <LiveProvider stillSignedIn={stillSignedIn}>
      <div className="h-full w-full">
        <TrackerWidget appBar={<AppBar />} />
      </div>
    </LiveProvider>
  );
}
