import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Download, Pencil, Pin, Repeat, Search, Trash2 } from 'lucide-react';

import { useRegisterHeaderMenu, type HeaderMenuItem, type HeaderMenuSection } from '../../../contexts/HeaderMenuContext';
import { useProviderCapabilities } from '../../../hooks/useProviderCapabilities';
import { api } from '../../../utils/api';
import type { LLMProvider, Project, ProjectSession, SessionActions } from '../../../types/app';
import type { ChatMessage } from '../types/types';
import { DEFAULT_CHAT_EXPORT_INCLUDE } from '../utils/chatExport';
import { ChatExportOptions } from '../view/subcomponents/ChatExportMenu';
import SessionRenameDialog from '../view/subcomponents/SessionRenameDialog';
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
  findHeaderContent,
}: UseChatHeaderMenuArgs) {
  const { t } = useTranslation('sidebar');
  const { t: tChat } = useTranslation('chat');
  const [renameTarget, setRenameTarget] = useState<SessionTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SessionTarget | null>(null);
  const [exportInclude, setExportInclude] = useState(DEFAULT_CHAT_EXPORT_INCLUDE);
  // Pinning patches the project list, not the selected-session copy, and an
  // older session may not be in the list at all.
  const [starOverride, setStarOverride] = useState<{ sessionId: string; isStarred: boolean } | null>(null);
  // Same reason as the star override: the standing mode is stored on the
  // session row, and the list copy only catches up on its next fetch.
  const [autoContinueOverride, setAutoContinueOverride] =
    useState<{ sessionId: string; autoContinue: boolean } | null>(null);
  const providerCapabilities = useProviderCapabilities();

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
    // An override outranks the list copy here, unlike the star: nothing
    // refetches the list when the mode changes.
    const autoContinue = autoContinueOverride?.sessionId === sessionId
      ? autoContinueOverride.autoContinue
      : Boolean(session.autoContinue ?? selectedSession.autoContinue);
    const canScheduleOnUsageReset = provider
      ? providerCapabilities?.[provider as LLMProvider]?.supportsUsageResetAlerts === true
      : false;
    const name = session.summary || session.name || '';

    const items: HeaderMenuItem[] = [
      {
        key: 'star',
        label: isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites'),
        icon: Pin,
        onSelect: () => {
          setStarOverride({ sessionId, isStarred: !isStarred });
          void sessionActions.toggleStar(sessionId, isStarred).then((settled) => {
            setStarOverride({ sessionId, isStarred: settled });
          });
        },
      },
      {
        key: 'rename',
        label: t('actions.rename'),
        icon: Pencil,
        onSelect: () => setRenameTarget({ sessionId, name }),
      },
      // Only where a usage limit lifts on its own: on the others there is no
      // reset for a continue to wait on.
      ...(canScheduleOnUsageReset
        ? [{
            key: 'auto-continue',
            label: autoContinue
              ? tChat('autoContinue.stopAlways', { defaultValue: 'Stop continuing automatically' })
              : tChat('autoContinue.always', { defaultValue: 'Always continue after a limit' }),
            icon: Repeat,
            onSelect: () => {
              const next = !autoContinue;
              setAutoContinueOverride({ sessionId, autoContinue: next });
              void api.toggleSessionAutoContinue(sessionId)
                .then((response: Response) => (response.ok ? response.json() : null))
                .then((payload: { data?: { autoContinue?: boolean } } | null) => {
                  const settled = payload?.data?.autoContinue;
                  setAutoContinueOverride({
                    sessionId,
                    autoContinue: typeof settled === 'boolean' ? settled : !next,
                  });
                })
                .catch(() => setAutoContinueOverride({ sessionId, autoContinue: !next }));
            },
          }]
        : []),
      ...(chatMessages.length > 0
        ? [{
            key: 'find',
            label: tChat('findInChat.menuLabel', { defaultValue: 'Find in Chat' }),
            icon: Search,
            onSelect: onOpenFind,
          }]
        : []),
      ...(chatMessages.length > 0
        ? [{
            key: 'export',
            label: tChat('export.menuLabel', { defaultValue: 'Export…' }),
            icon: Download,
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
      {
        // Splits what keeps the session from what removes it, as the sidebar's menu does.
        // Archive is recoverable from the sidebar's Archive view, so it needs no confirmation.
        showDividerBefore: true,
        key: 'archive',
        label: t('actions.archive', 'Archive'),
        icon: Archive,
        onSelect: () => removeSession(sessionId, false),
      },
      {
        key: 'delete',
        label: t('actions.delete'),
        icon: Trash2,
        isDanger: true,
        onSelect: () => setDeleteTarget({ sessionId, name }),
      },
    ];

    return {
      items,
      headerContent: findHeaderContent,
      sessionIds: { appId: sessionId, providerId: providerSessionId, provider },
    };
  }, [
    isVisible,
    removeSession,
    selectedSession,
    listedSession,
    starOverride,
    autoContinueOverride,
    providerCapabilities,
    sessionActions,
    chatMessages,
    assistantLabel,
    hasMoreMessages,
    isLoadingAllMessages,
    loadAllMessages,
    exportInclude,
    onOpenFind,
    findHeaderContent,
    t,
    tChat,
  ]);
  useRegisterHeaderMenu(section);

  const closeRename = useCallback(() => setRenameTarget(null), []);

  const submitRename = useCallback(async (name: string) => {
    if (!renameTarget) {
      return;
    }
    const ok = await sessionActions.rename(renameTarget.sessionId, name);
    if (ok) {
      setRenameTarget(null);
    } else {
      alert(t('messages.renameSessionFailed'));
    }
  }, [renameTarget, sessionActions, t]);

  const dialogs: ReactNode = (
    <>
      <SessionRenameDialog
        initialName={renameTarget?.name ?? null}
        onClose={closeRename}
        onSubmit={submitRename}
      />
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
