import { useRef, useState, type ComponentType } from 'react';
import { BarChart3, CircleUser, LogOut, Settings } from 'lucide-react';
import type { TFunction } from 'i18next';

import { useAuth } from '../../../auth';
import AccountAvatar from '../../../auth/view/AccountAvatar';
import { ContextMenuOverlay, anchorFromElement } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';

type SidebarAccountMenuProps = {
  /** Opens Settings; the account row deep-links straight to its own screen. */
  onShowSettings: (screenId?: string) => void;
  onShowUsage: () => void;
  t: TFunction;
};

function MenuRow({
  label,
  icon: Icon,
  isDestructive,
  onSelect,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  isDestructive?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors',
        isDestructive
          ? 'text-red-600 hover:bg-red-50 focus-visible:bg-red-50 active:bg-red-50 dark:text-red-400 dark:hover:bg-red-950 dark:focus-visible:bg-red-950 dark:active:bg-red-950'
          : 'text-foreground hover:bg-accent focus-visible:bg-accent active:bg-accent',
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
 * Account and Settings live behind the identity control; session navigation
 * belongs to the sidebar utility row instead.
 */
export default function SidebarAccountMenu({
  onShowSettings,
  onShowUsage,
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
        className="flex min-w-0 max-w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/60 active:bg-accent/60"
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
            label={t('common:usageDashboard.title', 'Usage')}
            icon={BarChart3}
            onSelect={() => choose(onShowUsage)}
          />
          <MenuRow
            label={t('actions.settings')}
            icon={Settings}
            onSelect={() => choose(() => onShowSettings())}
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
