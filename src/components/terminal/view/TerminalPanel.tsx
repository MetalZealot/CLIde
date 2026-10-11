import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Eraser, Plus, RotateCcw, Search, Settings, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useRegisterHeaderMenu, type HeaderMenuSection } from '../../../contexts/HeaderMenuContext';
import { useTheme } from '../../../contexts/AppearancePreferencesContext';
import { cn } from '../../../lib/utils';
import type { Project } from '../../../types/app';
import { getTerminalTabs, shellName, tabLabel, type TerminalTab } from '../utils/terminalTabs';

import TerminalKeyBar from './TerminalKeyBar';
import TerminalSearchBar from './TerminalSearchBar';
import TerminalSettingsSheet from './TerminalSettingsSheet';
import TerminalTabStrip from './TerminalTabStrip';

const PASTE_NOTICE_MS = 3000;
const TOAST_MS = 1800;

type TerminalPanelProps = {
  project: Project;
  isMobile: boolean;
};

/** The Terminal tab: plain shells in the selected checkout that survive tab switches and dropped connections. */
export default function TerminalPanel({ project, isMobile }: TerminalPanelProps) {
  const { t } = useTranslation();
  const { isDarkMode } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const store = useMemo(() => getTerminalTabs(project.fullPath), [project.fullPath]);
  const { tabs, active, closed } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const session = active.session;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [pasteBlocked, setPasteBlocked] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Before the attach effect, so a first open already has the right colours.
  useEffect(() => {
    session.setDark(isDarkMode);
  }, [session, isDarkMode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    session.attachTo(container);
    return () => session.detach();
  }, [session]);

  useEffect(() => {
    if (!pasteBlocked) {
      return undefined;
    }
    const timer = window.setTimeout(() => setPasteBlocked(false), PASTE_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [pasteBlocked]);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }
    const timer = window.setTimeout(() => setNotice(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Leaving the view ends the undo window rather than holding a dead shell open.
  useEffect(() => () => store.finishClose(), [store]);

  const { status, exitCode, error, shell } = snapshot;
  const name = shellName(shell);
  const label = tabLabel(active, tabs.length);

  const closeTab = (tab: TerminalTab) => {
    if (!store.close(tab)) {
      setNotice(t('terminal.toast.last'));
    }
  };

  const headerMenuSection = useMemo<HeaderMenuSection>(() => ({
    status: {
      text: status === 'connected'
        ? t('terminal.status.connected', { shell: label })
        : t(`terminal.status.${status}`),
      isOk: status === 'connected',
    },
    items: [
      { key: 'new', label: t('terminal.actions.new'), icon: Plus, onSelect: () => store.add() },
      { key: 'search', label: t('terminal.actions.search'), icon: Search, onSelect: () => setSearchOpen(true) },
      {
        key: 'clear',
        label: t('terminal.actions.clear'),
        icon: Eraser,
        onSelect: () => session.clear(),
        disabled: status !== 'connected',
      },
      { key: 'settings', label: t('terminal.actions.settings'), icon: Settings, onSelect: () => setSettingsOpen(true) },
      {
        key: 'restart',
        label: t('terminal.actions.restart'),
        icon: RotateCcw,
        onSelect: () => session.restart(),
        showDividerBefore: true,
      },
      {
        key: 'close',
        label: t('terminal.actions.close'),
        icon: X,
        isDanger: true,
        onSelect: () => {
          if (!store.close(active)) setNotice(t('terminal.toast.last'));
        },
      },
    ],
  }), [store, session, active, status, label, t]);
  useRegisterHeaderMenu(headerMenuSection);

  const restartButton = (
    <button
      type="button"
      onClick={() => session.restart()}
      className="ml-auto rounded px-1.5 py-1 text-[12.5px] font-semibold text-primary"
    >
      {t('terminal.actions.restart')}
    </button>
  );

  const toastText = closed ? t('terminal.toast.closed', { name: tabLabel(closed, tabs.length + 1, shell) }) : notice;

  return (
    <div className="flex h-full w-full flex-col">
      {tabs.length > 1 && (
        <TerminalTabStrip store={store} tabs={tabs} active={active} activeShell={shell} onClose={closeTab} />
      )}
      {searchOpen && (
        <TerminalSearchBar session={session} result={snapshot.search} onClose={() => setSearchOpen(false)} />
      )}
      {status === 'reconnecting' && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-[12.5px] text-amber-600 dark:text-amber-500">
          <span aria-hidden="true" className="h-[7px] w-[7px] flex-shrink-0 rounded-full bg-current motion-safe:animate-pulse" />
          {t('terminal.note.reconnecting')}
        </div>
      )}
      {(status === 'exited' || status === 'error') && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-3 py-1 text-[12.5px] text-muted-foreground">
          <span aria-hidden="true" className="h-[7px] w-[7px] flex-shrink-0 rounded-full bg-muted-foreground" />
          <span className="min-w-0 truncate">
            {status === 'exited' ? t('terminal.note.exited', { shell: name, code: exitCode ?? 0 }) : error}
          </span>
          {restartButton}
        </div>
      )}
      {pasteBlocked && (
        <div className="flex-shrink-0 border-b border-border px-3 py-1.5 text-[12.5px] text-muted-foreground">
          {t('terminal.note.pasteBlocked')}
        </div>
      )}

      <div
        className={cn('relative min-h-0 flex-1 p-2 transition-opacity', status === 'reconnecting' && 'opacity-45')}
        style={{ backgroundColor: isDarkMode ? '#141414' : '#fbfaf7' }}
      >
        <div ref={containerRef} className="h-full w-full" />
        {toastText && (
          <div
            role="status"
            className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-[10px] bg-foreground px-3 py-2 text-[13px] text-background"
          >
            <span>{toastText}</span>
            {closed && (
              <button type="button" onClick={() => store.undoClose()} className="font-bold text-primary">
                {t('terminal.toast.undo')}
              </button>
            )}
          </div>
        )}
      </div>

      {isMobile && (
        <TerminalKeyBar session={session} snapshot={snapshot} onPasteBlocked={() => setPasteBlocked(true)} />
      )}

      <TerminalSettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
