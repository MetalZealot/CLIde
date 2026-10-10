import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Eraser, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useRegisterHeaderMenu, type HeaderMenuSection } from '../../../contexts/HeaderMenuContext';
import { useTheme } from '../../../contexts/AppearancePreferencesContext';
import { cn } from '../../../lib/utils';
import type { Project } from '../../../types/app';
import { getTerminalSession } from '../utils/terminalSession';

import TerminalKeyBar from './TerminalKeyBar';

const PASTE_NOTICE_MS = 3000;

type TerminalPanelProps = {
  project: Project;
  isMobile: boolean;
};

function shellName(shell: string | null): string {
  return shell?.split(/[\\/]/).pop() || 'shell';
}

/** The Terminal tab: a plain shell in the selected checkout that survives tab switches and dropped connections. */
export default function TerminalPanel({ project, isMobile }: TerminalPanelProps) {
  const { t } = useTranslation();
  const { isDarkMode } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const session = useMemo(() => getTerminalSession(project.fullPath), [project.fullPath]);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [pasteBlocked, setPasteBlocked] = useState(false);

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

  const { status, exitCode, error, shell } = snapshot;
  const name = shellName(shell);

  const headerMenuSection = useMemo<HeaderMenuSection>(() => ({
    status: {
      text: status === 'connected'
        ? t('terminal.status.connected', { shell: name })
        : t(`terminal.status.${status}`),
      isOk: status === 'connected',
    },
    items: [
      {
        key: 'clear',
        label: t('terminal.actions.clear'),
        icon: Eraser,
        onSelect: () => session.clear(),
        disabled: status !== 'connected',
      },
      {
        key: 'restart',
        label: t('terminal.actions.restart'),
        icon: RotateCcw,
        onSelect: () => session.restart(),
        showDividerBefore: true,
      },
    ],
  }), [session, status, name, t]);
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

  return (
    <div className="flex h-full w-full flex-col">
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
      </div>

      {isMobile && (
        <TerminalKeyBar session={session} snapshot={snapshot} onPasteBlocked={() => setPasteBlocked(true)} />
      )}
    </div>
  );
}
