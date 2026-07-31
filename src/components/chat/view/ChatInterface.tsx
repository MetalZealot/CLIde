import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownIcon } from 'lucide-react';

import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import PermissionContext from '../../../contexts/PermissionContext';
import type { ChatInterfaceProps, Provider  } from '../types/types';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '../hooks/useChatComposerState';
import { useSessionStore } from '../../../stores/useSessionStore';

import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import ChatComposer from './subcomponents/ChatComposer';
import CompactionWarningBanner from './subcomponents/CompactionWarningBanner';
import CommandResultModal from './subcomponents/CommandResultModal';
import ConversationBranchPickerModal from './subcomponents/ConversationBranchPickerModal';

function ChatInterface({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  onFileOpen,
  onInputFocusChange,
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
}: ChatInterfaceProps) {
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const { subscribe, isConnected, probeConnection, getReplayProgress } = useWebSocket();
  const { t } = useTranslation('chat');

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
  const streamTimerRef = useRef<number | null>(null);
  const accumulatedStreamRef = useRef('');
  // When each session's `chat.subscribe` was last sent; idle acks older than
  // a later local request are discarded as stale.
  const statusCheckSentAtRef = useRef(new Map<string, number>());
  // Replay progress (`lastSeq` + `runId`) is tracked at the transport level —
  // see WebSocketContext's `getReplayProgress` — so it survives this
  // component unmounting and stays exact under the dedup guard.

  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    accumulatedStreamRef.current = '';
  }, []);

  const {
    provider,
    setProvider,
    cursorModel,
    setCursorModel,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    currentProviderEffort,
    currentProviderEffortOptions,
    opencodeModel,
    setOpenCodeModel,
    permissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
    providerModelCatalog,
    providerModelCacheCatalog,
    providerModelsLoading,
    providerModelsRefreshing,
    hardRefreshProviderModels,
    selectProviderModel,
    setStoredProviderEffort,
    resolvePermissionModeForProvider,
    getSupportsRewindForProvider,
    getSupportsForkForProvider,
  } = useChatProviderState({
    selectedSession,
    selectedProject,
  });

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
    allMessagesLoaded,
    isLoadingAllMessages,
    createDiff,
    scrollContainerRef,
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
    onSessionEstablished?.(sessionId, context);
    onNavigateToSession?.(sessionId);
  }, [setCurrentSessionId, onSessionEstablished, onNavigateToSession]);

  const {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedImages,
    setAttachedImages,
    uploadingImages,
    imageErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openImagePicker,
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
    handleClearInput,
    handleAbortSession,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    commandModalPayload,
    closeCommandModal,
    showUsageModal,
    showContextModal,
    refreshContextModal,
    isRefreshingContext,
  } = useChatComposerState({
    selectedProject,
    selectedSession,
    currentSessionId,
    provider,
    permissionMode,
    cyclePermissionMode,
    cursorModel,
    claudeModel,
    codexModel,
    currentProviderEffort,
    opencodeModel,
    isLoading: isProcessing,
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

  const handleSelectProviderModel = useCallback(async (targetProvider: typeof provider, model: string, sessionId?: string | null) => {
    const result = await selectProviderModel(targetProvider, model, sessionId);
    if (result.scope === 'session' && sessionId) {
      sessionStore.setModel(sessionId, result.model);
    }
    return result;
  }, [selectProviderModel, sessionStore]);

  // Latest composer text, read from a ref so the realtime listener does not
  // rebind on every keystroke.
  const inputSnapshotRef = useRef(input);
  inputSnapshotRef.current = input;

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

  useChatRealtimeHandlers({
    subscribe,
    provider,
    selectedSession,
    currentSessionId,
    setTokenBudget,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    streamTimerRef,
    accumulatedStreamRef,
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

  // Require two Escape presses in quick succession before aborting — a single stray
  // Escape (e.g. dismissing an unrelated menu) shouldn't kill an in-flight response.
  const lastEscapeAtRef = useRef(0);
  const DOUBLE_ESCAPE_WINDOW_MS = 500;

  useEffect(() => {
    if (!canAbortSession) {
      lastEscapeAtRef.current = 0;
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      event.preventDefault();

      const now = Date.now();
      if (now - lastEscapeAtRef.current <= DOUBLE_ESCAPE_WINDOW_MS) {
        lastEscapeAtRef.current = 0;
        handleAbortSessionWithProbe();
      } else {
        lastEscapeAtRef.current = now;
      }
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSessionWithProbe]);

  useEffect(() => {
    return () => {
      resetStreamingState();
    };
  }, [resetStreamingState]);

  const permissionContextValue = useMemo(() => ({
    pendingPermissionRequests,
    handlePermissionDecision,
  }), [pendingPermissionRequests, handlePermissionDecision]);

  if (!selectedProject) {
    const selectedProviderLabel =
      provider === 'cursor'
        ? t('messageTypes.cursor')
        : provider === 'codex'
          ? t('messageTypes.codex')
          : provider === 'opencode'
              ? t('messageTypes.opencode', { defaultValue: 'OpenCode' })
            : t('messageTypes.claude');

    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">
            {t('projectSelection.startChatWithProvider', {
              provider: selectedProviderLabel,
              defaultValue: 'Select a project to start chatting with {{provider}}',
            })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <PermissionContext.Provider value={permissionContextValue}>
      <div className="flex h-full min-h-0 flex-col">
        <ChatMessagesPane
          scrollContainerRef={scrollContainerRef}
          isLoadingSessionMessages={isLoadingSessionMessages}
          isProcessing={isProcessing}
          chatMessages={chatMessages}
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={provider}
          setProvider={(nextProvider) => setProvider(nextProvider as Provider)}
          textareaRef={textareaRef}
          claudeModel={claudeModel}
          setClaudeModel={setClaudeModel}
          cursorModel={cursorModel}
          setCursorModel={setCursorModel}
          codexModel={codexModel}
          setCodexModel={setCodexModel}
          opencodeModel={opencodeModel}
          setOpenCodeModel={setOpenCodeModel}
          providerModelCatalog={providerModelCatalog}
          providerModelsLoading={providerModelsLoading}
          tasksEnabled={tasksEnabled}
          isTaskMasterInstalled={isTaskMasterInstalled}
          onShowAllTasks={onShowAllTasks}
          setInput={setInput}
          isLoadingMoreMessages={isLoadingMoreMessages}
          hasMoreMessages={hasMoreMessages}
          visibleMessageCount={visibleMessageCount}
          visibleMessages={visibleMessages}
          loadAllMessages={loadAllMessages}
          allMessagesLoaded={allMessagesLoaded}
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

          <CompactionWarningBanner
            tokenBudget={tokenBudget}
            sessionId={currentSessionId || selectedSession?.id || null}
            onShowContext={showContextModal}
          />

          <ChatComposer
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
          activity={sessionActivity}
          isLoading={isProcessing}
          onAbortSession={handleAbortSessionWithProbe}
          permissionMode={permissionMode}
          onModeSwitch={cyclePermissionMode}
          effort={currentProviderEffort}
          availableEffortOptions={currentProviderEffortOptions}
          onSelectEffort={(nextEffort) => setStoredProviderEffort(provider, nextEffort)}
          tokenBudget={tokenBudget}
          onShowContext={showContextModal}
          provider={provider}
          onToggleCommandMenu={handleToggleCommandMenu}
          hasInput={Boolean(input.trim())}
          onClearInput={handleClearInput}
          onSubmit={handleSubmit}
          isDragActive={isDragActive}
          queuedDraft={queuedDraft}
          onEditQueuedDraft={editQueuedDraft}
          onDeleteQueuedDraft={deleteQueuedDraft}
          pendingRewind={pendingRewind}
          onCancelRewindEdit={cancelRewindEdit}
          attachedImages={attachedImages}
          onRemoveImage={(index) =>
            setAttachedImages((previous) =>
              previous.filter((_, currentIndex) => currentIndex !== index),
            )
          }
          uploadingImages={uploadingImages}
          imageErrors={imageErrors}
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
          getRootProps={getRootProps as (...args: unknown[]) => Record<string, unknown>}
          getInputProps={getInputProps as (...args: unknown[]) => Record<string, unknown>}
          openImagePicker={openImagePicker}
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
          placeholder={t('input.placeholder', {
            provider:
              provider === 'cursor'
                ? t('messageTypes.cursor')
                : provider === 'codex'
                  ? t('messageTypes.codex')
                  : provider === 'opencode'
                      ? t('messageTypes.opencode', { defaultValue: 'OpenCode' })
                    : t('messageTypes.claude'),
          })}
          isTextareaExpanded={isTextareaExpanded}
          sendByCtrlEnter={sendByCtrlEnter}
          enterToSend={enterToSend}
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
        providerModelCatalog={providerModelCatalog}
        providerModelCacheCatalog={providerModelCacheCatalog}
        providerModelsRefreshing={providerModelsRefreshing}
        onHardRefreshProviderModels={hardRefreshProviderModels}
        currentSessionId={currentSessionId || selectedSession?.id || null}
        onShowUsage={showUsageModal}
        onRefreshContext={refreshContextModal}
        isRefreshingContext={isRefreshingContext}
        isSessionProcessing={isProcessing}
        onSelectProviderModel={handleSelectProviderModel}
      />
    </PermissionContext.Provider>
  );
}

export default React.memo(ChatInterface);
