import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Download, Pin, Search, SquareTerminal, Trash2 } from 'lucide-react';

import { useRegisterHeaderMenu, type HeaderMenuItem, type HeaderMenuSection } from '../../../contexts/HeaderMenuContext';
import type { Project, ProjectSession, SessionActions } from '../../../types/app';
import type { ChatMessage } from '../types/types';
import { DEFAULT_CHAT_EXPORT_INCLUDE } from '../utils/chatExport';
import { ChatExportOptions } from '../view/subcomponents/ChatExportMenu';
import SessionDeleteDialog from '../../sidebar/view/subcomponents/SessionDeleteDialog';

type UseChatHeaderMenuArgs = {
  isVisible: boolean;
  projects: Project[];
  selectedSession: ProjectSession | null;
  sessionActions: SessionActions;
  chatMessages: ChatMessage[];
  assistantLabel: string;
  hasMoreMessages: boolean;
  isLoadingAllMessages: boolean;
  loadAllMessages: () => Promise<ChatMessage[] | null>;
  onOpenFind: () => void;
  onOpenInCli?: () => void;
  findHeaderContent: ReactNode | null;
};

type SessionTarget = { sessionId: string; name: string };

/** Puts the open session's actions in the header menu while Chat is the visible view. */
export function useChatHeaderMenu({
  isVisible,
  projects,
  selectedSession,
  sessionActions,
  chatMessages,
  assistantLabel,
  hasMoreMessages,
  isLoadingAllMessages,
  loadAllMessages,
  onOpenFind,
  onOpenInCli,
  findHeaderContent,
}: UseChatHeaderMenuArgs) {
  const { t } = useTranslation('sidebar');
  const { t: tChat } = useTranslation('chat');
  const [deleteTarget, setDeleteTarget] = useState<SessionTarget | null>(null);
  const [exportInclude, setExportInclude] = useState(DEFAULT_CHAT_EXPORT_INCLUDE);
  // Pinning patches the project list, not the selected-session copy, and an
  // older session may not be in the list at all.
  const [starOverride, setStarOverride] = useState<{ sessionId: string; isStarred: boolean } | null>(null);

  const listedSession = useMemo(() => {
    if (!selectedSession) {
      return null;
    }
    for (const project of projects) {
      const match = project.sessions?.find((session) => session.id === selectedSession.id);
      if (match) {
        return match;
      }
    }
    return null;
  }, [projects, selectedSession]);

  const removeSession = useCallback((sessionId: string, hardDelete: boolean) => {
    void sessionActions.remove(sessionId, hardDelete).then((ok) => {
      if (!ok) {
        alert(hardDelete
          ? t('messages.deleteSessionFailed')
          : t('messages.archiveSessionFailed', 'Failed to archive session. Please try again.'));
      }
    });
  }, [sessionActions, t]);

  const section = useMemo<HeaderMenuSection | null>(() => {
    if (!isVisible || !selectedSession) {
      return null;
    }

    const sessionId = selectedSession.id;
    const session = listedSession ?? selectedSession;
    const isStarred = listedSession
      ? Boolean(listedSession.isStarred)
      : starOverride?.sessionId === sessionId
        ? starOverride.isStarred
        : Boolean(selectedSession.isStarred);
    const providerSessionId = session.providerSessionId ?? selectedSession.providerSessionId;
    const provider = session.__provider ?? session.provider ?? selectedSession.__provider;
    const name = session.summary || session.name || '';

    const items: HeaderMenuItem[] = [
      {
        key: 'star',
        label: isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites'),
        icon: Pin,
        sheetLayout: 'tile',
        isActive: isStarred,
        onSelect: () => {
          setStarOverride({ sessionId, isStarred: !isStarred });
          void sessionActions.toggleStar(sessionId, isStarred).then((settled) => {
            setStarOverride({ sessionId, isStarred: settled });
          });
        },
      },
      ...(chatMessages.length > 0
        ? [{
            key: 'find',
            label: tChat('findInChat.menuLabel', { defaultValue: 'Find in Chat' }),
            shortLabel: tChat('findInChat.tileLabel', { defaultValue: 'Find' }),
            icon: Search,
            sheetLayout: 'tile' as const,
            onSelect: onOpenFind,
          }]
        : []),
      ...(chatMessages.length > 0
        ? [{
            key: 'export',
            label: tChat('export.menuLabel', { defaultValue: 'Export…' }),
            shortLabel: tChat('export.tileLabel', { defaultValue: 'Export' }),
            icon: Download,
            sheetLayout: 'tile' as const,
            renderPanel: (close: () => void) => (
              <ChatExportOptions
                messages={chatMessages}
                sessionTitle={selectedSession.title}
                assistantLabel={assistantLabel}
                hasMoreMessages={hasMoreMessages}
                isLoadingAllMessages={isLoadingAllMessages}
                loadAllMessages={loadAllMessages}
                include={exportInclude}
                onIncludeChange={setExportInclude}
                onExported={close}
              />
            ),
          }]
        : []),
      ...(onOpenInCli
        ? [{
            key: 'open-in-cli',
            label: tChat('shell.openInCli'),
            shortLabel: tChat('shell.openInCliTile', { defaultValue: 'CLI' }),
            icon: SquareTerminal,
            sheetLayout: 'tile' as const,
            onSelect: onOpenInCli,
          }]
        : []),
      {
        // Splits what keeps the session from what removes it, as the sidebar's menu does.
        // Archive is recoverable from the sidebar's Archive view, so it needs no confirmation.
        showDividerBefore: true,
        key: 'archive',
        label: t('actions.archive', 'Archive'),
        icon: Archive,
        sheetLayout: 'half',
        onSelect: () => removeSession(sessionId, false),
      },
      {
        key: 'delete',
        label: t('actions.delete'),
        icon: Trash2,
        isDanger: true,
        sheetLayout: 'half',
        onSelect: () => setDeleteTarget({ sessionId, name }),
      },
    ];

    return {
      items,
      headerContent: findHeaderContent,
      sessionIds: { appId: sessionId, providerId: providerSessionId, provider },
      rename: {
        name,
        submit: (next: string) => {
          void sessionActions.rename(sessionId, next).then((ok) => {
            if (!ok) alert(t('messages.renameSessionFailed'));
          });
        },
      },
    };
  }, [
    isVisible,
    removeSession,
    selectedSession,
    listedSession,
    starOverride,
    sessionActions,
    chatMessages,
    assistantLabel,
    hasMoreMessages,
    isLoadingAllMessages,
    loadAllMessages,
    exportInclude,
    onOpenFind,
    onOpenInCli,
    findHeaderContent,
    t,
    tChat,
  ]);
  useRegisterHeaderMenu(section);

  const dialogs: ReactNode = (
    <>
      {deleteTarget && (
        <SessionDeleteDialog
          sessionTitle={deleteTarget.name}
          isArchived={false}
          onConfirm={(hardDelete) => {
            setDeleteTarget(null);
            removeSession(deleteTarget.sessionId, hardDelete);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );

  return { dialogs };
}
