import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  TouchEvent,
} from 'react';
import { XIcon, ArrowUpIcon, SquareIcon } from 'lucide-react';

import { useLongPress } from '../../../../hooks/useLongPress';
import { useHeaderAccessorySlot } from '../../../../contexts/HeaderMenuContext';
import { formatClockTimeWithDay, useClockFormat } from '../../../../utils/formatTime';
import type { ScheduledMessageTrigger } from '../../hooks/useScheduledMessages';
import type { QueuedAsyncAnswer } from '../../utils/asyncQuestionState';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useSttAvailable } from '../../hooks/useVoiceAvailable';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';
import type {
  PendingRewind,
  QueuedDraft,
  UsagePopoverRequest,
} from '../../hooks/useChatComposerState';
import type { CollaborationMode, PendingPermissionRequest, PermissionMode } from '../../types/types';
import type { LLMProvider, ProviderModelOption } from '../../../../types/app';
import {
  PROMPT_INPUT_TEXT_LAYOUT,
  PromptInput,
  PromptInputHeader,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSubmit,
} from '../../../../shared/view/ui';

import { splitLeadingCommand } from '../../utils/chatFormatting';

import CommandMenu from './CommandMenu';
import ActivityIndicator from './ActivityIndicator';
import { ComposerAttachmentGallery } from './ComposerAttachment';
import type { AttachmentRejection } from '../../hooks/useChatComposerState';
import VoiceInputButton from './VoiceInputButton';
import PermissionRequestsBanner from './PermissionRequestsBanner';
import TokenUsageSummary from './TokenUsageSummary';
import QueuedMessagesRow from './QueuedMessagesRow';
import ScheduleSendMenu from './ScheduleSendMenu';
import RewindEditCard from './RewindEditCard';
import ComposerAddMenu from './ComposerAddMenu';
import ComposerModelMenu from './ComposerModelMenu';
import ComposerPermissionMenu from './ComposerPermissionMenu';

interface MentionableFile {
  name: string;
  path: string;
}

interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  argumentHint?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ChatComposerProps {
  disabled?: boolean;
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown; toolId?: string },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  activity: SessionActivity | null;
  /**
   * Hold the activity strip's height while it is idle so the composer does not
   * jump when a turn starts. Pointless before a session exists, where it only
   * pushes the launcher away from the composer.
   */
  reserveActivitySpace?: boolean;
  isLoading: boolean;
  onAbortSession: () => void;
  /** Only the visible chat may claim the header slot for its usage ring. */
  isVisible?: boolean;
  /** True once the first Escape/tap has armed Stop; the next one aborts. */
  isStopArmed?: boolean;
  permissionMode: PermissionMode | string;
  availablePermissionModes: (PermissionMode | string)[];
  onSelectPermissionMode: (mode: PermissionMode | string) => void;
  collaborationMode: CollaborationMode | null;
  availableCollaborationModes: CollaborationMode[];
  onSelectCollaborationMode: (mode: CollaborationMode) => void;
  providerLabel: string;
  providerOptions: { value: LLMProvider; label: string; connected: boolean; loading: boolean }[];
  /** False once the session exists — its provider can no longer change. */
  canSwitchProvider: boolean;
  effort: string;
  availableEffortOptions: NonNullable<ProviderModelOption['effort']>['values'];
  onSelectEffort: (effort: string) => void;
  model: string;
  availableModelOptions: ProviderModelOption[];
  /** Every provider's models, for browsing and favourites across providers. */
  modelCatalog: Partial<Record<LLMProvider, ProviderModelOption[]>>;
  onSelectModel: (model: string, provider: LLMProvider) => Promise<void>;
  modelsLoading: boolean;
  onRefreshModels?: () => Promise<void>;
  modelMenuOpenRequest: number;
  tokenBudget: Record<string, unknown> | null;
  usagePopoverRequest: UsagePopoverRequest;
  onShowContextBreakdown: () => void;
  onRefreshContextBreakdown: () => void;
  isRefreshingContextBreakdown: boolean;
  /** Active conversation id, or null on a chat with no session yet. */
  sessionKey: string | null;
  /** True when a chat with no session yet could still start one. */
  canStartSession: boolean;
  provider: LLMProvider;
  onSubmit: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  isDragActive: boolean;
  queuedDraft: QueuedDraft | null;
  onEditQueuedDraft: () => void;
  onDeleteQueuedDraft: () => void;
  /** Codex answers waiting for later turns; they share the queued draft's row. */
  queuedAnswers: QueuedAsyncAnswer[];
  onRemoveQueuedAnswer: (answerId: string) => void;
  /** Set while a scheduled message is being rewritten; sending saves it back. */
  editingSchedule: { trigger: ScheduledMessageTrigger; scheduledFor: string | null } | null;
  onCancelScheduleEdit: () => void;
  /** Stores the composer's current text to send later; clears the box on success. */
  onScheduleMessage: (trigger: ScheduledMessageTrigger, scheduledFor: string | null) => void;
  /** False on providers with no usage reset to wait on, which omits that item. */
  canScheduleOnUsageReset: boolean;
  pendingRewind: PendingRewind | null;
  onCancelRewindEdit: () => void;
  attachedFiles: File[];
  onRemoveAttachment: (index: number) => void;
  uploadingFiles: Map<string, number>;
  fileErrors: Map<string, string>;
  attachmentRejections: AttachmentRejection[];
  onDismissAttachmentRejections: () => void;
  showFileDropdown: boolean;
  filteredFiles: MentionableFile[];
  selectedFileIndex: number;
  onSelectFile: (file: MentionableFile) => void;
  filteredCommands: SlashCommand[];
  selectedCommandIndex: number;
  onCommandSelect: (command: SlashCommand, index: number, isHover: boolean) => void;
  onCloseCommandMenu: () => void;
  isCommandMenuOpen: boolean;
  frequentCommands: SlashCommand[];
  slashCommands: SlashCommand[];
  getRootProps: (...args: unknown[]) => Record<string, unknown>;
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  inputHighlightRef: RefObject<HTMLDivElement>;
  renderInputWithMentions: (text: string) => ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  onVoiceTranscript?: (text: string, send?: boolean) => void;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaClick: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaScrollSync: (target: HTMLTextAreaElement) => void;
  onTextareaInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  onInputFocusChange?: (focused: boolean) => void;
  placeholder: string;
  isTextareaExpanded: boolean;
}

