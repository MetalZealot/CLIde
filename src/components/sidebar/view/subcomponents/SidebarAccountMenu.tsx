import { useRef, useState, type ComponentType } from 'react';
import { Archive, CircleUser, LogOut, Settings } from 'lucide-react';
import type { TFunction } from 'i18next';

import { useAuth } from '../../../auth';
import AccountAvatar from '../../../auth/view/AccountAvatar';
import { ContextMenuOverlay, anchorFromElement } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';

type SidebarAccountMenuProps = {
  /** Opens Settings; the account row deep-links straight to its own screen. */
  onShowSettings: (screenId?: string) => void;
  isArchiveOpen: boolean;
  onShowArchive: () => void;
  t: TFunction;
};

function MenuRow({
  label,
  icon: Icon,
  isActive,
  isDestructive,
  onSelect,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  isActive?: boolean;
  isDestructive?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-current={isActive ? 'true' : undefined}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent active:bg-accent',
        isDestructive ? 'text-destructive' : 'text-foreground',
      )}
    >
      <Icon className={cn('h-4 w-4 flex-shrink-0', !isDestructive && 'text-muted-foreground')} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * The account button that anchors the sidebar footer, and the menu it opens.
 *
 * This is the one place the app's own settings live now. Settings and Archive
 * used to sit side by side in the footer as peers, which read as two equally
 * important destinations; they are both infrequent, and putting them behind the
 * account collapses the footer to a single identity control — the shape
 * everything from ChatGPT to Discord converged on — and leaves the row's other
 * half for the action that is actually frequent.
 *
 * Archive stays a mode toggle rather than a screen, so its row reports state
 * with `aria-current` instead of navigating.
 */
export default function SidebarAccountMenu({
  onShowSettings,
  isArchiveOpen,
  onShowArchive,
  t,
}: SidebarAccountMenuProps) {
  const { user, logout } = useAuth();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const username = user?.username ?? '';

  const choose = (action: () => void) => {
    setIsOpen(false);
    action();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={t('actions.accountMenu', 'Account menu')}
        onClick={() => setIsOpen((current) => !current)}
        className="flex max-w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/60 active:bg-accent/60"
      >
        <AccountAvatar avatar={user?.avatar} username={username} className="h-7 w-7 text-xs" />
        <span className="min-w-0 truncate text-sm text-foreground">{username}</span>
      </button>

      {isOpen && buttonRef.current && (
        <ContextMenuOverlay
          anchor={anchorFromElement(buttonRef.current, { x: 0, y: 0 })}
          onDismiss={() => setIsOpen(false)}
          ariaLabel={t('actions.accountMenu', 'Account menu')}
          // Always upward: the button is the bottom-most thing in the sidebar,
          // so "auto" would only ever measure its way back to the same answer.
          placement="above"
          className="sidebar-context-menu min-w-52 max-w-72 rounded-xl py-1"
        >
          <MenuRow
            label={t('actions.account', 'Account')}
            icon={CircleUser}
            onSelect={() => choose(() => onShowSettings('account'))}
          />
          <MenuRow
            label={t('actions.settings')}
            icon={Settings}
            onSelect={() => choose(() => onShowSettings())}
          />
          <MenuRow
            label={t('actions.archive', 'Archive')}
            icon={Archive}
            isActive={isArchiveOpen}
            onSelect={() => choose(onShowArchive)}
          />

          <div className="my-1 border-t border-border" />

          <MenuRow
            label={t('actions.logOut', 'Log out')}
            icon={LogOut}
            isDestructive
            onSelect={() => choose(logout)}
          />
        </ContextMenuOverlay>
      )}
    </>
  );
}
