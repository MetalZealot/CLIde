import type { Project, ProjectSession, LLMProvider } from '../../../types/app';
import type {
  CreateWorktreeOptions,
  CreateWorktreeOutcome,
} from '../../sidebar/types/types';
import type {
  MarkSessionIdle,
  MarkSessionProcessing,
  SessionActivityMap,
} from '../../../hooks/useSessionProtection';

export type Provider = LLMProvider;

export type PermissionMode = 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan';
export type CollaborationMode = 'build' | 'plan';

export interface ChatAttachment {
  /** Absolute path inside the server-managed chat attachment store. */
  path?: string;
  name?: string;
  mimeType?: string;
  size?: number;
}

export interface ChatImage extends ChatAttachment {
  /** Inline data URL (Claude history stores image attachments as base64). */
  data?: string;
}

export interface ToolResult {
  content?: unknown;
  isError?: boolean;
  timestamp?: string | number | Date;
  toolUseResult?: unknown;
  [key: string]: unknown;
}

export interface SubagentChildTool {
  toolId: string;
  toolName: string;
  toolInput: unknown;
  toolResult?: ToolResult | null;
  timestamp: Date;
}

export interface MemoryCitation {
  source: string;
  note?: string;
}

export interface ChatMessage {
  type: string;
  /**
   * Normalized message id. For Claude this is the transcript uuid (plus an
   * optional part suffix) — the stable anchor the rewind feature sends back
   * to the server. Absent on optimistic/legacy messages.
   */
  id?: string;
  content?: string;
  displayText?: string;
  timestamp: string | number | Date;
  images?: ChatImage[];
  files?: ChatAttachment[];
  reasoning?: string;
  isThinking?: boolean;
  isStreaming?: boolean;
  isInteractivePrompt?: boolean;
  isToolUse?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResult | null;
  toolId?: string;
  toolCallId?: string;
  commandName?: string;
  commandMessage?: string;
  commandArgs?: string;
  isLocalCommand?: boolean;
  isLocalCommandStdout?: boolean;
  isCompactSummary?: boolean;
  /** Files a compaction carried across the boundary; rendered like memory citations. */
  compactReferences?: string[];
  /** CLI-fabricated notice rows (usage limits, API errors) — muted banner, not a Claude bubble. */
  isSystemNotice?: boolean;
  /** Parsed from Codex's trailing provenance envelope; rendered as compact sources. */
  memoryCitations?: MemoryCitation[];
  isSubagentContainer?: boolean;
  subagentState?: {
    childTools: SubagentChildTool[];
    currentToolIndex: number;
    isComplete: boolean;
  };
  [key: string]: unknown;
}

export interface ClaudeSettings {
  allowedTools: string[];
  disallowedTools: string[];
  skipPermissions: boolean;
  projectSortOrder: string;
  lastUpdated?: string;
  [key: string]: unknown;
}

export interface ClaudePermissionSuggestion {
  toolName: string;
  entry: string;
  isAllowed: boolean;
}

export interface PermissionGrantResult {
  success: boolean;
  alreadyAllowed?: boolean;
  updatedSettings?: ClaudeSettings;
}

export interface PendingPermissionRequest {
  requestId: string;
  provider?: Provider;
  requestType?:
    | 'tool_approval'
    | 'user_input'
    | 'command_approval'
    | 'file_change_approval'
    | 'permission_approval';
  toolName: string;
  input?: unknown;
  context?: unknown;
  /** The SDK's tool_use id, if the server supplied one — lets panels (e.g. AskUserQuestion) optimistically patch the matching message. */
  toolId?: string;
  sessionId?: string | null;
  receivedAt?: Date | string;
  isBlocking?: boolean;
  expiresAt?: Date | string | null;
  autoResolutionMs?: number | null;
  questions?: Question[];
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  id?: string;
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
  allowOther?: boolean;
  isSecret?: boolean;
}

export type SessionNavigationOptions = {
  replace?: boolean;
};

export type SessionEstablishedContext = {
  provider: LLMProvider;
  project: Project;
  summary?: string | null;
};

export interface ChatInterfaceProps {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => boolean;
  onFileOpen?: (filePath: string, diffInfo?: any) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onSessionProcessing?: MarkSessionProcessing;
  onSessionIdle?: MarkSessionIdle;
  processingSessions?: SessionActivityMap;
  onNavigateToSession?: (targetSessionId: string, options?: SessionNavigationOptions) => void;
  onSessionEstablished?: (sessionId: string, context: SessionEstablishedContext) => void;
  onShowSettings?: () => void;
  showRawParameters?: boolean;
  showThinking?: boolean;
  sendByCtrlEnter?: boolean;
  enterToSend?: boolean;
  externalMessageUpdate?: number;
  newSessionTrigger?: number;
  onTaskClick?: (...args: unknown[]) => void;
  onShowAllTasks?: (() => void) | null;
  onNewSessionTarget: (project: Project) => void;
  onProjectsRefresh: () => Promise<Project[]>;
  onCreateWorktree: (options: CreateWorktreeOptions) => Promise<CreateWorktreeOutcome>;
}
