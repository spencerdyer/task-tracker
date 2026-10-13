// The app's own bar: its name, the theme toggle and the owner's account menu. Drawn inside the tracker's
// root, so the change-password dialog covers the page like the tracker's own dialogs.
import { useState } from 'react';
import { FolderKanban, KeyRound, LogOut, UserRound } from 'lucide-react';
import { IconButton, MenuButton, NARROW_PANEL, useToast } from './ui';
import { ThemeToggle } from './auth/SignInScreen';
import ChangePasswordDialog from './auth/ChangePasswordDialog';
import { useAuth } from './auth/authStore';

export default function AppBar() {
  const signOut = useAuth((s) => s.signOut);
  const [changing, setChanging] = useState(false);
  const toast = useToast();
  const narrow = typeof window !== 'undefined' && window.innerWidth < NARROW_PANEL;
  return (
    <>
      <header className="flex items-center gap-2 px-3 h-11 shrink-0 border-b border-nb-border bg-nb-bg">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-nb-accent text-nb-accent-fg shrink-0" aria-hidden>
          <FolderKanban size={15} strokeWidth={1.75} />
        </span>
        <span className="text-[15px] font-semibold truncate min-w-0">Task Tracker</span>
        <span className="flex-1" />
        <ThemeToggle />
        <MenuButton label="Account" items={[
          { label: 'Change password…', icon: KeyRound, onSelect: () => setChanging(true) },
          'separator',
          { label: 'Sign out', icon: LogOut, onSelect: () => { void signOut(); } },
        ]}>
          {(props) => <IconButton {...props} icon={UserRound} label="Account" />}
        </MenuButton>
      </header>
      {changing && (
        <ChangePasswordDialog narrow={narrow} onClose={() => setChanging(false)}
          onDone={() => { setChanging(false); toast.show('Password changed'); }} />
      )}
      {toast.element}
    </>
  );
}
