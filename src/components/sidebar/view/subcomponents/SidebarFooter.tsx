import { Archive, Settings, ArrowUpCircle, AlertTriangle, MessageSquarePlus } from 'lucide-react';
import type { TFunction } from 'i18next';
import { IS_PLATFORM } from '../../../../constants/config';
import type { ReleaseInfo } from '../../../../types/sharedTypes';

const GITHUB_REPO_URL = 'https://github.com/siteboon/claudecodeui';

type SidebarFooterProps = {
  updateAvailable: boolean;
  restartRequired: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  currentVersion: string;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  onOpenNewSession: () => void;
  isArchiveOpen: boolean;
  onShowArchive: () => void;
  t: TFunction;
};

export default function SidebarFooter({
  updateAvailable,
  restartRequired,
  releaseInfo,
  latestVersion,
  currentVersion,
  onShowVersionModal,
  onShowSettings,
  onOpenNewSession,
  isArchiveOpen,
  onShowArchive,
  t,
}: SidebarFooterProps) {
  return (
    <div className="flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      {/* Restart-required banner: the running server version differs from the
          installed/frontend version (updated but not restarted). */}
      {restartRequired && (
        <>
          <div className="nav-divider" />
          <div className="px-2 py-1.5 md:px-2 md:py-1.5">
            <div className="flex items-center gap-2.5 rounded-lg border border-amber-300/60 bg-amber-50/80 px-2.5 py-2 dark:border-amber-700/40 dark:bg-amber-900/15">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500 dark:text-amber-400" />
              <span className="min-w-0 flex-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                {t('version.restartRequired')}
              </span>
            </div>
          </div>
        </>
      )}

      {/* Update banner */}
      {updateAvailable && (
        <>
          <div className="nav-divider" />
          {/* Desktop update */}
          <div className="hidden px-2 py-1.5 md:block">
            <button
              className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-blue-50/80 dark:hover:bg-blue-900/15"
              onClick={onShowVersionModal}
            >
              <div className="relative flex-shrink-0">
                <ArrowUpCircle className="h-4 w-4 text-blue-500 dark:text-blue-400" />
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-normal text-blue-600 dark:text-blue-300">
                  {releaseInfo?.title || `v${latestVersion}`}
                </span>
                <span className="text-[10px] text-blue-500/70 dark:text-blue-400/60">
                  {t('version.updateAvailable')}
                </span>
              </div>
            </button>
          </div>

          {/* Mobile update */}
          <div className="px-3 py-2 md:hidden">
            <button
              className="flex h-11 w-full items-center gap-3 rounded-xl border border-blue-200/60 bg-blue-50/80 px-3.5 transition-all active:scale-[0.98] dark:border-blue-700/40 dark:bg-blue-900/15"
              onClick={onShowVersionModal}
            >
              <div className="relative flex-shrink-0">
                <ArrowUpCircle className="h-4 w-4 text-blue-500 dark:text-blue-400" />
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-normal text-blue-600 dark:text-blue-300">
                  {releaseInfo?.title || `v${latestVersion}`}
                </span>
                <span className="text-xs text-blue-500/70 dark:text-blue-400/60">
                  {t('version.updateAvailable')}
                </span>
              </div>
            </button>
          </div>
        </>
      )}

      {/* Settings + Archive, and on mobile the primary action */}
      <div className="nav-divider" />

      <div className="px-2 py-1.5">
        <div className="flex items-center gap-1">
          <button
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            onClick={onShowSettings}
          >
            <Settings className="h-3.5 w-3.5" />
            <span className="text-sm">{t('actions.settings')}</span>
          </button>

          {/*
            New Chat lives here on mobile rather than in the header: the drawer
            is full-height, so the header is the one corner a thumb cannot
            reach. It is a filled pill because it is the only primary action in
            the sidebar, and an ordinary row in this flex line rather than a
            floating button, so it never covers the list above it.
          */}
          <button
            type="button"
            onClick={onOpenNewSession}
            aria-label={t('sessions.newSession')}
            title={t('sessions.newSession')}
            className="flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-transform active:scale-95 md:hidden"
          >
            <MessageSquarePlus strokeWidth={1.75} className="h-4 w-4" />
            <span>{t('sessions.newSession')}</span>
          </button>
          <button
            type="button"
            onClick={onShowArchive}
            aria-pressed={isArchiveOpen}
            aria-label={t('actions.archive', 'Archive')}
            title={t('actions.archive', 'Archive')}
            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors ${
              isArchiveOpen
                ? 'bg-muted/60 text-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            }`}
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Desktop version brand line (OSS mode only) */}
      {!IS_PLATFORM && (
        <div className="hidden px-3 py-2 text-center md:block">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-muted-foreground/40 transition-colors hover:text-muted-foreground"
          >
            CLIde v{currentVersion} – {t('branding.openSource')}
          </a>
        </div>
      )}
    </div>
  );
}