export default function ChatComposer({
  disabled = false,
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
  activity,
  reserveActivitySpace = true,
  isLoading,
  onAbortSession,
  isVisible = true,
  isStopArmed = false,
  permissionMode,
  availablePermissionModes,
  onSelectPermissionMode,
  collaborationMode,
  availableCollaborationModes,
  onSelectCollaborationMode,
  providerLabel,
  providerOptions,
  canSwitchProvider,
  effort,
  availableEffortOptions,
  onSelectEffort,
  model,
  availableModelOptions,
  modelCatalog,
  onSelectModel,
  modelsLoading,
  onRefreshModels,
  modelMenuOpenRequest,
  tokenBudget,
  usagePopoverRequest,
  onShowContextBreakdown,
  onRefreshContextBreakdown,
  isRefreshingContextBreakdown,
  sessionKey,
  canStartSession,
  provider,
  onSubmit,
  isDragActive,
  queuedDraft,
  onEditQueuedDraft,
  onDeleteQueuedDraft,
  queuedAnswers,
  onRemoveQueuedAnswer,
  editingSchedule,
  onCancelScheduleEdit,
  onScheduleMessage,
  canScheduleOnUsageReset,
  pendingRewind,
  onCancelRewindEdit,
  attachedFiles,
  onRemoveAttachment,
  uploadingFiles,
  fileErrors,
  attachmentRejections,
  onDismissAttachmentRejections,
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  onSelectFile,
  filteredCommands,
  selectedCommandIndex,
  onCommandSelect,
  onCloseCommandMenu,
  isCommandMenuOpen,
  frequentCommands,
  slashCommands,
  getRootProps,
  getInputProps,
  inputHighlightRef,
  renderInputWithMentions,
  textareaRef,
  input,
  onVoiceTranscript,
  onInputChange,
  onTextareaClick,
  onTextareaKeyDown,
  onTextareaPaste,
  onTextareaScrollSync,
  onTextareaInput,
  onInputFocusChange,
  placeholder,
  isTextareaExpanded,
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  useClockFormat();

  const leadingCommand = useMemo(
    () => splitLeadingCommand(input, new Set(slashCommands.map((command) => command.name))),
    [input, slashCommands],
  );
  // Only while the argument slot is still empty, as in the CLI.
  const argumentHint = leadingCommand && !leadingCommand.rest
    ? slashCommands.find((command) => command.name === leadingCommand.command)?.argumentHint
    : undefined;

  const commandMenuPosition = useMemo(() => {
    if (!isCommandMenuOpen) {
      return { top: 0, left: 16, bottom: 90 };
    }
    const textareaRect = textareaRef.current?.getBoundingClientRect();
    return {
      top: textareaRect ? Math.max(16, textareaRect.top - 316) : 0,
      left: textareaRect ? textareaRect.left : 16,
      bottom: textareaRect ? window.innerHeight - textareaRect.top + 8 : 90,
    };
  }, [isCommandMenuOpen, textareaRef]);

  // Voice state is hosted here (not in the mic button) so the main Send button can stop
  // recording and send the transcript in one tap, the way the mic button drops it in the box.
  const voiceAvailable = useSttAvailable();
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const rejectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleVoiceError = useCallback((msg: string) => {
    setVoiceError(msg);
    if (voiceErrorTimer.current) clearTimeout(voiceErrorTimer.current);
    voiceErrorTimer.current = setTimeout(() => setVoiceError(null), 4000);
  }, []);
  useEffect(() => {
    if (attachmentRejections.length === 0) {
      return;
    }
    rejectionTimer.current = setTimeout(onDismissAttachmentRejections, 6000);
    return () => {
      if (rejectionTimer.current) clearTimeout(rejectionTimer.current);
    };
  }, [attachmentRejections, onDismissAttachmentRejections]);

  useEffect(() => () => {
    if (voiceErrorTimer.current) clearTimeout(voiceErrorTimer.current);
  }, []);
  const noopTranscript = useCallback(() => {}, []);
  const { state: voiceState, toggle: voiceToggle, stop: voiceStop } = useVoiceInput(
    onVoiceTranscript ?? noopTranscript,
    handleVoiceError,
  );
  const isStartingRecording = voiceState === 'starting';
  const isRecording = voiceState === 'recording';
  const isTranscribing = voiceState === 'transcribing';

  // Detect if a provider-neutral structured-question panel is active.
  const hasQuestionPanel = pendingPermissionRequests.some(
    (r) => r.requestType === 'user_input'
      || r.toolName === 'AskUserQuestion'
      || r.toolName === 'request_user_input'
  );

  const headerSlot = useHeaderAccessorySlot();

  // Long-press (touch) and right-click (pointer) open the same "send later" sheet.
  const [isScheduleMenuOpen, setIsScheduleMenuOpen] = useState(false);
  const canScheduleCurrentInput = Boolean(sessionKey || canStartSession) && Boolean(input.trim());
  const { handlers: scheduleLongPress } = useLongPress(
    () => setIsScheduleMenuOpen(true),
    { disabled: !canScheduleCurrentInput },
  );

  // The sheet belongs to one conversation; switching away must not leave it
  // covering the next one's composer.
  useEffect(() => { setIsScheduleMenuOpen(false); }, [sessionKey]);

  const hasQueuedDraft = Boolean(queuedDraft);
  const canQueueDraft = isLoading && Boolean(input.trim() || attachedFiles.length > 0);
  // Mid-turn the send button is Stop while the input is empty and Queue once it isn't.
  const showStop = isLoading && !canQueueDraft && !editingSchedule && !isRecording
    && Boolean(activity?.canInterrupt);
  const submitAriaLabel = disabled
    ? t('input.selectProjectToSend', { defaultValue: 'Select a project to send' })
    : editingSchedule
      ? t('input.schedule.reschedule', { defaultValue: 'Save and keep it scheduled' })
      : showStop
      ? isStopArmed
        ? t('claudeStatus.stopConfirm', { defaultValue: 'Press again to stop' })
        : t('claudeStatus.stop', { defaultValue: 'Stop' })
      : canQueueDraft
      ? hasQueuedDraft
        ? t('input.queue.update', { defaultValue: 'Update queued message' })
        : t('input.queue.sendNext', { defaultValue: 'Queue next message' })
      : isLoading
        ? t('claudeStatus.actions.working', { defaultValue: 'Working' })
        : t('input.send');

  const usageRing = (
    <TokenUsageSummary
      inHeader={Boolean(headerSlot)}
      usage={tokenBudget}
      request={usagePopoverRequest}
      onRequestBreakdown={onShowContextBreakdown}
      onRefreshBreakdown={onRefreshContextBreakdown}
      isRefreshingBreakdown={isRefreshingContextBreakdown}
      canRefreshBreakdown={isLoading}
      sessionKey={sessionKey}
      provider={provider}
      model={model}
    />
  );

  return (
    <div className="chat-composer-shell relative flex-shrink-0 select-none px-4 pb-4 pt-0 md:px-6 md:pb-6">
      {/* The ring describes the whole session, so it lives in the header when there is one. */}
      {headerSlot && isVisible && createPortal(usageRing, headerSlot)}
      {(activity || reserveActivitySpace) && (
        // Hidden, never unmounted, while the permission banner holds the slot: the
        // message cycle and its no-repeat bag are per-turn state a remount restarts.
        <div
          className="mx-auto mb-2 max-w-[54.25rem]"
          style={{
            display: pendingPermissionRequests.length > 0 ? 'none' : undefined,
            visibility: activity ? 'visible' : 'hidden',
          }}
        >
          <ActivityIndicator activity={activity} />
        </div>
      )}

      {pendingPermissionRequests.length > 0 && (
        <div className="mx-auto mb-3 max-w-[54.25rem]">
          <PermissionRequestsBanner
            pendingPermissionRequests={pendingPermissionRequests}
            handlePermissionDecision={handlePermissionDecision}
            handleGrantToolPermission={handleGrantToolPermission}
          />
        </div>
      )}

      <QueuedMessagesRow
        draft={queuedDraft && {
          content: queuedDraft.content,
          attachmentCount: queuedDraft.attachments.length,
        }}
        answers={queuedAnswers}
        onEditDraft={onEditQueuedDraft}
        onDeleteDraft={onDeleteQueuedDraft}
        onRemoveAnswer={onRemoveQueuedAnswer}
      />

      {isScheduleMenuOpen && (
        <ScheduleSendMenu
          canWaitForUsageReset={canScheduleOnUsageReset}
          onDismiss={() => setIsScheduleMenuOpen(false)}
          onSchedule={(trigger, scheduledFor) => {
            setIsScheduleMenuOpen(false);
            onScheduleMessage(trigger, scheduledFor);
          }}
        />
      )}

      {editingSchedule && (
        <div className="settings-content-enter mx-auto mb-2 flex max-w-[54.25rem] items-center gap-2 rounded-xl border border-dashed border-primary/25 bg-primary/[0.04] px-3 py-2 text-xs">
          <span className="flex-1 text-muted-foreground">
            {editingSchedule.trigger === 'usage-reset'
              ? t('input.schedule.editingUsageReset', {
                defaultValue: 'Paused while you edit — saving sends it when usage resets',
              })
              : t('input.schedule.editingAt', {
                defaultValue: 'Paused while you edit — saving sends it at {{time}}',
                time: editingSchedule.scheduledFor
                  ? formatClockTimeWithDay(editingSchedule.scheduledFor)
                  : '',
              })}
          </span>
          <button
            type="button"
            onClick={onCancelScheduleEdit}
            className="shrink-0 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {t('input.schedule.discardEdit', { defaultValue: 'Discard edit' })}
          </button>
        </div>
      )}

      {pendingRewind && (
        <RewindEditCard snippet={pendingRewind.snippet} onCancel={onCancelRewindEdit} />
      )}

      {!hasQuestionPanel && <div className="relative mx-auto max-w-[54.25rem]">
        {showFileDropdown && filteredFiles.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-48 overflow-y-auto rounded-xl border border-border/50 bg-card/95 shadow-lg">
            {filteredFiles.map((file, index) => (
              <div
                key={file.path}
                className={`cursor-pointer touch-manipulation border-b border-border/30 px-4 py-3 last:border-b-0 ${
                  index === selectedFileIndex
                    ? 'bg-primary/8 text-primary'
                    : 'text-foreground hover:bg-accent/50'
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectFile(file);
                }}
              >
                <div className="text-sm font-medium">{file.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{file.path}</div>
              </div>
            ))}
          </div>
        )}

        <CommandMenu
          commands={filteredCommands}
          selectedIndex={selectedCommandIndex}
          onSelect={onCommandSelect}
          onClose={onCloseCommandMenu}
          position={commandMenuPosition}
          isOpen={isCommandMenuOpen}
          frequentCommands={frequentCommands}
        />

        <PromptInput
          onSubmit={disabled
            ? (event) => event.preventDefault()
            : onSubmit as (event: FormEvent<HTMLFormElement>) => void}
          status={isLoading ? 'streaming' : 'ready'}
          className={isTextareaExpanded ? 'chat-input-expanded' : ''}
          {...getRootProps()}
        >
          {isDragActive && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/15">
              <div className="rounded-xl border border-border/30 bg-card p-4 shadow-lg">
                <svg className="mx-auto mb-2 h-8 w-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p className="text-sm font-medium">Drop images here</p>
              </div>
            </div>
          )}

          {attachmentRejections.length > 0 && (
            <PromptInputHeader>
              <div
                role="status"
                className="flex items-start justify-between gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                <ul className="min-w-0 space-y-0.5">
                  {attachmentRejections.map((rejection, index) => (
                    <li key={`${rejection.reason}:${rejection.fileName ?? index}`} className="truncate">
                      {rejection.reason === 'too-many'
                        ? t('input.attachmentRejected.tooMany', { count: rejection.count })
                        : t(`input.attachmentRejected.${rejection.reason === 'too-large' ? 'tooLarge' : 'unreadable'}`, { fileName: rejection.fileName })}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={onDismissAttachmentRejections}
                  aria-label={t('input.attachmentRejected.dismiss')}
                  className="shrink-0 rounded p-0.5 hover:bg-destructive/20"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </PromptInputHeader>
          )}

          {voiceError && (
            <PromptInputHeader>
              <div
                role="alert"
                className="max-w-full whitespace-normal rounded-xl bg-destructive/10 px-3 py-2 text-xs leading-4 text-destructive [overflow-wrap:anywhere]"
              >
                {voiceError}
              </div>
            </PromptInputHeader>
          )}

          {attachedFiles.length > 0 && (
            <PromptInputHeader>
              <div className="rounded-xl bg-muted/40 p-2">
                <ComposerAttachmentGallery
                  files={attachedFiles}
                  onRemove={onRemoveAttachment}
                  uploadingFiles={uploadingFiles}
                  fileErrors={fileErrors}
                />
              </div>
            </PromptInputHeader>
          )}

          <PromptInputBody>
            <div ref={inputHighlightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
              <div className={`chat-input-placeholder block w-full whitespace-pre-wrap break-words text-transparent ${PROMPT_INPUT_TEXT_LAYOUT}`}>
                {leadingCommand ? (
                  <>
                    <span className="-ml-0.5 box-decoration-clone rounded-md bg-violet-200/70 px-0.5 text-transparent dark:bg-violet-400/30">
                      {leadingCommand.command}
                    </span>
                    {leadingCommand.separator}
                    {renderInputWithMentions(leadingCommand.rest)}
                    {argumentHint && (
                      <span className="text-muted-foreground/70">
                        {leadingCommand.separator ? argumentHint : ` ${argumentHint}`}
                      </span>
                    )}
                  </>
                ) : (
                  renderInputWithMentions(input)
                )}
              </div>
            </div>

            <PromptInputTextarea
              ref={textareaRef}
              dir="auto"
              value={input}
              onChange={onInputChange}
              onClick={onTextareaClick}
              onKeyDown={onTextareaKeyDown}
              onPaste={onTextareaPaste}
              onScroll={(event) => onTextareaScrollSync(event.target as HTMLTextAreaElement)}
              onFocus={() => onInputFocusChange?.(true)}
              onBlur={() => onInputFocusChange?.(false)}
              onInput={onTextareaInput}
              placeholder={placeholder}
            />
        </PromptInputBody>

        <PromptInputFooter>
          <PromptInputTools className="min-w-0 flex-1 overflow-hidden">
            <ComposerAddMenu
              getInputProps={getInputProps}
              attachLabel={t('input.attachFiles')}
              canSchedule={canScheduleCurrentInput}
              onSchedule={() => setIsScheduleMenuOpen(true)}
            />

            <ComposerModelMenu
              effort={effort}
              effortOptions={availableEffortOptions}
              onSelectEffort={onSelectEffort}
              model={model}
              modelOptions={availableModelOptions}
              modelCatalog={modelCatalog}
              onSelectModel={onSelectModel}
              modelsLoading={modelsLoading}
              onRefreshModels={onRefreshModels}
              openRequest={modelMenuOpenRequest}
              provider={provider}
              providerLabel={providerLabel}
              providerOptions={providerOptions}
              canSwitchProvider={canSwitchProvider}
            />

            <ComposerPermissionMenu
              permissionMode={permissionMode}
              permissionModes={availablePermissionModes}
              onSelectPermissionMode={onSelectPermissionMode}
              collaborationMode={collaborationMode}
              collaborationModes={availableCollaborationModes}
              onSelectCollaborationMode={onSelectCollaborationMode}
              provider={provider}
              providerLabel={providerLabel}
            />

          </PromptInputTools>

          <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
            {!headerSlot && usageRing}

            {onVoiceTranscript && voiceAvailable && (
              <VoiceInputButton state={voiceState} onToggle={voiceToggle} />
            )}

            <PromptInputSubmit
              onClick={
                editingSchedule
                  ? (e: MouseEvent<HTMLButtonElement>) => {
                      e.preventDefault();
                      onScheduleMessage(editingSchedule.trigger, editingSchedule.scheduledFor);
                    }
                  : canQueueDraft
                  ? (e: MouseEvent<HTMLButtonElement>) => {
                      e.preventDefault();
                      onSubmit(e);
                    }
                  : showStop
                  ? (e: MouseEvent<HTMLButtonElement>) => {
                      e.preventDefault();
                      onAbortSession();
                    }
                  : isRecording
                    ? (e: MouseEvent<HTMLButtonElement>) => {
                        e.preventDefault();
                        voiceStop({ send: true });
                      }
                    : undefined
              }
              disabled={
                disabled
                  ? true
                  : isLoading
                    ? !canQueueDraft && !showStop
                    : isStartingRecording
                      ? true
                      : isRecording
                        ? false
                        : isTranscribing
                          ? true
                          : !input.trim() && attachedFiles.length === 0
              }
              aria-label={submitAriaLabel}
              title={submitAriaLabel}
              className={`composer-send-hit-target ml-4 [&_svg]:size-5 ${
                showStop ? 'border border-border bg-background text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground active:bg-accent' : ''
              }`}
              {...scheduleLongPress}
              // After the spread: useLongPress only suppresses the native menu,
              // so right-click has to open ours here or desktop gets nothing.
              onContextMenu={(event: MouseEvent<HTMLButtonElement>) => {
                event.preventDefault();
                if (canScheduleCurrentInput) setIsScheduleMenuOpen(true);
              }}
            >
              {showStop ? (
                // Armed, the pill grows left over its neighbours instead of reflowing the row.
                <span
                  className={`absolute -inset-y-px -right-px z-10 flex items-center rounded-lg border pr-2 text-sm font-medium transition-colors ${
                    isStopArmed ? 'border-foreground bg-foreground pl-3 text-background' : 'border-transparent pl-2'
                  }`}
                >
                  <span
                    className={`overflow-hidden whitespace-nowrap transition-[max-width,margin] duration-150 ${
                      isStopArmed ? 'mr-1.5 max-w-12' : 'max-w-0'
                    }`}
                  >
                    {t('claudeStatus.stop', { defaultValue: 'Stop' })}
                  </span>
                  <SquareIcon className="!h-3.5 !w-3.5 fill-current" />
                </span>
              ) : <ArrowUpIcon className="h-5 w-5" />}
            </PromptInputSubmit>
          </div>
        </PromptInputFooter>
        </PromptInput>
      </div>}
    </div>
  );
}
