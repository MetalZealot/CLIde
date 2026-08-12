/**
 * Curated Codex App Server protocol subset used by CLIde Chat.
 *
 * Source: `codex app-server generate-ts --experimental` from the CLI bundled
 * with @openai/codex-sdk 0.147.0. Keep this intentionally smaller than the
 * generated surface; `codex-app-server-protocol-drift.test.ts` regenerates
 * bindings in a temporary directory and verifies every required method/field.
 */

export type CodexRequestId = string | number;
export type CodexReasoningEffort = string;

export type CodexApprovalPolicy =
  | 'untrusted'
  | 'on-request'
  | 'never'
  | {
      granular: {
        sandbox_approval: boolean;
        rules: boolean;
        skill_approval: boolean;
        request_permissions: boolean;
        mcp_elicitations: boolean;
      };
    };

export type CodexSandboxPolicy =
  | { type: 'dangerFullAccess' }
  | { type: 'readOnly'; networkAccess: boolean }
  | {
      type: 'workspaceWrite';
      writableRoots: string[];
      networkAccess: boolean;
      excludeTmpdirEnvVar: boolean;
      excludeSlashTmp: boolean;
    };

export type CodexCollaborationMode = {
  mode: 'plan' | 'default';
  settings: {
    model: string;
    reasoning_effort: CodexReasoningEffort | null;
    developer_instructions: string | null;
  };
};

export type CodexUserInput =
  | { type: 'text'; text: string; text_elements: [] }
  | { type: 'image'; detail?: 'auto' | 'low' | 'high'; url: string }
  | { type: 'localImage'; detail?: 'auto' | 'low' | 'high'; path: string };

export type CodexThread = {
  id: string;
  sessionId: string;
  forkedFromId?: string | null;
  path: string | null;
  cwd: string;
  turns?: CodexTurn[];
};

export type CodexThreadStartParams = {
  model?: string | null;
  cwd?: string | null;
  approvalPolicy?: CodexApprovalPolicy | null;
  approvalsReviewer?: 'user' | 'auto_review' | 'guardian_subagent' | null;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access' | null;
};

export type CodexThreadResumeParams = CodexThreadStartParams & {
  threadId: string;
};

export type CodexThreadResponse = {
  thread: CodexThread;
  model: string;
  cwd: string;
  reasoningEffort: CodexReasoningEffort | null;
};

export type CodexThreadForkParams = CodexThreadStartParams & {
  threadId: string;
  /** Fork through this completed turn, inclusive. */
  lastTurnId?: string | null;
  /** Fork before this turn, excluding it and all later turns. */
  beforeTurnId?: string | null;
  excludeTurns?: boolean;
};

export type CodexThreadForkResponse = CodexThreadResponse;

export type CodexTurnStartParams = {
  threadId: string;
  input: CodexUserInput[];
  cwd?: string | null;
  approvalPolicy?: CodexApprovalPolicy | null;
  approvalsReviewer?: 'user' | 'auto_review' | 'guardian_subagent' | null;
  sandboxPolicy?: CodexSandboxPolicy | null;
  model?: string | null;
  effort?: CodexReasoningEffort | null;
  collaborationMode?: CodexCollaborationMode | null;
};

export type CodexTurn = {
  id: string;
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  error: {
    message: string;
    additionalDetails?: string | null;
  } | null;
};

export type CodexTurnStartResponse = {
  turn: CodexTurn;
};

export type CodexTokenUsage = {
  total: CodexTokenUsageBreakdown;
  last: CodexTokenUsageBreakdown;
  modelContextWindow: number | null;
};

export type CodexTokenUsageBreakdown = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export type CodexQuestionOption = {
  label: string;
  description: string;
};

export type CodexQuestion = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: CodexQuestionOption[] | null;
};

export type CodexToolRequestUserInputParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  questions: CodexQuestion[];
  autoResolutionMs: number | null;
  /** Added in 0.147; optional so older emergency runtimes keep legacy behavior. */
  isBlocking?: boolean;
};

export type CodexToolRequestUserInputResponse = {
  answers: Record<string, { answers: string[] }>;
};

export type CodexCommandApprovalParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  approvalId?: string | null;
  reason?: string | null;
  command?: string | null;
  cwd?: string | null;
  networkApprovalContext?: {
    host: string;
    protocol: string;
  } | null;
};

export type CodexApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | 'decline'
  | 'cancel';

export type CodexFileChangeApprovalParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  reason?: string | null;
  grantRoot?: string | null;
};

export type CodexAdditionalFileSystemPermissions = {
  read: string[] | null;
  write: string[] | null;
  globScanMaxDepth?: number;
  entries?: Array<{
    path: unknown;
    access: unknown;
  }>;
};

export type CodexAdditionalNetworkPermissions = {
  enabled: boolean | null;
};

export type CodexRequestPermissionProfile = {
  network: CodexAdditionalNetworkPermissions | null;
  fileSystem: CodexAdditionalFileSystemPermissions | null;
};

export type CodexPermissionsApprovalParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  cwd: string;
  reason: string | null;
  permissions: CodexRequestPermissionProfile;
};

export type CodexThreadItem =
  | { type: 'userMessage'; id: string; content: CodexUserInput[] }
  | { type: 'agentMessage'; id: string; text: string }
  | { type: 'plan'; id: string; text: string }
  | { type: 'reasoning'; id: string; summary: string[]; content: string[] }
  | {
      type: 'commandExecution';
      id: string;
      command: string;
      cwd: string;
      status: string;
      aggregatedOutput: string | null;
      exitCode: number | null;
    }
  | {
      type: 'fileChange';
      id: string;
      changes: Array<{ path: string; kind: unknown; diff: string }>;
      status: string;
    }
  | {
      type: 'mcpToolCall';
      id: string;
      server: string;
      tool: string;
      status: string;
      arguments: unknown;
      result: unknown;
      error: unknown;
    }
  | { type: 'webSearch'; id: string; query?: string };

export type CodexNotification =
  | {
      method: 'item/started';
      params: {
        threadId: string;
        turnId: string;
        item: CodexThreadItem;
      };
    }
  | {
      method: 'item/completed';
      params: {
        threadId: string;
        turnId: string;
        completedAtMs: number;
        item: CodexThreadItem;
      };
    }
  | {
      method: 'thread/tokenUsage/updated';
      params: {
        threadId: string;
        turnId: string;
        tokenUsage: CodexTokenUsage;
      };
    }
  | {
      method: 'turn/completed';
      params: {
        threadId: string;
        turn: CodexTurn;
      };
    }
  | {
      method: 'serverRequest/resolved';
      params: {
        threadId: string;
        requestId: CodexRequestId;
      };
    }
  | {
      method: 'error';
      params: {
        threadId?: string;
        turnId?: string;
        error?: unknown;
        message?: string;
      };
    };
