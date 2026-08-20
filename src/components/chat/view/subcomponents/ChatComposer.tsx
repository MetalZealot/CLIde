import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { XIcon, Loader2, ArrowUpIcon } from 'lucide-react';

import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useVoiceAvailable } from '../../hooks/useVoiceAvailable';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';
import { isTouchPrimaryDevice } from '../../../../utils/pointer';
import type {
  PendingRewind,
  QueuedDraft,
  UsagePopoverRequest,
} from '../../hooks/useChatComposerState';
import type { CollaborationMode, PendingPermissionRequest, PermissionMode } from '../../types/types';
import type { LLMProvider, ProviderModelOption } from '../../../../types/app';
import {
  PromptInput,
  PromptInputHeader,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
} from '../../../../shared/view/ui';

import { splitLeadingCommand } from '../../utils/chatFormatting';

import CommandMenu from './CommandMenu';
import ActivityIndicator from './ActivityIndicator';
import ComposerAttachment from './ComposerAttachment';
import VoiceInputButton from './VoiceInputButton';
import PermissionRequestsBanner from './PermissionRequestsBanner';
import TokenUsageSummary from './TokenUsageSummary';
import QueuedMessageCard from './QueuedMessageCard';
import RewindEditCard from './RewindEditCard';
import NativeImageAttachmentPicker from './NativeImageAttachmentPicker';
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
  /** True once the first Escape/tap has armed Stop; the next one aborts. */
  isStopArmed?: boolean;
  permissionMode: PermissionMode | string;
  availablePermissionModes: (PermissionMode | string)[];
  onSelectPermissionMode: (mode: PermissionMode | string) => void;
  collaborationMode: CollaborationMode | null;
  availableCollaborationModes: CollaborationMode[];
  onSelectCollaborationMode: (mode: CollaborationMode) => void;
  providerLabel: string;
  providerOptions: { value: LLMProvider; label: string }[];
  /** Null once the session exists — its provider can no longer change. */
  onSelectProvider: ((provider: LLMProvider) => void) | null;
  effort: string;
  availableEffortOptions: NonNullable<ProviderModelOption['effort']>['values'];
  onSelectEffort: (effort: string) => void;
  model: string;
  availableModelOptions: ProviderModelOption[];
  onSelectModel: (model: string) => Promise<void>;
  modelsLoading: boolean;
  modelMenuOpenRequest: number;
  tokenBudget: Record<string, unknown> | null;
  usagePopoverRequest: UsagePopoverRequest;
  onShowContextBreakdown: () => void;
  onRefreshContextBreakdown: () => void;
  isRefreshingContextBreakdown: boolean;
  /** Active conversation id, or null on a chat with no session yet. */
  sessionKey: string | null;
  provider: LLMProvider;
  hasInput: boolean;
  onClearInput: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  isDragActive: boolean;
  queuedDraft: QueuedDraft | null;
  onEditQueuedDraft: () => void;
  onDeleteQueuedDraft: () => void;
  pendingRewind: PendingRewind | null;
  onCancelRewindEdit: () => void;
  attachedFiles: File[];
  onRemoveAttachment: (index: number) => void;
  uploadingFiles: Map<string, number>;
  fileErrors: Map<string, string>;
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
  sendByCtrlEnter?: boolean;
  enterToSend?: boolean;
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
  isStopArmed = false,
  permissionMode,
  availablePermissionModes,
  onSelectPermissionMode,
  collaborationMode,
  availableCollaborationModes,
  onSelectCollaborationMode,
  providerLabel,
  providerOptions,
  onSelectProvider,
  effort,
  availableEffortOptions,
  onSelectEffort,
  model,
  availableModelOptions,
  onSelectModel,
  modelsLoading,
  modelMenuOpenRequest,
  tokenBudget,
  usagePopoverRequest,
  onShowContextBreakdown,
  onRefreshContextBreakdown,
  isRefreshingContextBreakdown,
  sessionKey,
  provider,
  hasInput,
  onClearInput,
  onSubmit,
  isDragActive,
  queuedDraft,
  onEditQueuedDraft,
  onDeleteQueuedDraft,
  pendingRewind,
  onCancelRewindEdit,
  attachedFiles,
  onRemoveAttachment,
  uploadingFiles,
  fileErrors,
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
  sendByCtrlEnter,
  enterToSend,
}: ChatComposerProps) {
  const { t } = useTranslation('chat');

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
  const voiceAvailable = useVoiceAvailable();
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleVoiceError = useCallback((msg: string) => {
    setVoiceError(msg);
    if (voiceErrorTimer.current) clearTimeout(voiceErrorTimer.current);
    voiceErrorTimer.current = setTimeout(() => setVoiceError(null), 4000);
  }, []);
  useEffect(() => () => {
    if (voiceErrorTimer.current) clearTimeout(voiceErrorTimer.current);
  }, []);
  const noopTranscript = useCallback(() => {}, []);
  const { state: voiceState, toggle: voiceToggle, stop: voiceStop } = useVoiceInput(
    onVoiceTranscript ?? noopTranscript,
    handleVoiceError,
  );
  const isRecording = voiceState === 'recording';
  const isTranscribing = voiceState === 'transcribing';

  // Detect if a provider-neutral structured-question panel is active.
  const hasQuestionPanel = pendingPermissionRequests.some(
    (r) => r.requestType === 'user_input'
      || r.toolName === 'AskUserQuestion'
      || r.toolName === 'request_user_input'
  );

  const hasQueuedDraft = Boolean(queuedDraft);
  const canQueueDraft = isLoading && Boolean(input.trim() || attachedFiles.length > 0);
  // Mirrors handleKeyDown in useChatComposerState: plain Enter sends on desktop
  // unless sendByCtrlEnter, and on touch only when enterToSend is opted in.
  const isTouchPrimary = useMemo(() => isTouchPrimaryDevice(), []);
  const plainEnterSends = isTouchPrimary ? Boolean(enterToSend) : !sendByCtrlEnter;
  const submitHint = canQueueDraft
    ? plainEnterSends
      ? hasQueuedDraft
        ? t('input.hintText.updateQueued', { defaultValue: 'Enter to update queued message' })
        : t('input.hintText.queue', { defaultValue: 'Enter to queue your next message' })
      : hasQueuedDraft
        ? t('input.hintText.updateQueuedButton', { defaultValue: 'Send to update queued message' })
        : t('input.hintText.queueButton', { defaultValue: 'Send to queue your next message' })
    : plainEnterSends
      ? t('input.hintText.enter')
      : isTouchPrimary
        ? t('input.hintText.enterNewline', {
            defaultValue:
              'Enter for new line • Tab to change modes • / for slash commands',
          })
        : t('input.hintText.ctrlEnter');
  const submitAriaLabel = disabled
    ? t('input.selectProjectToSend', { defaultValue: 'Select a project to send' })
    : canQueueDraft
      ? hasQueuedDraft
        ? t('input.queue.update', { defaultValue: 'Update queued message' })
        : t('input.queue.sendNext', { defaultValue: 'Queue next message' })
      : isLoading
        ? t('claudeStatus.actions.working', { defaultValue: 'Working' })
        : t('input.send');

  return (
    <div className="chat-composer-shell relative flex-shrink-0 px-4 pb-4 pt-0 md:px-6 md:pb-6">
      {pendingPermissionRequests.length === 0 && (activity || reserveActivitySpace) && (
        <div className="mx-auto mb-2 max-w-[54.25rem]" style={{ visibility: activity ? 'visible' : 'hidden' }}>
          <ActivityIndicator activity={activity} onAbort={onAbortSession} isStopArmed={isStopArmed} />
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

      {queuedDraft && (
        <QueuedMessageCard
          content={queuedDraft.content}
          attachmentCount={queuedDraft.attachments.length}
          onEdit={onEditQueuedDraft}
          onDelete={onDeleteQueuedDraft}
        />
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

          {attachedFiles.length > 0 && (
            <PromptInputHeader>
              <div className="rounded-xl bg-muted/40 p-2">
                <div className="flex flex-wrap gap-2">
                  {attachedFiles.map((file, index) => (
                    <ComposerAttachment
                      key={index}
                      file={file}
                      onRemove={() => onRemoveAttachment(index)}
                      uploadProgress={uploadingFiles.get(file.name)}
                      error={fileErrors.get(file.name)}
                    />
                  ))}
                </div>
              </div>
            </PromptInputHeader>
          )}

          <PromptInputBody>
            <div ref={inputHighlightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
              <div className="chat-input-placeholder block w-full whitespace-pre-wrap break-words px-4 pb-1 pt-2 text-sm leading-6 text-transparent">
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
          <PromptInputTools>
            <NativeImageAttachmentPicker
              getInputProps={getInputProps}
              label={t('input.attachFiles')}
            />

            <ComposerModelMenu
              effort={effort}
              effortOptions={availableEffortOptions}
              onSelectEffort={onSelectEffort}
              model={model}
              modelOptions={availableModelOptions}
              onSelectModel={onSelectModel}
              modelsLoading={modelsLoading}
              openRequest={modelMenuOpenRequest}
              provider={provider}
              providerLabel={providerLabel}
              providerOptions={providerOptions}
              onSelectProvider={onSelectProvider}
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

            {onVoiceTranscript && voiceAvailable && (
              <VoiceInputButton state={voiceState} onToggle={voiceToggle} errorMsg={voiceError} />
            )}

            {hasInput && (
              <PromptInputButton
                tooltip={{ content: t('input.clearInput', { defaultValue: 'Clear input' }) }}
                onClick={onClearInput}
                className="hidden sm:flex"
              >
                <XIcon />
              </PromptInputButton>
            )}

          </PromptInputTools>

          <div className="flex min-w-0 items-center gap-0.5 sm:gap-1">
            {/* The hint is the only part of this row allowed to shrink: the tools,
                ring, and Send are all shrink-0, so without this the row overflows
                and pushes Send past the composer edge once the clear button
                mounts. */}
            <div
              className={`hidden min-w-0 truncate text-xs text-muted-foreground/50 transition-opacity duration-200 lg:block ${
                input.trim() && !canQueueDraft ? 'opacity-0' : 'opacity-100'
              }`}
            >
              {submitHint}
            </div>

            <TokenUsageSummary
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

            <PromptInputSubmit
              onClick={
                canQueueDraft
                  ? (e: MouseEvent<HTMLButtonElement>) => {
                      e.preventDefault();
                      onSubmit(e);
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
                    ? !canQueueDraft
                    : isRecording
                      ? false
                      : isTranscribing
                        ? true
                        : !input.trim() && attachedFiles.length === 0
              }
              aria-label={submitAriaLabel}
              title={submitAriaLabel}
              className="composer-send-hit-target ml-4 [&_svg]:size-5"
            >
              {isTranscribing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUpIcon className="h-5 w-5" />
              )}
            </PromptInputSubmit>
          </div>
        </PromptInputFooter>
        </PromptInput>
      </div>}
    </div>
  );
}
