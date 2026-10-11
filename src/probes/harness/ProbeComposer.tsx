import { useRef, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import ChatComposer from '../../components/chat/view/subcomponents/ChatComposer';

type ComposerProps = ComponentProps<typeof ChatComposer>;

const noop = () => {};
const asyncNoop = async () => {};
const EMPTY_MAP = new Map<string, never>();

/**
 * The real composer, idle, on inert props. Typed against the component, so a
 * changed prop fails typecheck here instead of drifting quietly.
 */
export default function ProbeComposer({ overrides }: { overrides?: Partial<ComposerProps> }) {
  const { t } = useTranslation('chat');
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputHighlightRef = useRef<HTMLDivElement>(null);

  const props: ComposerProps = {
    pendingPermissionRequests: [],
    handlePermissionDecision: noop,
    handleGrantToolPermission: () => ({ success: false }),
    activity: null,
    isLoading: false,
    onAbortSession: noop,
    permissionMode: 'default',
    availablePermissionModes: ['default'],
    onSelectPermissionMode: noop,
    collaborationMode: null,
    availableCollaborationModes: [],
    onSelectCollaborationMode: noop,
    providerLabel: 'Claude',
    providerOptions: [{ value: 'claude', label: 'Claude', connected: true, loading: false }],
    canSwitchProvider: false,
    effort: '',
    availableEffortOptions: [],
    onSelectEffort: noop,
    fastMode: false,
    onSelectFastMode: noop,
    model: 'opus',
    availableModelOptions: [],
    modelCatalog: {},
    onSelectModel: asyncNoop,
    modelsLoading: false,
    modelMenuOpenRequest: 0,
    tokenBudget: null,
    usagePopoverRequest: { id: 0, view: 'summary' },
    onShowContextBreakdown: noop,
    onRefreshContextBreakdown: noop,
    isRefreshingContextBreakdown: false,
    sessionKey: 'probe-session',
    canStartSession: true,
    provider: 'claude',
    onSubmit: (event) => event.preventDefault(),
    isDragActive: false,
    queuedDraft: null,
    onEditQueuedDraft: noop,
    onDeleteQueuedDraft: noop,
    queuedAnswers: [],
    onRemoveQueuedAnswer: noop,
    editingSchedule: null,
    onCancelScheduleEdit: noop,
    onScheduleMessage: noop,
    canScheduleOnUsageReset: false,
    scheduleDraft: null,
    onScheduleDraftChange: noop,
    pendingRewind: null,
    onCancelRewindEdit: noop,
    showProviderUpdate: false,
    onProviderUpdated: noop,
    showSettingsChangeNotice: false,
    onDismissSettingsChangeNotice: noop,
    attachedFiles: [],
    onRemoveAttachment: noop,
    uploadingFiles: EMPTY_MAP,
    fileErrors: EMPTY_MAP,
    attachmentRejections: [],
    onDismissAttachmentRejections: noop,
    showFileDropdown: false,
    filteredFiles: [],
    selectedFileIndex: -1,
    onSelectFile: noop,
    filteredCommands: [],
    selectedCommandIndex: -1,
    onCommandSelect: noop,
    onCloseCommandMenu: noop,
    isCommandMenuOpen: false,
    frequentCommands: [],
    slashCommands: [],
    getRootProps: () => ({}),
    getInputProps: () => ({}),
    onAttachFiles: noop,
    inputHighlightRef,
    renderInputWithMentions: (text) => text,
    textareaRef,
    input,
    onInputChange: (event) => setInput(event.target.value),
    onTextareaClick: noop,
    onTextareaKeyDown: noop,
    onTextareaPaste: noop,
    onTextareaScrollSync: noop,
    onTextareaInput: noop,
    placeholder: t('input.placeholder', { provider: 'Claude' }),
    isTextareaExpanded: false,
    ...overrides,
  };

  return (
    <div className="relative flex-shrink-0">
      <ChatComposer {...props} />
    </div>
  );
}
