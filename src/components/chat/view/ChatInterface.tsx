import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownIcon, XIcon } from 'lucide-react';

import { ChatBrowserPreview, useChatBrowser } from '../../browser-use';
import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import PermissionContext from '../../../contexts/PermissionContext';
import type { ChatInterfaceProps, PermissionMode } from '../types/types';
import type { LLMProvider } from '../../../types/app';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { isImageAttachment, uploadAttachmentFiles, useChatComposerState } from '../hooks/useChatComposerState';
import { authenticatedFetch } from '../../../utils/api';
import { useAsyncQuestions } from '../hooks/useAsyncQuestions';
import { useChatHeaderMenu } from '../hooks/useChatHeaderMenu';
import { useChatFind } from '../hooks/useChatFind';
import { useAutoContinueOffer } from '../hooks/useAutoContinueOffer';
import {
  useScheduledMessages,
  type ScheduledMessage,
  type ScheduledMessageTrigger,
  type ScheduledEditLoss,
} from '../hooks/useScheduledMessages';
import { formatClockTime } from '../../../utils/formatTime';
import { useProviderCapabilities } from '../../../hooks/useProviderCapabilities';
import { useSessionStore } from '../../../stores/useSessionStore';
import { useProviderAuthStatus } from '../../provider-auth/hooks/useProviderAuthStatus';

import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import ChatComposer from './subcomponents/ChatComposer';
import NewSessionLauncher from './subcomponents/NewSessionLauncher';
import CommandResultModal from './subcomponents/CommandResultModal';
import ConversationBranchPickerModal from './subcomponents/ConversationBranchPickerModal';
import AsyncQuestionPanel from './subcomponents/AsyncQuestionPanel';
import QueuedAsyncAnswersCard from './subcomponents/QueuedAsyncAnswersCard';
import ChatFindBar from './subcomponents/ChatFindBar';

/** How long the Stop button stays armed after the first Escape/tap before it resets. */
const STOP_ARM_TIMEOUT_MS = 4000;

/**
 * How long after a scheduled message fires the transcript is re-read, so its
 * reply appears even if this client heard none of the run's own frames. Long
 * enough that a normal turn has already drawn itself from the live stream.
 */
/** Phase 3 makes this editable; until then the offer sends one fixed word. */
const AUTO_CONTINUE_MESSAGE = 'Continue';

const SCHEDULED_SEND_RECONCILE_MS = 60_000;

function ChatInterface({
  projects,
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  onFileOpen,
  onInputFocusChange,
  onPermissionAttentionChange,
  onSessionProcessing,
  onSessionIdle,
  processingSessions,
  onNavigateToSession,
  onSessionEstablished,
  onShowSettings,
  showRawParameters,
  showThinking,
  sendByCtrlEnter,
  enterToSend,
  externalMessageUpdate,
  newSessionTrigger,
  onShowAllTasks,
  onNewSessionTarget,
  onProjectsRefresh,
  onCreateWorktree,
  onAdoptCheckout,
  sessionActions,
  isVisible,
  onOpenBrowser,
}: ChatInterfaceProps) {
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const { subscribe, isConnected, probeConnection, getReplayProgress } = useWebSocket();
  const { t } = useTranslation('chat');
  const {
    providerAuthStatus,
    refreshProviderAuthStatuses,
  } = useProviderAuthStatus();

  // "Connection lost" is only meaningful after a first successful connect —
  // without this guard the banner would flash on every cold page load while
  // the initial websocket handshake is still in flight.
  const hasBeenConnectedRef = useRef(false);
  useEffect(() => {
    if (isConnected) {
      hasBeenConnectedRef.current = true;
    }
  }, [isConnected]);
  const showConnectionLostBanner = hasBeenConnectedRef.current && !isConnected;

  const sessionStore = useSessionStore();
  // Streaming buffers are per session: background sessions stream concurrently
  // with the visible one, and a shared buffer interleaves their text.
  const streamTimersRef = useRef(new Map<string, number>());
  const accumulatedStreamsRef = useRef(new Map<string, string>());
  // When each session's `chat.subscribe` was last sent; idle acks older than
  // a later local request are discarded as stale.
  const statusCheckSentAtRef = useRef(new Map<string, number>());
  // Replay progress (`lastSeq` + `runId`) is tracked at the transport level —
  // see WebSocketContext's `getReplayProgress` — so it survives this
  // component unmounting and stays exact under the dedup guard.

  const resetStreamingState = useCallback(() => {
    for (const timer of streamTimersRef.current.values()) {
      clearTimeout(timer);
    }
    streamTimersRef.current.clear();
    accumulatedStreamsRef.current.clear();
  }, []);

  const settingsSessionId = selectedSession?.id ?? null;
  const settingsSlot = settingsSessionId
    ? sessionStore.getSessionSlot(settingsSessionId)
    : undefined;

  const {
    provider,
    selectProvider,
    availableProviders,
    currentProviderEffort,
    currentProviderEffortOptions,
    currentProviderModel,
    currentProviderModelOptions,
    permissionMode,
    collaborationMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    availablePermissionModes,
    availableCollaborationModes,
    selectPermissionMode,
    selectCollaborationMode,
    togglePermissionMode,
    toggleCollaborationMode,
    providerModelsLoading,
    selectProviderModel,
    selectProviderEffort,
    reconcileStoredEffort,
    resolvePermissionModeForProvider,
    getSupportsRewindForProvider,
    getSupportsForkForProvider,
    getSupportsCompactCommandForProvider,
  } = useChatProviderState({
    selectedSession,
    selectedProject,
    // SessionStore is the single owner of both; the provider-level values in
    // the hook are only seeds for a chat that has no session of its own yet.
    sessionModel: settingsSlot?.model ?? null,
    sessionEffort: settingsSlot?.effort ?? null,
  });

  const hasPendingPermission = pendingPermissionRequests.length > 0;
  useEffect(() => {
    onPermissionAttentionChange?.(hasPendingPermission);
    return () => onPermissionAttentionChange?.(false);
  }, [hasPendingPermission, onPermissionAttentionChange]);

  const {
    chatMessages,
    addMessage,
    sessionActivity,
    isProcessing,
    canAbortSession,
    currentSessionId,
    setCurrentSessionId,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    visibleMessages,
    loadAllMessages,
    isLoadingAllMessages,
    createDiff,
    scrollContainerRef,
    messagesContentRef,
    scrollToBottom,
    scrollToBottomAndReset,
  } = useChatSessionState({
    selectedProject,
    selectedSession,
    ws,
    sendMessage,
    externalMessageUpdate,
    newSessionTrigger,
    processingSessions,
    onSessionIdle,
    resetStreamingState,
    statusCheckSentAtRef,
    getReplayProgress,
    sessionStore,
  });

  // Brand-new conversation: the composer allocated a stable session id via
  // the session gateway before the first send. Record it locally and put it
  // in the URL — this id never changes again, so there is no later handoff.
  const handleSessionEstablished = useCallback<NonNullable<ChatInterfaceProps['onSessionEstablished']>>((sessionId, context) => {
    setCurrentSessionId(sessionId);
    // Until this id existed the chat ran on the provider seed. Hand that effort
    // to the session now, so the conversation keeps what it started with when
    // the seed later moves on with some other chat.
    sessionStore.setEffort(sessionId, currentProviderEffort);
    void selectProviderEffort(provider, currentProviderEffort, sessionId).catch((error) => {
      console.error('Error recording the initial reasoning effort:', error);
    });
    onSessionEstablished?.(sessionId, context);
    onNavigateToSession?.(sessionId);
  }, [
    currentProviderEffort,
    onNavigateToSession,
    onSessionEstablished,
    provider,
    selectProviderEffort,
    sessionStore,
    setCurrentSessionId,
  ]);

  // Filled in below, once the scheduled-message edit it routes to exists.
  const interceptSubmitRef = useRef<(() => boolean) | null>(null);

  const {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    filteredCommands,
    frequentCommands,
    slashCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedFiles,
    setAttachedFiles,
    buildSendOptions,
    ensureSessionId,
    uploadingFiles,
    fileErrors,
    attachmentRejections,
    dismissAttachmentRejections,
    getRootProps,
    getInputProps,
    isDragActive,
    handleSubmit,
    queuedDraft,
    editQueuedDraft,
    deleteQueuedDraft,
    pendingRewind,
    beginRewindEdit,
    cancelRewindEdit,
    showRewindPicker,
    closeRewindPicker,
    showForkPicker,
    closeForkPicker,
    forkFromMessage,
    handleVoiceTranscript,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleAbortSession,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    commandModalPayload,
    modelMenuOpenRequest,
    usagePopoverRequest,
    closeCommandModal,
    showContextPopover,
    refreshContextPopover,
    isRefreshingContext,
  } = useChatComposerState({
    selectedProject,
    selectedSession,
    currentSessionId,
    provider,
    permissionMode,
    collaborationMode,
    togglePermissionMode,
    toggleCollaborationMode: availableCollaborationModes.length > 0
      ? toggleCollaborationMode
      : undefined,
    currentProviderModel,
    currentProviderEffort,
    isLoading: isProcessing,
    processingSessions,
    canAbortSession,
    tokenBudget,
    sendMessage,
    sendByCtrlEnter,
    enterToSend,
    sessionStore,
    onSessionProcessing,
    onSessionEstablished: handleSessionEstablished,
    onInputFocusChange,
    onFileOpen,
    onShowSettings,
    scrollToBottom,
    addMessage,
    setIsUserScrolledUp,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    resolvePermissionModeForProvider,
    supportsRewind: getSupportsRewindForProvider(provider),
    supportsFork: getSupportsForkForProvider(provider),
    supportsCompactCommand: getSupportsCompactCommandForProvider(provider),
    interceptSubmitRef,
  });

  const asyncQuestionSendOptions = useMemo(() => ({
    model: currentProviderModel,
    effort: currentProviderEffort,
    permissionMode: resolvePermissionModeForProvider(provider, permissionMode),
    ...(collaborationMode ? { collaborationMode } : {}),
  }), [
    collaborationMode,
    currentProviderEffort,
    currentProviderModel,
    permissionMode,
    provider,
    resolvePermissionModeForProvider,
  ]);
  const asyncQuestions = useAsyncQuestions({
    sessionId: currentSessionId || selectedSession?.id || null,
    provider,
    messages: chatMessages,
    isProcessing,
    sendOptions: asyncQuestionSendOptions,
    sendMessage,
    subscribe,
    sessionStore,
    onSessionProcessing,
  });

  // On WebSocket reconnect, re-fetch the current session's messages from the
  // server so missed streaming events are shown, then re-subscribe — the
  // `chat_subscribed` ack restores or clears the activity indicator, replays
  // missed live events, and re-attaches a still-running stream to this socket.
  const handleWebSocketReconnect = useCallback(async () => {
    if (!selectedProject || !selectedSession) return;
    await sessionStore.refreshFromServer(selectedSession.id);
    statusCheckSentAtRef.current.set(selectedSession.id, Date.now());
    const progress = getReplayProgress(selectedSession.id);
    sendMessage({
      type: 'chat.subscribe',
      sessions: [{
        sessionId: selectedSession.id,
        lastSeq: progress?.seq ?? 0,
        runId: progress?.runId ?? null,
      }],
    });
  }, [selectedProject, selectedSession, sendMessage, sessionStore, getReplayProgress]);

  // Same catch-up when the tab comes back to the foreground.
  //
  // A frozen tab stops running its listener while its socket stays OPEN, so
  // whatever streamed meanwhile is gone with no reconnect to signal it — the
  // conversation just sits missing a turn until something else reloads it.
  // Re-fetching costs one request per foreground and cannot show less than
  // what the transcript holds.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void handleWebSocketReconnect();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [handleWebSocketReconnect]);

  // Shown after a model or effort change made mid-conversation. Both alter the
  // prefix the provider caches against, so the next turn may re-read tokens it
  // would otherwise have reused; nothing in the conversation is lost. Before
  // the first turn there is no cached prefix to lose, so setting up a chat says
  // nothing.
  const [settingsChangeNotice, setSettingsChangeNotice] = useState(false);
  const showSettingsChangeNotice = useCallback(() => {
    if (!(currentSessionId || selectedSession?.id) || chatMessages.length === 0) return;
    setSettingsChangeNotice(true);
  }, [chatMessages.length, currentSessionId, selectedSession?.id]);
  useEffect(() => {
    if (!settingsChangeNotice) return undefined;
    const timer = window.setTimeout(() => setSettingsChangeNotice(false), 8000);
    return () => window.clearTimeout(timer);
  }, [settingsChangeNotice]);

  const handleSelectProviderModel = useCallback(async (targetProvider: typeof provider, model: string, sessionId?: string | null) => {
    const result = await selectProviderModel(targetProvider, model, sessionId);
    if (result.scope === 'session' && sessionId) {
      sessionStore.setModel(sessionId, result.model);
    }
    return result;
  }, [selectProviderModel, sessionStore]);

  const applySessionEffort = useCallback(async (
    nextEffort: string,
    sessionId: string | null,
  ): Promise<boolean> => {
    const previousEffort = sessionId
      ? sessionStore.getSessionSlot(sessionId)?.effort ?? null
      : null;

    // Move the control now: a round-trip's worth of lag on an effort choice
    // reads as a dropped input.
    if (sessionId) {
      sessionStore.setEffort(sessionId, nextEffort);
    }

    try {
      await selectProviderEffort(provider, nextEffort, sessionId);
      return true;
    } catch (error) {
      console.error('Error changing the reasoning effort:', error);
      if (sessionId) {
        sessionStore.setEffort(sessionId, previousEffort);
      }
      return false;
    }
  }, [provider, selectProviderEffort, sessionStore]);

  const handleSelectComposerEffort = useCallback(async (nextEffort: string) => {
    const sessionId = currentSessionId || selectedSession?.id || null;
    if (await applySessionEffort(nextEffort, sessionId)) {
      showSettingsChangeNotice();
    }
  }, [applySessionEffort, currentSessionId, selectedSession?.id, showSettingsChangeNotice]);

  const handleSelectComposerModel = useCallback(async (model: string) => {
    const sessionId = currentSessionId || selectedSession?.id || null;
    await handleSelectProviderModel(provider, model, sessionId);

    // The new model may not offer the effort this session was on. Write the
    // fallback rather than only displaying it, so the stored pick, the composer
    // and the next turn agree on one value.
    const storedEffort = sessionId ? sessionStore.getSessionSlot(sessionId)?.effort ?? null : null;
    if (storedEffort) {
      const reconciled = reconcileStoredEffort(provider, model, storedEffort);
      if (reconciled !== storedEffort) {
        await applySessionEffort(reconciled, sessionId);
      }
    }
    showSettingsChangeNotice();
  }, [
    applySessionEffort,
    currentSessionId,
    handleSelectProviderModel,
    provider,
    reconcileStoredEffort,
    selectedSession?.id,
    sessionStore,
    showSettingsChangeNotice,
  ]);

  // Latest composer text, read from a ref so the realtime listener does not
  // rebind on every keystroke.
  const inputSnapshotRef = useRef(input);
  inputSnapshotRef.current = input;
  const attachedFilesSnapshotRef = useRef(attachedFiles);
  attachedFilesSnapshotRef.current = attachedFiles;

  /**
   * A send was cancelled before the provider ever saw it, so its bubble was
   * retracted; put the text back in the composer to re-send or edit.
   */
  const handleUndeliveredTurnRetracted = useCallback((sessionId: string, content: string) => {
    // Scoped to the visible session: a background session's cancelled turn
    // must not drop its text into the composer being used for another one.
    if (sessionId !== (selectedSession?.id || currentSessionId)) {
      return;
    }
    // Anything typed since pressing Stop is newer than the retracted turn and
    // wins — restoring over it would destroy work.
    if (inputSnapshotRef.current.trim().length > 0) {
      return;
    }
    setInput(content);
  }, [selectedSession?.id, currentSessionId, setInput]);

  const scheduledSessionId = currentSessionId || selectedSession?.id || null;
  // What an open edit loaded into the composer, to tell a real change from none.
  const scheduledEditOriginalRef = useRef<{ content: string; files: File[] } | null>(null);

  // An edit that ended unsaved. A message that sent unchanged is already in the
  // chat, so the composer copy goes quietly; anything else keeps the composer
  // and says why in a muted note, since nothing failed.
  const handleLostScheduledEdit = useCallback((loss: ScheduledEditLoss) => {
    const original = scheduledEditOriginalRef.current;
    scheduledEditOriginalRef.current = null;
    const files = attachedFilesSnapshotRef.current;
    const unchanged = original !== null
      && inputSnapshotRef.current.trim() === original.content.trim()
      && files.length === original.files.length
      && files.every((file, index) => file === original.files[index]);

    if (loss.reason === 'sent' && unchanged) {
      setInput('');
      setAttachedFiles([]);
      return;
    }

    const content = loss.reason === 'sent'
      ? t('input.schedule.editLostSent', {
        defaultValue: 'Sent at {{time}}, before your edit was saved. Your changes are still here.',
        time: loss.sentAt ? formatClockTime(loss.sentAt) : '',
      })
      : loss.reason === 'failed'
        ? t('input.schedule.editLostFailed', {
          defaultValue: 'That scheduled message failed to send, so your edit was not saved. Your text is still here.',
        })
        : loss.reason === 'taken'
          ? t('input.schedule.editLostTaken', {
            defaultValue: 'That scheduled message was opened on another device, so this edit was not saved. Your changes are still here.',
          })
          : t('input.schedule.editLostCancelled', {
            defaultValue: 'That scheduled message was cancelled, so your edit was not saved. Your changes are still here.',
          });
    addMessage({ type: 'assistant', isSystemNotice: true, content, timestamp: new Date() });
  }, [addMessage, setAttachedFiles, setInput, t]);
  const {
    pending: scheduledMessages,
    schedule: scheduleMessage,
    cancel: cancelScheduledMessage,
    editing: scheduledEdit,
    holdForEdit: holdScheduledForEdit,
    saveEdit: saveScheduledEdit,
  } = useScheduledMessages(
    scheduledSessionId,
    subscribe,
    useCallback((content: string, sentAt: Date, attachments: NonNullable<ScheduledMessage['attachments']>) => {
      addMessage({
        type: 'user',
        content,
        images: attachments.filter(isImageAttachment),
        files: attachments.filter((attachment) => !isImageAttachment(attachment)),
        timestamp: sentAt,
      });
      // The turn's own frames are the only thing carrying the reply, and a
      // phone that slept through them gets no second chance from the socket.
      // One re-read of the transcript afterwards puts the answer on screen
      // whatever the connection did meanwhile.
      const sessionId = scheduledSessionId;
      if (!sessionId) return;
      window.setTimeout(() => { void sessionStore.refreshFromServer(sessionId); }, SCHEDULED_SEND_RECONCILE_MS);
    }, [addMessage, scheduledSessionId, sessionStore]),
    handleLostScheduledEdit,
  );
  const providerCapabilities = useProviderCapabilities();
  const canScheduleOnUsageReset = providerCapabilities?.[provider]?.supportsUsageResetAlerts === true;
  const autoContinueOffer = useAutoContinueOffer(
    chatMessages,
    scheduledMessages,
    canScheduleOnUsageReset,
  );

  // Files an edit put back in the composer, mapped to the stored descriptor
  // they came from, so saving reuses the upload instead of repeating it.
  const restoredAttachmentsRef = useRef(new WeakMap<File, unknown>());

  // Uploads whatever the composer holds that is not already stored, keeping order.
  const describeAttachments = useCallback(async (files: File[]): Promise<unknown[]> => {
    const restored = restoredAttachmentsRef.current;
    const uploaded = await uploadAttachmentFiles(files.filter((file) => !restored.has(file)));
    let next = 0;
    return files.map((file) => (restored.has(file) ? restored.get(file) : uploaded[next++]));
  }, []);

  // Stores whatever is in the composer and clears it, the way sending does.
  // Attachments are uploaded now rather than at firing time: the File objects
  // die with this page, so the stored row has to carry durable descriptors —
  // the same reason the queued-draft path uploads before it waits.
  const handleScheduleMessage = useCallback(
    async (trigger: ScheduledMessageTrigger, scheduledFor: string | null, override?: string) => {
      // The Auto-Continue offer supplies its own text: nobody typed this one,
      // so the composer is empty and the normal path would bail.
      const content = (override ?? input).trim();
      if (!content) return;

      let attachments: unknown[] = [];
      if (attachedFiles.length > 0) {
        try {
          attachments = await describeAttachments(attachedFiles);
        } catch (error) {
          console.error('Scheduled message file upload failed:', error);
          return;
        }
      }

      // An open edit saves into the message it holds, keeping its trigger.
      if (scheduledEdit && override === undefined) {
        const options = { ...buildSendOptions(content), attachments } as Record<string, unknown>;
        const outcome = await saveScheduledEdit(content, options);
        if (outcome === 'saved') {
          scheduledEditOriginalRef.current = null;
          setInput('');
          setAttachedFiles([]);
        } else if (outcome === 'unreachable') {
          addMessage({
            type: 'error',
            content: t('input.schedule.editSaveUnreachable', {
              defaultValue: 'Could not reach the server to save this edit. It is still open; try again.',
            }),
            timestamp: new Date(),
          });
        }
        return;
      }

      // A first message needs the session a send would have created, or the
      // row has nothing to fire into.
      const sessionId = scheduledSessionId ?? await ensureSessionId(content);
      if (!sessionId) return;

      const options = { ...buildSendOptions(content), attachments } as Record<string, unknown>;
      // An offer is not the composer's turn: it must not adopt an armed rewind,
      // and it has no draft or attachments of its own to clear.
      if (override !== undefined) delete options.rewindToMessageId;

      const scheduled = await scheduleMessage({ content, trigger, scheduledFor, options }, sessionId);
      if (scheduled && override === undefined) {
        setInput('');
        setAttachedFiles([]);
      }
    },
    [
      addMessage,
      attachedFiles,
      buildSendOptions,
      describeAttachments,
      ensureSessionId,
      input,
      saveScheduledEdit,
      scheduledEdit,
      scheduledSessionId,
      scheduleMessage,
      setAttachedFiles,
      setInput,
      t,
    ],
  );

  // Every way of sending saves into an open edit instead: a send that went out
  // now would leave the held original to send again when its hold ends.
  interceptSubmitRef.current = scheduledEdit
    ? () => {
      void handleScheduleMessage(scheduledEdit.trigger, scheduledEdit.scheduledFor);
      return true;
    }
    : null;

  // The server holds the message while it is rewritten, so it cannot fire
  // mid-edit and still sends if this edit is abandoned. Its text and files come
  // back from the stored copy, which may have been written on another device.
  const handleEditScheduledMessage = useCallback(
    async (message: ScheduledMessage) => {
      const held = await holdScheduledForEdit(message);
      if (!held) return;
      const files = await Promise.all((held.message.attachments ?? []).map(async (descriptor) => {
        const storedName = descriptor.path.split(/[\\/]/).pop();
        if (!storedName) return null;
        try {
          const response = await authenticatedFetch(`/api/assets/files/${encodeURIComponent(storedName)}`);
          if (!response.ok) return null;
          const blob = await response.blob();
          const file = new File([blob], descriptor.name || storedName, {
            type: descriptor.mimeType || blob.type,
          });
          restoredAttachmentsRef.current.set(file, descriptor);
          return file;
        } catch (error) {
          console.error('Could not restore a scheduled attachment:', error);
          return null;
        }
      }));
      if (!held.open()) return;
      const restoredFiles = files.filter((file): file is File => file !== null);
      scheduledEditOriginalRef.current = { content: held.message.content, files: restoredFiles };
      setInput(held.message.content);
      setAttachedFiles(restoredFiles);
    },
    [holdScheduledForEdit, setAttachedFiles, setInput],
  );

  useChatRealtimeHandlers({
    subscribe,
    provider,
    selectedSession,
    currentSessionId,
    setTokenBudget,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    streamTimersRef,
    accumulatedStreamsRef,
    statusCheckSentAtRef,
    onSessionProcessing,
    onSessionIdle,
    onWebSocketReconnect: handleWebSocketReconnect,
    onUndeliveredTurnRetracted: handleUndeliveredTurnRetracted,
    sessionStore,
  });

  // Stop must never silently no-op: a half-open socket accepts the
  // `chat.abort` send without delivering it. Probing right after the send
  // forces dead-connection detection within the watchdog window, which
  // reconnects and resyncs the real run state (instead of the button
  // appearing to "not register" until a manual refresh).
  const handleAbortSessionWithProbe = useCallback(() => {
    handleAbortSession();
    probeConnection();
  }, [handleAbortSession, probeConnection]);

  // Stop takes two deliberate inputs — a single stray Escape (e.g. dismissing an
  // unrelated menu) or a mis-tap shouldn't kill an in-flight response. The first
  // input only arms the Stop button, which then shows its label and a live
  // background; the second fires. Escape and tapping the button share the state,
  // so arming with one and confirming with the other works.
  const [isStopArmed, setIsStopArmed] = useState(false);
  const stopArmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarmStop = useCallback(() => {
    if (stopArmTimerRef.current) {
      clearTimeout(stopArmTimerRef.current);
      stopArmTimerRef.current = null;
    }
    setIsStopArmed(false);
  }, []);

  const requestAbortSession = useCallback(() => {
    if (stopArmTimerRef.current) {
      disarmStop();
      handleAbortSessionWithProbe();
      return;
    }
    setIsStopArmed(true);
    stopArmTimerRef.current = setTimeout(() => {
      stopArmTimerRef.current = null;
      setIsStopArmed(false);
    }, STOP_ARM_TIMEOUT_MS);
  }, [disarmStop, handleAbortSessionWithProbe]);

  useEffect(() => () => disarmStop(), [disarmStop]);

  useEffect(() => {
    if (!canAbortSession) {
      disarmStop();
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      requestAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, disarmStop, requestAbortSession]);

  useEffect(() => {
    return () => {
      resetStreamingState();
    };
  }, [resetStreamingState]);

  const permissionContextValue = useMemo(() => ({
    pendingPermissionRequests,
    handlePermissionDecision,
  }), [pendingPermissionRequests, handlePermissionDecision]);

  const getProviderLabel = useCallback(
    (targetProvider: LLMProvider) => t(`messageTypes.${targetProvider}`, { defaultValue: targetProvider }),
    [t],
  );
  const selectedProviderLabel = getProviderLabel(provider);
  const providerOptions = useMemo(
    () => availableProviders.map((value) => ({
      value,
      label: getProviderLabel(value),
      connected: providerAuthStatus[value].authenticated,
      loading: providerAuthStatus[value].loading,
    })),
    [availableProviders, getProviderLabel, providerAuthStatus],
  );
  const isNewSession = !selectedSession && !currentSessionId;
  useEffect(() => {
    if (isNewSession) {
      void refreshProviderAuthStatuses(availableProviders);
    }
  }, [availableProviders, isNewSession, refreshProviderAuthStatuses]);
  // A session belongs to the runtime that started it, so the provider can only
  // be chosen while the chat is still brand new.
  const canSelectProvider = isNewSession;

  const chatFind = useChatFind({
    isVisible,
    sessionId: selectedSession?.id ?? null,
    chatMessages,
    loadAllMessages,
    scrollContainerRef,
    messagesContentRef,
  });
  const chatFindHeader = useMemo(
    () => (chatFind.isOpen ? <ChatFindBar controller={chatFind} /> : null),
    [chatFind],
  );

  const { dialogs: headerMenuDialogs } = useChatHeaderMenu({
    isVisible,
    projects,
    selectedSession,
    sessionActions,
    chatMessages,
    assistantLabel: getProviderLabel(selectedSession?.__provider ?? provider),
    hasMoreMessages,
    isLoadingAllMessages,
    loadAllMessages,
    onOpenFind: chatFind.open,
    findHeaderContent: chatFindHeader,
  });

  const browser = useChatBrowser(selectedSession?.id || currentSessionId || null, isVisible && Boolean(onOpenBrowser));

  return (
    <PermissionContext.Provider value={permissionContextValue}>
      <div className="flex h-full min-h-0 flex-col">
        <ChatMessagesPane
          scrollContainerRef={scrollContainerRef}
          messagesContentRef={messagesContentRef}
          isLoadingSessionMessages={isLoadingSessionMessages}
          isProcessing={isProcessing}
          chatMessages={chatMessages}
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={provider}
          tasksEnabled={tasksEnabled}
          isTaskMasterInstalled={isTaskMasterInstalled}
          onShowAllTasks={onShowAllTasks}
          setInput={setInput}
          isLoadingMoreMessages={isLoadingMoreMessages}
          hasMoreMessages={hasMoreMessages}
          visibleMessageCount={visibleMessageCount}
          visibleMessages={visibleMessages}
          loadAllMessages={loadAllMessages}
          isLoadingAllMessages={isLoadingAllMessages}
          createDiff={createDiff}
          onFileOpen={onFileOpen}
          onShowSettings={onShowSettings}
          onGrantToolPermission={handleGrantToolPermission}
          showRawParameters={showRawParameters}
          showThinking={showThinking}
          selectedProject={selectedProject}
          onEditMessage={beginRewindEdit}
          canEditMessage={getSupportsRewindForProvider(provider) && !isProcessing}
          rewindEditTargetUuid={pendingRewind?.anchorMessageId ?? null}
        />

        <div className="relative flex-shrink-0">
          {showConnectionLostBanner && (
            <div className="pointer-events-none absolute -top-11 left-0 right-0 z-30 flex justify-center">
              <div
                role="status"
                className="pointer-events-auto flex items-center gap-2 rounded-full border border-amber-500/50 bg-card px-3 py-1.5 text-xs font-medium text-amber-600 shadow-sm dark:text-amber-400"
              >
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" aria-hidden />
                {t('connection.reconnecting', { defaultValue: 'Connection lost — reconnecting…' })}
              </div>
            </div>
          )}

          {!showConnectionLostBanner && isUserScrolledUp && chatMessages.length > 0 && (
            <div className="pointer-events-none absolute -top-11 left-0 right-0 z-20 flex justify-center">
              <button
                type="button"
                onClick={scrollToBottomAndReset}
                aria-label={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
                className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-border/50 bg-card text-muted-foreground shadow-sm transition-all duration-200 hover:bg-accent hover:text-foreground"
                title={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
              >
                <ArrowDownIcon className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}

          {settingsChangeNotice && (
            <div className="px-3 pb-1" role="status">
              <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5 text-xs leading-4 text-muted-foreground">
                <span className="min-w-0 flex-1">
                  {t('composer.settingsChangeCacheNotice', {
                    defaultValue: 'Changing model or effort re-sends the conversation on the next turn — one turn at full input price, then caching resumes.',
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => setSettingsChangeNotice(false)}
                  aria-label={t('composer.dismissNotice', { defaultValue: 'Dismiss' })}
                  className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <XIcon className="h-3 w-3" aria-hidden />
                </button>
              </div>
            </div>
          )}

          {isNewSession && (
            <NewSessionLauncher
              projects={projects}
              selectedProject={selectedProject}
              onTargetSelect={onNewSessionTarget}
              onProjectsRefresh={onProjectsRefresh}
              onCreateWorktree={onCreateWorktree}
              onAdoptCheckout={onAdoptCheckout}
              tasksEnabled={tasksEnabled}
              isTaskMasterInstalled={isTaskMasterInstalled}
              onShowAllTasks={onShowAllTasks}
              setInput={setInput}
            />
          )}

          <div
            className="overflow-y-auto overscroll-contain"
            style={{ maxHeight: browser?.session ? 'calc((100dvh - var(--keyboard-height, 0px)) / 2)' : undefined }}
          >
            {browser?.session && onOpenBrowser && (
              <ChatBrowserPreview
                session={browser.session}
                unavailable={browser.unavailable}
                compact={Boolean(queuedDraft || asyncQuestions.pendingQuestion || asyncQuestions.queued.length || pendingPermissionRequests.length || pendingRewind)}
                onOpen={onOpenBrowser}
              />
            )}

            {asyncQuestions.queued.length > 0 && (
              <div className="px-4 md:px-6">
                <QueuedAsyncAnswersCard
                  answers={asyncQuestions.queued}
                  onRemove={asyncQuestions.removeQueued}
                />
              </div>
            )}

            {asyncQuestions.pendingQuestion && (currentSessionId || selectedSession?.id) && (
              <div className="px-4 md:px-6">
                <AsyncQuestionPanel
                  key={`${currentSessionId || selectedSession?.id}:${asyncQuestions.pendingQuestion.id}`}
                  sessionId={(currentSessionId || selectedSession?.id)!}
                  question={asyncQuestions.pendingQuestion}
                  pendingCount={asyncQuestions.pendingCount}
                  isProcessing={isProcessing}
                  isSending={asyncQuestions.sendingQuestionId === asyncQuestions.pendingQuestion.id}
                  error={asyncQuestions.error}
                  onSubmit={(answer, delivery) =>
                    asyncQuestions.submit(asyncQuestions.pendingQuestion!, answer, delivery)}
                />
              </div>
            )}
          </div>

          <ChatComposer
            disabled={!selectedProject}
            pendingPermissionRequests={pendingPermissionRequests}
            handlePermissionDecision={handlePermissionDecision}
            handleGrantToolPermission={handleGrantToolPermission}
            activity={sessionActivity}
            reserveActivitySpace={!isNewSession}
            isLoading={isProcessing}
            onAbortSession={requestAbortSession}
            isStopArmed={isStopArmed}
            permissionMode={permissionMode}
            availablePermissionModes={availablePermissionModes}
            onSelectPermissionMode={(mode) => selectPermissionMode(mode as PermissionMode)}
            collaborationMode={collaborationMode}
            availableCollaborationModes={availableCollaborationModes}
            onSelectCollaborationMode={selectCollaborationMode}
            providerLabel={selectedProviderLabel}
            providerOptions={providerOptions}
            onSelectProvider={canSelectProvider ? selectProvider : null}
            effort={currentProviderEffort}
            availableEffortOptions={currentProviderEffortOptions}
            onSelectEffort={handleSelectComposerEffort}
            model={currentProviderModel}
            availableModelOptions={currentProviderModelOptions}
            onSelectModel={handleSelectComposerModel}
            modelsLoading={providerModelsLoading}
            modelMenuOpenRequest={modelMenuOpenRequest}
            tokenBudget={tokenBudget}
            usagePopoverRequest={usagePopoverRequest}
            onShowContextBreakdown={showContextPopover}
            onRefreshContextBreakdown={refreshContextPopover}
            isRefreshingContextBreakdown={isRefreshingContext}
            sessionKey={currentSessionId || selectedSession?.id || null}
            canStartSession={Boolean(selectedProject)}
            provider={provider}
            onSubmit={handleSubmit}
            isDragActive={isDragActive}
            queuedDraft={queuedDraft}
            onEditQueuedDraft={editQueuedDraft}
            onDeleteQueuedDraft={deleteQueuedDraft}
            scheduledMessages={scheduledEdit
              ? scheduledMessages.filter((message) => message.id !== scheduledEdit.id)
              : scheduledMessages}
            onCancelScheduledMessage={(id) => { void cancelScheduledMessage(id); }}
            onEditScheduledMessage={(message) => { void handleEditScheduledMessage(message); }}
            editingSchedule={scheduledEdit}
            onCancelScheduleEdit={() => {
              // "Send normally" turns the edit into an ordinary draft, so the held original goes.
              if (scheduledEdit) void cancelScheduledMessage(scheduledEdit.id);
            }}
            onScheduleMessage={(trigger, scheduledFor) => {
              void handleScheduleMessage(trigger, scheduledFor);
            }}
            canScheduleOnUsageReset={canScheduleOnUsageReset}
            autoContinueOffer={autoContinueOffer}
            onAcceptAutoContinue={() => {
              void handleScheduleMessage('usage-reset', null, AUTO_CONTINUE_MESSAGE);
            }}
            pendingRewind={pendingRewind}
            onCancelRewindEdit={cancelRewindEdit}
            attachedFiles={attachedFiles}
            onRemoveAttachment={(index) =>
              setAttachedFiles((previous) => previous.filter((_, currentIndex) => currentIndex !== index))
            }
            uploadingFiles={uploadingFiles}
            fileErrors={fileErrors}
            attachmentRejections={attachmentRejections}
            onDismissAttachmentRejections={dismissAttachmentRejections}
            showFileDropdown={showFileDropdown}
            filteredFiles={filteredFiles}
            selectedFileIndex={selectedFileIndex}
            onSelectFile={selectFile}
            filteredCommands={filteredCommands}
            selectedCommandIndex={selectedCommandIndex}
            onCommandSelect={handleCommandSelect}
            onCloseCommandMenu={resetCommandMenuState}
            isCommandMenuOpen={showCommandMenu}
            frequentCommands={commandQuery ? [] : frequentCommands}
            slashCommands={slashCommands}
            getRootProps={getRootProps as (...args: unknown[]) => Record<string, unknown>}
            getInputProps={getInputProps as (...args: unknown[]) => Record<string, unknown>}
            inputHighlightRef={inputHighlightRef}
            renderInputWithMentions={renderInputWithMentions}
            textareaRef={textareaRef}
            input={input}
            onVoiceTranscript={handleVoiceTranscript}
            onInputChange={handleInputChange}
            onTextareaClick={handleTextareaClick}
            onTextareaKeyDown={handleKeyDown}
            onTextareaPaste={handlePaste}
            onTextareaScrollSync={syncInputOverlayScroll}
            onTextareaInput={handleTextareaInput}
            onInputFocusChange={handleInputFocusChange}
            placeholder={
              selectedProject
                ? t('input.placeholder', { provider: selectedProviderLabel })
                : t('launcher.composerPlaceholder', {
                    defaultValue: 'Choose a project to start…',
                  })
            }
            isTextareaExpanded={isTextareaExpanded}
          />
        </div>
      </div>

      <ConversationBranchPickerModal
        open={showRewindPicker}
        onClose={closeRewindPicker}
        chatMessages={chatMessages}
        mode="rewind"
        onPickMessage={beginRewindEdit}
      />

      <ConversationBranchPickerModal
        open={showForkPicker}
        onClose={closeForkPicker}
        chatMessages={chatMessages}
        mode="fork"
        onPickMessage={forkFromMessage}
      />

      <CommandResultModal
        payload={commandModalPayload}
        onClose={closeCommandModal}
      />

      {headerMenuDialogs}
    </PermissionContext.Provider>
  );
}

export default React.memo(ChatInterface);
