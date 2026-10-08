/**
 * Claude SDK Integration
 *
 * This module provides SDK-based integration with Claude using the @anthropic-ai/claude-agent-sdk.
 * It mirrors the interface of claude-cli.js but uses the SDK internally for better performance
 * and maintainability.
 *
 * Key features:
 * - Direct SDK integration without child processes
 * - Session management with abort capability
 * - Options mapping between CLI and SDK formats
 * - WebSocket message streaming
 */

import crypto from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { query } from '@anthropic-ai/claude-agent-sdk';

import {
  appendFilesInputTag,
  buildClaudeUserContent,
  normalizeImageDescriptors
} from '@/shared/image-attachments.js';
import {
  readClaudeContextWindowOverride,
  resolveClaudeCeilingProvenance,
  resolveClaudeContextCeiling,
  toCeilingProvenanceFields,
} from '@/modules/providers/list/claude/claude-context-window.js';
import {
  captureClaudeContextUsage,
  getClaudeContextCeiling,
  loadClaudeContextCeiling,
} from '@/modules/providers/list/claude/claude-context-usage.js';
import { rememberClaudeTerminalCommands } from '@/modules/providers/list/claude/claude-commands.js';
import { CLAUDE_PERSISTABLE_EFFORT_LEVELS } from '@/modules/providers/list/claude/claude-effort.settings.js';
import { CLAUDE_FALLBACK_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { createClaudeTextStream } from '@/modules/providers/list/claude/claude-text-stream.js';
import { normalizeClaudeRateLimitEvent } from '@/modules/providers/list/claude/claude-usage.provider.js';
import { providerUsageService } from '@/modules/providers/services/provider-usage.service.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import {
  createNotificationEvent,
  notifyRunFailed,
  notifyRunStopped,
  notifyUserIfEnabled
} from '@/modules/notifications/index.js';
import {
  computeResumeAnchor,
  encodeClaudeProjectDir,
  extractBaseTranscriptUuid,
  readTranscriptEntries,
} from '@/modules/providers/list/claude/claude-rewind.util.js';
import { interactiveRequestRegistry } from '@/modules/providers/services/interactive-request-registry.service.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

import { scopeClaudeChatBrowser } from '../../shared/mcp/chat-browser.js';

// Swapped for a fake by the runtime tests; production always runs the SDK's.
let runQuery = query;

/**
 * Replaces the SDK's `query()` for the provider tests, which drive whole turns
 * against a scripted fake. `null` restores the SDK's.
 * @param {Function|null} fake
 */
export function setClaudeQueryForTests(fake) {
  runQuery = fake ?? query;
}

// Keyed by the app session id; provider ids only for callers that supply none.
const activeSessions = new Map();
// Sessions cancelled via abort-session. The abort handler already sent the
// terminal `complete` (aborted: true) to the client, so the run loop must not
// emit a second one when its generator winds down.
const abortedSessionIds = new Set();

const TOOL_APPROVAL_TIMEOUT_MS = parseInt(process.env.CLAUDE_TOOL_APPROVAL_TIMEOUT_MS, 10) || 55000;
// Silence after which a run held open for background work gives up and closes its input.
const BACKGROUND_HOLD_SILENCE_MS = 30 * 60 * 1000;

// How long a run stopped before its first frame waits for the CLI's transcript.
const MINTED_TRANSCRIPT_WAIT_MS = 5000;

const CLAUDE_CONTEXT_USAGE_REFRESH_MS =
  parseInt(process.env.CLAUDE_CONTEXT_USAGE_REFRESH_MS, 10) || 60000;

const TOOLS_REQUIRING_INTERACTION = new Set(['AskUserQuestion', 'ExitPlanMode']);

// Auto-allowed while the mode is plan, on top of the user's own allow list.
const PLAN_MODE_TOOLS = ['Read', 'Task', 'exit_plan_mode', 'TodoRead', 'TodoWrite', 'WebFetch', 'WebSearch'];

/** Model the CLI stamps on rows it fabricated rather than the model producing. */
const SYNTHETIC_MODEL = '<synthetic>';

/**
 * One greppable line per turn event. A silent turn is a retry storm, a slow
 * model or a dead request, and nothing else distinguishes them after the fact,
 * so every line carries the app session id and elapsed milliseconds. Metadata
 * only: never prompt, reply, thinking or tool content.
 */
function formatTurnLog(event, sessionId, fields = {}) {
  const parts = [`[turn] ${event}`, `session=${sessionId || 'new'}`];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    parts.push(`${key}=${typeof value === 'string' ? value.replace(/\s+/g, ' ').slice(0, 160) : value}`);
  }
  return parts.join(' ');
}

function logTurn(event, sessionId, fields) {
  console.log(formatTurnLog(event, sessionId, fields));
}

/** SDK frame kinds this runtime or the normalizer acts on; the rest are counted in a turn's `dropped=`. */
const HANDLED_SDK_FRAMES = new Set([
  'assistant', 'user', 'result', 'rate_limit_event', 'stream_event',
  'system/init', 'system/compact_boundary', 'system/status', 'system/api_retry', 'system/thinking_tokens',
  'system/background_tasks_changed', 'system/task_started', 'system/task_updated', 'system/task_progress',
  'system/task_notification',
]);

function recordDroppedFrame(dropped, message) {
  const kind = message?.type === 'system' ? `system/${message.subtype}` : String(message?.type ?? 'unknown');
  if (!HANDLED_SDK_FRAMES.has(kind)) {
    dropped.set(kind, (dropped.get(kind) || 0) + 1);
  }
}

function formatDroppedFrames(dropped) {
  return [...dropped].map(([kind, count]) => `${kind}:${count}`).join(',');
}

/**
 * The turn's output tokens as shown beside the activity label. Mid-turn an
 * assistant row reports a placeholder `output_tokens` (1–2, measured against
 * CLI 2.1.280), so a finished step keeps at least its thinking estimate; the
 * result's real total replaces the running sum.
 */
function createTurnTokenCounter() {
  // Rows of one step share a message id, so each id is credited once.
  const stepTokens = new Map();
  let finished = 0;
  let estimate = 0;
  let base = 0;
  let live = 0;
  let resultTotal = null;
  return {
    thinking(estimated) {
      estimate = estimated || estimate;
      // A lower estimate means the CLI restarted the count for a new step.
      if (estimate < base) {
        base = 0;
      }
      live = estimate - base;
    },
    step(id, output) {
      if (!id) return;
      const previous = stepTokens.get(id) ?? 0;
      const credit = Math.max(previous + live, typeof output === 'number' ? output : 0);
      finished += credit - previous;
      stepTokens.set(id, credit);
      base = estimate;
      live = 0;
    },
    result(output) {
      if (typeof output === 'number' && output > 0) {
        resultTotal = output;
      }
    },
    total: () => resultTotal ?? finished + live,
  };
}

/** How the SDK rethrows a turn that ended on an error result. */
const SDK_ERROR_RESULT_PREFIX = 'Claude Code returned an error result:';

/**
 * Whether a thrown error is only the SDK handing back text already streamed as
 * a notice row. Drawing it again is the same event twice live and once after a
 * reload, since only the notice reaches the transcript. Requires the row to
 * have gone out, so an error result nothing announced still reaches the user.
 */
function duplicatesStreamedNotice(noticeStreamed, error) {
  return noticeStreamed
    && typeof error?.message === 'string'
    && error.message.startsWith(SDK_ERROR_RESULT_PREFIX);
}

function resolveClaudeEffort(model, effort, modelsDefinition = CLAUDE_FALLBACK_MODELS) {
  const selectedModel = modelsDefinition?.OPTIONS?.find((option) => option.value === model) || null;
  const allowedEfforts = selectedModel?.effort?.values
    ?.map((value) => value.value) || [];
  return typeof effort === 'string' && effort !== 'default' && allowedEfforts.includes(effort)
    ? effort
    : undefined;
}

function createRequestId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function waitForToolApproval(requestId, options = {}) {
  const { timeoutMs = TOOL_APPROVAL_TIMEOUT_MS, signal, onCancel, onResolved, metadata } = options;

  return new Promise(resolve => {
    let settled = false;

    const finalize = (decision) => {
      if (settled) return;
      settled = true;
      resolve(decision);
    };

    const receivedAt = metadata?._receivedAt instanceof Date
      ? metadata._receivedAt
      : new Date();
    const sessionId = metadata?._sessionId || null;
    const toolName = metadata?._toolName || 'UnknownTool';

    interactiveRequestRegistry.register({
      requestId,
      provider: 'claude',
      sessionId,
      requestType: toolName === 'AskUserQuestion' ? 'user_input' : 'tool_approval',
      toolName,
      toolId: metadata?._toolId,
      input: metadata?._input,
      context: metadata?._context,
      receivedAt: receivedAt.toISOString(),
      autoResolutionMs: timeoutMs > 0 ? timeoutMs : null,
      expiresAt: timeoutMs > 0
        ? new Date(receivedAt.getTime() + timeoutMs).toISOString()
        : null,
    }, {
      timeoutMs,
      signal,
      onResponse: (decision) => {
        finalize(decision);
      },
      onTimeout: () => {
        onCancel?.('timeout');
        finalize(null);
      },
      onCancel: () => {
        onCancel?.('cancelled');
        finalize({ cancelled: true });
      },
      onSettled: (reason) => {
        if (reason === 'response') {
          onResolved?.();
        }
      },
    });
  });
}

async function resolveToolApproval(requestId, decision) {
  return interactiveRequestRegistry.resolve(requestId, decision);
}

// Match stored permission entries against a tool + input combo.
// This only supports exact tool names and the Bash(command:*) shorthand
// used by the UI; it intentionally does not implement full glob semantics,
// introduced to stay consistent with the UI's "Allow rule" format.
function matchesToolPermission(entry, toolName, input) {
  if (!entry || !toolName) {
    return false;
  }

  if (entry === toolName) {
    return true;
  }

  const bashMatch = entry.match(/^Bash\((.+):\*\)$/);
  if (toolName === 'Bash' && bashMatch) {
    const allowedPrefix = bashMatch[1];
    let command = '';

    if (typeof input === 'string') {
      command = input.trim();
    } else if (input && typeof input === 'object' && typeof input.command === 'string') {
      command = input.command.trim();
    }

    if (!command) {
      return false;
    }

    return command.startsWith(allowedPrefix);
  }

  return false;
}

function mapCliOptionsToSDK(options = {}) {
  const { providerSessionId, cwd, toolsSettings, permissionMode, effort } = options;

  const sdkOptions = {};

  // Forward all host env vars (e.g. ANTHROPIC_BASE_URL) to the subprocess.
  // Since SDK 0.2.113, options.env replaces process.env instead of overlaying it.
  // Also how CLI-side knobs reach the child: CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS sets how long
  // the CLI waits for still-running background agents after a turn (default 600000 ms; 0 = forever).
  sdkOptions.env = {
    ...process.env,
    // Spawn phases on `init` and per-turn request timing on `result`, for the scorecard.
    CLAUDE_CODE_EMIT_STARTUP_TIMING: '1',
  };

  // Resolve the executable eagerly on Windows because the SDK uses raw child_process.spawn,
  // which does not reliably follow npm's shell wrappers like cross-spawn does.
  sdkOptions.pathToClaudeCodeExecutable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);

  if (cwd) {
    sdkOptions.cwd = cwd;
  }

  // Send explicitly — omitting it inherits permissions.defaultMode from Claude
  // settings, which can outrank what the picker shows.
  if (permissionMode) {
    sdkOptions.permissionMode = permissionMode;
  }

  // The picker's mode is the only bypass; a stored skip flag is ignored (ADR 0064).
  const settings = toolsSettings || {
    allowedTools: [],
    disallowedTools: []
  };

  let allowedTools = [...(settings.allowedTools || [])];

  if (permissionMode === 'plan') {
    for (const tool of PLAN_MODE_TOOLS) {
      if (!allowedTools.includes(tool)) {
        allowedTools.push(tool);
      }
    }
  }

  sdkOptions.allowedTools = allowedTools;

  // Use the tools preset to make all default built-in tools available (including AskUserQuestion).
  // This was introduced in SDK 0.1.57. Omitting this preserves existing behavior (all tools available),
  // but being explicit ensures forward compatibility and clarity.
  sdkOptions.tools = { type: 'preset', preset: 'claude_code' };

  sdkOptions.disallowedTools = settings.disallowedTools || [];

  // Lets a live switch to bypass work; until the picker chooses bypass, every
  // other mode still asks (probe 5). The mode itself stays the picker's (ADR 0064).
  sdkOptions.allowDangerouslySkipPermissions = true;

  // Unset lets Claude Code apply its own precedence (ANTHROPIC_MODEL, settings
  // cascade, plan default). "default" is not a real alias: sending it drops the
  // CLI to built-in Sonnet. Filtered here as well as on read, for clients that
  // have not reloaded since the catalog changed.
  if (options.model && options.model !== 'default') {
    sdkOptions.model = options.model;
  }

  const effortModels = options.effortModels || CLAUDE_FALLBACK_MODELS;
  const resolvedEffort = resolveClaudeEffort(
    // No explicit model: effort resolves against the catalog default, which is
    // what will actually run.
    sdkOptions.model || effortModels.DEFAULT,
    effort,
    effortModels,
  );
  if (resolvedEffort) {
    sdkOptions.effort = resolvedEffort;
  }

  // Always explicit: flag settings outrank a `/fast` toggle left in user settings,
  // so the session's own pick decides. The CLI ignores it on models without fast mode.
  sdkOptions.settings = { fastMode: options.fastMode === true };

  sdkOptions.systemPrompt = {
    type: 'preset',
    preset: 'claude_code'
  };

  // Opus 5.x omits thinking text unless asked; adaptive is already the CLI's
  // default where a model supports it (measured 2026-10-06).
  sdkOptions.thinking = { type: 'adaptive', display: 'summarized' };

  sdkOptions.settingSources = ['project', 'user', 'local'];

  // Ephemeral runs (e.g. commit-message generation) must opt out: a persisted
  // jsonl makes the session watcher surface the one-shot query as a real
  // sidebar session.
  if (options.persistSession === false) {
    sdkOptions.persistSession = false;
  } else {
    // Word-by-word replies; one-shot runs read only the finished rows.
    sdkOptions.includePartialMessages = true;
  }

  // File snapshots give a future file-restore rewind its checkpoints.
  // Conversation-only rewind does not need them, and they are pointless with no
  // transcript to write into.
  if (process.env.CLIDE_DISABLE_CHECKPOINTS !== '1' && options.persistSession !== false) {
    sdkOptions.enableFileCheckpointing = true;
  }

  // The SDK resumes with the provider-native session id, never the app id.
  if (providerSessionId) {
    sdkOptions.resume = providerSessionId;
  }

  if (providerSessionId && options.resumeSessionAt) {
    // Resume up to and including this assistant uuid. Verified 2026-07-22
    // (scripts/verify-rewind-sdk.ts): the session id is unchanged and the new
    // turn is APPENDED with parentUuid = the anchor, so the transcript is a
    // tree and readers must follow the active parent chain.
    sdkOptions.resumeSessionAt = options.resumeSessionAt;
  }

  // Abort must work before the SDK announces a provider id: the id-keyed
  // `abortClaudeSDKSession` path cannot reach a run in that window. The gateway
  // hands in the run's controller at spawn, so the signal is live from tick one.
  if (options.abortController) {
    sdkOptions.abortController = options.abortController;
  }

  return sdkOptions;
}

/**
 * Adds a session to the active sessions map
 * @param {string} sessionId - Session identifier
 * @param {Object} queryInstance - SDK query instance
 * @param {Object} writer - WebSocket writer for reconnect support
 * @param {Object|null} input - The run's input stream, for steering
 */
function addSession(sessionId, queryInstance, writer = null, input = null, turn = null) {
  activeSessions.set(sessionId, {
    instance: queryInstance,
    startTime: Date.now(),
    status: 'active',
    writer,
    input,
    // The turn's live options and model catalog, for `controlClaudeSDKSession`.
    turn
  });
}

/**
 * Removes a session from the active sessions map
 * @param {string} sessionId - Session identifier
 */
function removeSession(sessionId) {
  activeSessions.delete(sessionId);
}

/**
 * Gets a session from the active sessions map
 * @param {string} sessionId - Session identifier
 * @returns {Object|undefined} Session data or undefined
 */
function getSession(sessionId) {
  return activeSessions.get(sessionId);
}

/**
 * Gets all active session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getAllSessions() {
  return Array.from(activeSessions.keys());
}

/**
 * Transforms SDK messages to WebSocket format expected by frontend
 * @param {Object} sdkMessage - SDK message object
 * @returns {Object} Transformed message ready for WebSocket
 */
function transformMessage(sdkMessage) {
  let message = sdkMessage;
  // Live rows carry the tool's structured result snake_case; transcript rows, camelCase.
  if (message.tool_use_result !== undefined && message.toolUseResult === undefined) {
    message = { ...message, toolUseResult: message.tool_use_result };
  }
  // Extract parent_tool_use_id for subagent tool grouping
  if (message.parent_tool_use_id) {
    return {
      ...message,
      parentToolUseId: message.parent_tool_use_id
    };
  }
  return message;
}

/** Gives a live limit notice the `quotaLimits` its transcript row carries, so it classifies as resumable. */
export function withLiveQuotaLimits(message, rejectedRateLimit) {
  if (message?.type !== 'assistant' || message.error !== 'rate_limit') return message;
  if (message.quotaLimits !== undefined || !rejectedRateLimit) return message;
  return { ...message, quotaLimits: rejectedRateLimit };
}

function readNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Picks the ring's denominator for one frame.
 *
 * Precedence: the `CONTEXT_WINDOW` env override (operator escape hatch), then
 * the SDK's own `maxTokens` for this session, then the derived fallback — used
 * until the mid-turn control request lands and forever on CLIs that never
 * answer it.
 *
 * @param {Object|null} ceiling - Cached `getContextUsage()` reading, if any
 * @param {Object} derivedInput - Fallback input for resolveClaudeContextCeiling
 * @returns {number} Usable context tokens
 */
function pickContextWindow(ceiling, derivedInput) {
  return readClaudeContextWindowOverride()
    ?? ceiling?.maxTokens
    ?? resolveClaudeContextCeiling(derivedInput);
}

/**
 * Where the ceiling came from, for the same frame. Derived rather than read off
 * the reading: a cap collapses every window field the SDK reports onto itself.
 */
function pickCeilingProvenance(derivedInput) {
  return toCeilingProvenanceFields(resolveClaudeCeilingProvenance(derivedInput));
}

/**
 * Extracts token usage from SDK messages.
 * Prefers per-step `message.usage` (Claude message payload), then falls back
 * to result-level usage/modelUsage for compatibility across SDK versions.
 * @param {Object} sdkMessage - SDK stream message
 * @param {Object|null} ceiling - Cached SDK context reading for this session
 * @returns {Object|null} Token budget object or null
 */
function extractTokenBudget(sdkMessage, ceiling = null) {
  if (!sdkMessage || typeof sdkMessage !== 'object') {
    return null;
  }
  // A subagent's frames measure its own context, not the session's.
  if (sdkMessage.parent_tool_use_id) {
    return null;
  }

  const messageUsage = sdkMessage.message?.usage || sdkMessage.usage;
  if (messageUsage && typeof messageUsage === 'object') {
    const directInputTokens = readNumber(messageUsage.input_tokens ?? messageUsage.inputTokens);
    const cacheCreationTokens = readNumber(messageUsage.cache_creation_input_tokens ?? messageUsage.cacheCreationInputTokens ?? messageUsage.cacheCreationTokens);
    const cacheReadTokens = readNumber(messageUsage.cache_read_input_tokens ?? messageUsage.cacheReadInputTokens ?? messageUsage.cacheReadTokens);
    const cacheTokens = cacheCreationTokens + cacheReadTokens;
    const inputTokens = directInputTokens + cacheTokens;
    const outputTokens = readNumber(messageUsage.output_tokens ?? messageUsage.outputTokens);
    const totalUsed = inputTokens + outputTokens;
    // Assistant frames name their own model, so the derived fallback tracks the
    // session's real model before the SDK reading lands.
    const contextWindow = pickContextWindow(ceiling, {
      model: sdkMessage.message?.model ?? sdkMessage.model,
    });

    // Claude fabricates assistant messages (session-limit notices, API-error
    // placeholders) with all-zero usage. Emitting one as a token_budget frame
    // would blank the composer's ring; skip and keep the last real reading.
    if (inputTokens <= 0) {
      return null;
    }

    return {
      used: totalUsed,
      total: contextWindow,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      cacheTokens,
      // Undefined until the SDK reading lands; a missing threshold means "no
      // auto-compact marker", not zero.
      autoCompactThreshold: ceiling?.autoCompactThreshold,
      isAutoCompactEnabled: ceiling?.isAutoCompactEnabled,
      ...pickCeilingProvenance({ model: sdkMessage.message?.model ?? sdkMessage.model }),
      breakdown: {
        input: inputTokens,
        output: outputTokens,
      },
    };
  }

  if (!sdkMessage.modelUsage || typeof sdkMessage.modelUsage !== 'object') {
    return null;
  }

  // Fallback for older SDK messages with only modelUsage
  const modelKey = Object.keys(sdkMessage.modelUsage)[0];
  const modelData = sdkMessage.modelUsage[modelKey];

  if (!modelData || typeof modelData !== 'object') {
    return null;
  }

  const inputTokens = readNumber(modelData.cumulativeInputTokens ?? modelData.inputTokens);
  const outputTokens = readNumber(modelData.cumulativeOutputTokens ?? modelData.outputTokens);
  const totalUsed = inputTokens + outputTokens;
  // SDK `ModelUsage` carries the model's own contextWindow, which outranks the
  // local registry table — a model newer than that table still resolves.
  const contextWindow = pickContextWindow(ceiling, {
    model: modelData.canonicalModel ?? modelKey,
    contextWindow: modelData.contextWindow,
  });

  return {
    used: totalUsed,
    total: contextWindow,
    inputTokens,
    outputTokens,
    autoCompactThreshold: ceiling?.autoCompactThreshold,
    isAutoCompactEnabled: ceiling?.isAutoCompactEnabled,
    ...pickCeilingProvenance({ model: modelData.canonicalModel ?? modelKey }),
    breakdown: {
      input: inputTokens,
      output: outputTokens,
    },
  };
}

/**
 * Builds the first user message's content for one turn: the prompt as a text
 * block, plus one base64 `image` block per image attachment (read from the
 * global `~/.cloudcli/assets` folder).
 *
 * @param {string} command - User prompt
 * @param {Array} images - Image descriptors ({ path, name?, mimeType? })
 * @param {Array} files - Non-image attachment descriptors
 * @param {string} cwd - Project working directory attachment paths resolve against
 * @returns {Promise<Array>} Message content blocks
 */
async function buildPromptContent(command, images, files, cwd) {
  const promptWithFiles = appendFilesInputTag(command, files);
  if (normalizeImageDescriptors(images).length === 0) {
    return [{ type: 'text', text: promptWithFiles }];
  }
  return buildClaudeUserContent(promptWithFiles, images, cwd);
}

function createUserInput(content) {
  return {
    type: 'user',
    session_id: '',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    timestamp: new Date().toISOString()
  };
}

/**
 * The run's prompt: an input stream the SDK reads for the whole turn, so text
 * pushed while tools run reaches the model within the same turn. Closed on the
 * first result with no background task running; input the CLI already holds
 * then runs as a follow-up turn inside the same run, so a push is never lost,
 * only refused once closed.
 */
export function createClaudeInputChannel(firstContent) {
  const pending = [createUserInput(firstContent)];
  let wake = null;
  let closed = false;
  const notify = () => {
    const resolve = wake;
    wake = null;
    resolve?.();
  };
  return {
    stream: (async function* () {
      while (true) {
        while (pending.length > 0) yield pending.shift();
        if (closed) return;
        await new Promise((resolve) => { wake = resolve; });
      }
    })(),
    push(text) {
      if (closed) return false;
      pending.push(createUserInput([{ type: 'text', text }]));
      notify();
      return true;
    },
    close() {
      closed = true;
      notify();
    },
    get isOpen() {
      return !closed;
    },
  };
}

/**
 * Background tasks that keep the run's input open. Closed input makes the CLI a
 * one-shot run, which stops background shells seconds after the result; ambient
 * tasks (watchers) are excluded so they cannot hold a run open indefinitely.
 */
export function countHeldBackgroundTasks(tasks) {
  return Array.isArray(tasks) ? tasks.filter((task) => task && task.ambient !== true).length : 0;
}

/**
 * Loads MCP server configurations from ~/.claude.json
 * @param {string} cwd - Current working directory for project-specific configs
 * @returns {Object|null} MCP servers object or null if none found
 */
async function loadMcpConfig(cwd) {
  try {
    const claudeConfigPath = path.join(os.homedir(), '.claude.json');

    // Check if config file exists
    try {
      await fs.access(claudeConfigPath);
    } catch (error) {
      // File doesn't exist, return null
      // No config file
      return null;
    }

    // Read and parse config file
    let claudeConfig;
    try {
      const configContent = await fs.readFile(claudeConfigPath, 'utf8');
      claudeConfig = JSON.parse(configContent);
    } catch (error) {
      console.error('Failed to parse ~/.claude.json:', error.message);
      return null;
    }

    // Extract MCP servers (merge global and project-specific)
    let mcpServers = {};

    // Add global MCP servers
    if (claudeConfig.mcpServers && typeof claudeConfig.mcpServers === 'object') {
      mcpServers = { ...claudeConfig.mcpServers };
      // Global MCP servers loaded
    }

    // Add/override with project-specific MCP servers
    if (claudeConfig.claudeProjects && cwd) {
      const projectConfig = claudeConfig.claudeProjects[cwd];
      if (projectConfig && projectConfig.mcpServers && typeof projectConfig.mcpServers === 'object') {
        mcpServers = { ...mcpServers, ...projectConfig.mcpServers };
        // Project MCP servers merged
      }
    }

    // Return null if no servers found
    if (Object.keys(mcpServers).length === 0) {
      return null;
    }
    return mcpServers;
  } catch (error) {
    console.error('Error loading MCP config:', error.message);
    return null;
  }
}

/**
 * Resolves the transcript jsonl path for a provider session: prefer the path
 * recorded in the DB row (threaded through as options.jsonlPath), fall back
 * to Claude's ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl layout.
 */
function resolveClaudeTranscriptPath(options, providerSessionId) {
  if (typeof options.jsonlPath === 'string' && options.jsonlPath) {
    return options.jsonlPath;
  }
  if (!options.cwd || !providerSessionId) {
    return null;
  }
  return path.join(
    os.homedir(),
    '.claude',
    'projects',
    encodeClaudeProjectDir(String(options.cwd)),
    `${providerSessionId}.jsonl`,
  );
}

/**
 * Translates a rewind request (the edited USER message's uuid) into what the
 * SDK actually accepts: `resumeSessionAt` wants the uuid of the preceding
 * ASSISTANT entry (verified by scripts/verify-rewind-sdk.ts). Returns:
 * - { resumeSessionAt } — resume up to that assistant turn, then send;
 * - { freshStart: true } — the first message was edited (no assistant
 *   ancestor): drop resume entirely and let a new provider session start;
 * - null — the message could not be located (caller reports the error).
 */
function resolveRewindPlan(options, providerSessionId) {
  const editedUuid = extractBaseTranscriptUuid(options.rewindToMessageId);
  if (!editedUuid) {
    return null;
  }
  const transcriptPath = resolveClaudeTranscriptPath(options, providerSessionId);
  if (!transcriptPath) {
    return null;
  }
  const anchor = computeResumeAnchor(readTranscriptEntries(transcriptPath), editedUuid);
  if (!anchor.found) {
    return null;
  }
  return anchor.anchorUuid ? { resumeSessionAt: anchor.anchorUuid } : { freshStart: true };
}

/**
 * Executes a Claude query using the SDK
 * @param {string} command - User prompt/command
 * @param {Object} options - Query options
 * @param {Object} ws - WebSocket connection
 * @param {Object} context - Provider-scoped model, session, and auth lookups
 * @returns {Promise<void>}
 */
async function queryClaudeSDK(command, options = {}, ws, context) {
  const { sessionId, sessionSummary } = options;
  // Callers pass the stable app session id; the SDK only understands the
  // provider-native id recorded on the session row.
  const providerSessionId = context.resolveProviderSessionId(sessionId);
  // Provider-native id as the SDK reports it (starts as the resume id, or is
  // captured from the stream for brand-new sessions).
  let capturedSessionId = providerSessionId;
  let sessionCreatedSent = false;
  // A new conversation's provider id, named before spawn (probe 9).
  let mintedSessionId = null;
  // The CLI fabricates a notice row for a usage limit or API error and *then*
  // the SDK throws that same text back wrapped. Both would draw a row.
  let noticeStreamed = false;
  // Process-map key: the app session id when the caller supplied one, else
  // the provider-native id once captured (legacy/direct API callers).
  const sessionKey = () => sessionId || capturedSessionId || null;

  // Two abort paths reach this run: `abortClaudeSDKSession` (id-keyed, records
  // in `abortedSessionIds`) and the gateway tripping this signal (works with no
  // id). Either already sent the terminal `complete`, so this run must not.
  const abortSignal = options.abortController?.signal ?? null;
  const wasRunAborted = () => {
    // `delete` both tests and clears, so it must run even when the signal
    // already reports the abort — a stale id would suppress the *next* run's
    // terminal complete. Same key `abortClaudeSDKSession` recorded.
    const key = sessionKey();
    const interruptClaimed = key ? abortedSessionIds.delete(key) : false;
    return interruptClaimed || Boolean(abortSignal?.aborted);
  };

  // Conversation rewind: resolve the resume shape before option mapping. A
  // fresh start behaves like a new session; the writer remaps the announced
  // provider id onto the app session, so the client never sees the id change.
  let rewindPlan = null;
  if (options.rewindToMessageId !== undefined && sessionId) {
    rewindPlan = resolveRewindPlan(options, sessionId);
    if (!rewindPlan) {
      ws.send(createNormalizedMessage({
        kind: 'error',
        content: 'Rewind failed: the selected message could not be located in the session transcript.',
        sessionId: sessionId || null,
        provider: 'claude'
      }));
      ws.send(createCompleteMessage({ provider: 'claude', sessionId: sessionId || null, exitCode: 1 }));
      return;
    }
    if (rewindPlan.freshStart) {
      capturedSessionId = null;
    }
  }

  // A run that never saw a frame never mapped its id. Mapped only once the CLI
  // has written the transcript: a mapping to a missing one would make every
  // later send fail to resume. The CLI writes it as it exits, up to ~0.8 s after
  // the run returns (measured 2026-10-06), so the check repeats in the
  // background. The watcher's duplicate row, if any, merges in.
  const claimMintedTranscript = () => {
    const transcriptPath = mintedSessionId && !capturedSessionId
      ? resolveClaudeTranscriptPath({ cwd: options.cwd }, mintedSessionId)
      : null;
    if (!transcriptPath) return;
    const minted = mintedSessionId;
    const deadline = Date.now() + MINTED_TRANSCRIPT_WAIT_MS;
    const check = async () => {
      try {
        await fs.access(transcriptPath);
      } catch {
        if (Date.now() < deadline) setTimeout(check, 100).unref();
        return;
      }
      ws.setSessionId?.(minted);
    };
    void check();
  };

  const turnStartedAt = Date.now();
  const sinceStart = () => Date.now() - turnStartedAt;
  let frames = 0;
  let retries = 0;
  let thinkingEstimate = 0;
  const droppedFrames = new Map();
  let sentLogged = false;
  // The live limit notice lacks the transcript's `quotaLimits`; this turn's rejected event supplies it.
  let rejectedRateLimit = null;
  // The rate-limit event can land after the first model output; "Sent" must not follow it.
  let outputStarted = false;
  const turnTokens = createTurnTokenCounter();
  let sentOutputTokens = 0;
  // The prompt stream `steer()` writes into; see createClaudeInputChannel.
  let inputChannel = null;
  let backgroundTasks = 0;
  // A turn ended with background work running; the CLI wakes the model when it settles.
  let holdingInput = false;
  // The label shows the wait until the next turn's output replaces it.
  let awaitingBackground = false;
  let backgroundHoldTimer = null;
  const clearBackgroundHold = () => {
    clearTimeout(backgroundHoldTimer);
    backgroundHoldTimer = null;
  };
  // Re-armed after every frame, so it measures silence.
  const armBackgroundHold = () => {
    if (!holdingInput) return;
    backgroundHoldTimer = setTimeout(() => {
      logTurn('background-timeout', sessionKey(), { tasks: backgroundTasks });
      inputChannel?.close();
    }, BACKGROUND_HOLD_SILENCE_MS);
  };
  let textStream = null;

  const emitNotification = (event) => {
    notifyUserIfEnabled({
      userId: ws?.userId || null,
      writer: ws,
      event
    });
  };

  try {
    const resolvedModel = await context.resolveResumeModel(sessionId, options.model);
    let effortModels = CLAUDE_FALLBACK_MODELS;
    try {
      effortModels = await context.getProviderModels();
    } catch (error) {
      console.warn('[Claude SDK] Unable to load provider models for effort validation:', error);
    }

    const sdkOptions = mapCliOptionsToSDK({
      ...options,
      // Editing the first message has nothing to resume: start fresh; the
      // announced id gets remapped onto the app session.
      providerSessionId: rewindPlan?.freshStart ? null : providerSessionId,
      resumeSessionAt: rewindPlan?.resumeSessionAt,
      model: resolvedModel || options.model,
      effortModels,
    });

    // Named up front so a run stopped before its first frame can still claim the
    // transcript the CLI wrote; the CLI refuses `sessionId` alongside `resume`.
    if (sessionId && !sdkOptions.resume) {
      mintedSessionId = crypto.randomUUID();
      sdkOptions.sessionId = mintedSessionId;
    }

    // Plan tools the user's own list lacks, so leaving plan mid-turn removes only these.
    const userAllowedTools = options.toolsSettings?.allowedTools || [];
    const liveTurn = {
      sdkOptions,
      effortModels,
      planToolsAdded: sdkOptions.permissionMode === 'plan'
        ? PLAN_MODE_TOOLS.filter((tool) => !userAllowedTools.includes(tool))
        : [],
    };

    const mcpServers = await loadMcpConfig(options.cwd);
    if (mcpServers) {
      sdkOptions.mcpServers = scopeClaudeChatBrowser(mcpServers, sessionId);
    }

    // Built per query attempt because an async generator cannot be replayed once consumed.
    const createPrompt = async () => {
      inputChannel?.close();
      inputChannel = createClaudeInputChannel(
        await buildPromptContent(command, options.images, options.files, options.cwd),
      );
      return inputChannel.stream;
    };

    sdkOptions.hooks = {
      Notification: [{
        matcher: '',
        hooks: [async (input) => {
          const message = typeof input?.message === 'string' ? input.message : 'Claude requires your attention.';
          // Notifications are app-facing, so they carry the app session id.
          emitNotification(createNotificationEvent({
            provider: 'claude',
            sessionId: sessionId || capturedSessionId || null,
            kind: 'action_required',
            code: 'agent.notification',
            meta: { message, sessionName: sessionSummary },
            severity: 'warning',
            requiresUserAction: true,
            dedupeKey: `claude:hook:notification:${sessionId || capturedSessionId || 'none'}:${message}`
          }));
          return {};
        }]
      }]
    };

    // Interactive tools reach this callback in every mode, bypass and auto
    // included (probe 4), so they always ask; other tools follow the mode.
    sdkOptions.canUseTool = async (toolName, input, context) => {
      const requiresInteraction = TOOLS_REQUIRING_INTERACTION.has(toolName);

      if (!requiresInteraction) {
        if (sdkOptions.permissionMode === 'bypassPermissions') {
          return { behavior: 'allow', updatedInput: input };
        }

        const isDisallowed = (sdkOptions.disallowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isDisallowed) {
          return { behavior: 'deny', message: 'Tool disallowed by settings' };
        }

        const isAllowed = (sdkOptions.allowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isAllowed) {
          return { behavior: 'allow', updatedInput: input };
        }
      }

      const requestId = createRequestId();
      // toolUseID lets the client optimistically patch the matching tool_use
      // message on submit, rather than waiting for the SDK's tool_result.
      ws.send(createNormalizedMessage({ kind: 'permission_request', requestId, toolName, input, toolId: context?.toolUseID, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
      emitNotification(createNotificationEvent({
        provider: 'claude',
        sessionId: sessionId || capturedSessionId || null,
        kind: 'action_required',
        code: 'permission.required',
        meta: { toolName, sessionName: sessionSummary },
        severity: 'warning',
        requiresUserAction: true,
        dedupeKey: `claude:permission:${sessionId || capturedSessionId || 'none'}:${requestId}`
      }));

      const decision = await waitForToolApproval(requestId, {
        timeoutMs: requiresInteraction ? 0 : undefined,
        signal: context?.signal,
        metadata: {
          // Keyed by the app session id so `chat.subscribe` can look pending
          // approvals up directly; provider id only for legacy callers.
          _sessionId: sessionId || capturedSessionId || null,
          _toolName: toolName,
          _input: input,
          _context: context,
          _toolId: context?.toolUseID,
          _receivedAt: new Date(),
        },
        onCancel: (reason) => {
          ws.send(createNormalizedMessage({ kind: 'permission_cancelled', requestId, reason, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        },
        onResolved: () => {
          ws.send(createNormalizedMessage({ kind: 'permission_cancelled', requestId, reason: 'resolved', sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        }
      });
      if (!decision) {
        return { behavior: 'deny', message: 'Permission request timed out' };
      }

      if (decision.cancelled) {
        return { behavior: 'deny', message: 'Permission request cancelled' };
      }

      if (decision.allow) {
        if (decision.rememberEntry && typeof decision.rememberEntry === 'string') {
          if (!sdkOptions.allowedTools.includes(decision.rememberEntry)) {
            sdkOptions.allowedTools.push(decision.rememberEntry);
          }
          if (Array.isArray(sdkOptions.disallowedTools)) {
            sdkOptions.disallowedTools = sdkOptions.disallowedTools.filter(entry => entry !== decision.rememberEntry);
          }
        }
        return { behavior: 'allow', updatedInput: decision.updatedInput ?? input };
      }

      return { behavior: 'deny', message: decision.message ?? 'User denied tool use' };
    };

    let queryInstance;
    try {
      queryInstance = runQuery({
        prompt: await createPrompt(),
        options: sdkOptions
      });
    } catch (hookError) {
      // Older/newer SDK versions may not accept hook shapes yet.
      // Keep notification behavior operational via runtime events even if hook registration fails.
      console.warn('Failed to initialize Claude query with hooks, retrying without hooks:', hookError?.message || hookError);
      delete sdkOptions.hooks;
      queryInstance = runQuery({
        prompt: await createPrompt(),
        options: sdkOptions
      });
    }

    // Track the query instance for abort capability
    if (sessionKey()) {
      addSession(sessionKey(), queryInstance, ws, inputChannel, liveTurn);
    }

    // Frames resolve their ceiling from memory only, which a restart empties
    // while the session's last reading is still on disk. One read here keeps a
    // resumed session on its real threshold from the first frame instead of
    // falling back to the derived window until a capture lands. A reading from
    // before a model switch is superseded by the first capture of this run.
    await loadClaudeContextCeiling(capturedSessionId);

    // Process streaming messages
    logTurn('start', sessionKey(), {
      model: sdkOptions.model || 'default',
      effort: sdkOptions.effort,
      resume: providerSessionId ? 'yes' : 'no',
    });
    // The label shows whatever stage the runtime last reported; an empty frame
    // hands it back to its own cycling words.
    let stageSent = false;
    const sendStage = (stage) => {
      stageSent = stage !== null;
      ws.send(createNormalizedMessage({
        kind: 'status',
        text: '',
        stage,
        sessionId: capturedSessionId || sessionId || null,
        provider: 'claude',
      }));
    };
    if (capturedSessionId || sessionId) {
      sendStage({ name: 'starting' });
    }
    textStream = createClaudeTextStream({
      onDelta: (delta) => ws.send(createNormalizedMessage({
        kind: 'text_delta',
        content: delta.text,
        streamKey: delta.streamKey,
        streamOffset: delta.offset,
        sessionId: capturedSessionId || sessionId || null,
        provider: 'claude',
      })),
      onDiscard: (streamKey) => ws.send(createNormalizedMessage({
        kind: 'stream_discard',
        streamKey,
        sessionId: capturedSessionId || sessionId || null,
        provider: 'claude',
      })),
    });
    let lastContextUsageAt = 0;
    for await (const message of queryInstance) {
      frames += 1;
      clearBackgroundHold();
      recordDroppedFrame(droppedFrames, message);
      if (frames === 1) {
        logTurn('first-frame', sessionKey() || message.session_id, {
          ms: sinceStart(),
          frame: message?.subtype ? `${message.type}/${message.subtype}` : message?.type,
          ready_ms: message?.startup_timing?.phases?.input_ready_ms,
        });
      }
      // Capture session ID from first message
      if (message.session_id && !capturedSessionId) {

        capturedSessionId = message.session_id;
        addSession(sessionKey(), queryInstance, ws, inputChannel, liveTurn);

        // Set session ID on writer
        if (ws.setSessionId && typeof ws.setSessionId === 'function') {
          ws.setSessionId(capturedSessionId);
        }

        // Send session-created event only once for sessions with nothing to resume
        if (!providerSessionId && !sessionCreatedSent) {
          sessionCreatedSent = true;
          ws.send(createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'claude' }));
        }
      } else if (message.session_id && capturedSessionId && message.session_id !== capturedSessionId) {
        // A forked resume announces a new provider id; the writer remaps it.
        // Only a run without an app id is keyed by the provider id.
        if (!sessionId) {
          removeSession(capturedSessionId);
        }
        capturedSessionId = message.session_id;
        if (!sessionId) {
          addSession(capturedSessionId, queryInstance, ws, inputChannel, liveTurn);
        }
        if (ws.setSessionId && typeof ws.setSessionId === 'function') {
          ws.setSessionId(capturedSessionId);
        }
      }

      // Ask the SDK for this session's real ceiling and auto-compact threshold.
      // It only answers while a turn is streaming, and the round trip costs
      // ~1s, so it is never awaited — blocking here would stall every frame.
      // Re-fires on an interval so a multi-minute turn keeps tracking instead of
      // freezing at whatever was true one second in. Frames arriving before a
      // capture lands use the derived fallback; each answer is cached for later
      // turns and /token-usage.
      if (capturedSessionId && Date.now() - lastContextUsageAt >= CLAUDE_CONTEXT_USAGE_REFRESH_MS) {
        lastContextUsageAt = Date.now(); // set before firing — prevents stacking
        void captureClaudeContextUsage(capturedSessionId, queryInstance);
      }

      if (message?.type === 'stream_event') {
        const signal = textStream.onStreamEvent(message);
        // The API answering; a warm turn may send no rate-limit event at all.
        if (signal === 'message_start' && !sentLogged) {
          sentLogged = true;
          logTurn('sent', sessionKey(), { ms: sinceStart() });
          if (!outputStarted) sendStage({ name: 'sent' });
        }
        // Words on screen end any stage, including a retry or a background wait mid-turn.
        if (signal === 'text') {
          outputStarted = true;
          awaitingBackground = false;
          if (stageSent) sendStage(null);
        }
        armBackgroundHold();
        continue;
      }
      const streamKey = message?.type === 'assistant' ? textStream.claim(message) : null;
      textStream.flush();

      // Transform and normalize message via adapter
      const transformedMessage = withLiveQuotaLimits(transformMessage(message), rejectedRateLimit);
      const sid = capturedSessionId || sessionId || null;

      // Compaction is a minutes-long silence in the stream unless it is
      // announced: the CLI reports it as a status message, `compacting` while
      // it runs and another value once the turn resumes. An empty status text
      // hands the label back to the indicator's own cycling words.
      if (message?.type === 'system' && message.subtype === 'api_retry') {
        retries += 1;
        logTurn('api-retry', sessionKey(), {
          ms: sinceStart(),
          attempt: `${message.attempt}/${message.max_retries}`,
          delay_ms: message.retry_delay_ms,
          http: message.error_status ?? 'none',
          error: typeof message.error === 'string' ? message.error : message.error?.type,
        });
        sendStage({
          name: 'retrying',
          attempt: message.attempt,
          maxAttempts: message.max_retries,
          reason: typeof message.error === 'string' ? message.error : message.error?.type,
        });
      }

      // The estimate climbs roughly once a second while the model thinks; only
      // the last value is logged, at the end of the turn.
      if (message?.type === 'system' && message.subtype === 'thinking_tokens') {
        thinkingEstimate = message.estimated_tokens || thinkingEstimate;
        outputStarted = true;
        sendStage({ name: 'thinking', tokens: thinkingEstimate });
        turnTokens.thinking(message.estimated_tokens);
      }

      if (message?.type === 'assistant') {
        turnTokens.step(message.message?.id, message.message?.usage?.output_tokens);
      }
      if (message?.type === 'system' && message.subtype === 'init') {
        rememberClaudeTerminalCommands(message.terminal_slash_commands);
      }
      if (message?.type === 'system' && message.subtype === 'background_tasks_changed') {
        backgroundTasks = countHeldBackgroundTasks(message.tasks);
        if (awaitingBackground) {
          awaitingBackground = backgroundTasks > 0;
          sendStage(awaitingBackground ? { name: 'background', count: backgroundTasks } : null);
        }
      }
      if (message?.type === 'result') {
        turnTokens.result(message.usage?.output_tokens);
        holdingInput = backgroundTasks > 0;
        awaitingBackground = holdingInput;
        if (holdingInput) {
          logTurn('background-wait', sessionKey(), { ms: sinceStart(), tasks: backgroundTasks });
          sendStage({ name: 'background', count: backgroundTasks });
        } else {
          inputChannel?.close();
        }
      }

      const turnOutputTokens = turnTokens.total();
      if (turnOutputTokens !== sentOutputTokens) {
        sentOutputTokens = turnOutputTokens;
        ws.send(createNormalizedMessage({
          kind: 'status',
          text: 'turn_tokens',
          outputTokens: turnOutputTokens,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'claude',
        }));
      }

      // A limit or API notice arrives as a `success` result whose text is the
      // error, so the subtype alone never says whether the turn worked.
      if (message?.type === 'result') {
        const failed = message.is_error === true || message.subtype !== 'success';
        logTurn(failed ? 'error-result' : 'result', sessionKey(), {
          ms: sinceStart(),
          subtype: message.subtype,
          api_ms: message.duration_api_ms,
          in: message.usage?.input_tokens,
          cache_write: message.usage?.cache_creation_input_tokens,
          cache_read: message.usage?.cache_read_input_tokens,
          out: message.usage?.output_tokens,
          request_ms: message.time_to_request_ms,
          ttft_ms: message.ttft_ms,
          detail: failed && typeof message.result === 'string' ? message.result : undefined,
        });
      }

      if (message?.type === 'system' && message.subtype === 'status') {
        const isCompacting = message.status === 'compacting';
        stageSent = isCompacting;
        ws.send(createNormalizedMessage({
          kind: 'status',
          text: isCompacting ? 'Compacting conversation' : '',
          stage: isCompacting ? { name: 'compacting' } : null,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'claude',
        }));
        if (message.compact_result === 'failed') {
          ws.send(createNormalizedMessage({
            kind: 'error',
            content: `Compaction failed: ${message.compact_error || 'no reason reported'}`,
            sessionId: capturedSessionId || sessionId || null,
            provider: 'claude',
          }));
        }
      }

      // Account-level usage push, not a transcript row: sent as a gateway
      // event (no message id, no session id) so no chat surface files it
      // under the conversation that happened to trigger it.
      if (message?.type === 'rate_limit_event') {
        const info = message.rate_limit_info || {};
        if (info.status === 'rejected') rejectedRateLimit = info;
        if (info.status && info.status !== 'allowed') {
          logTurn('usage', sessionKey(), {
            window: info.rateLimitType,
            status: info.status,
            utilization: info.utilization,
            threshold: info.surpassedThreshold,
            overage: info.isUsingOverage === true ? 'yes' : undefined,
            resets: typeof info.resetsAt === 'number' ? new Date(info.resetsAt * 1000).toISOString() : undefined,
          });
        }
        const windows = normalizeClaudeRateLimitEvent(message.rate_limit_info);
        if (windows.length > 0) {
          const usage = providerUsageService.mergeProviderUsageWindows('claude', windows);
          ws.send({ kind: 'provider_usage', provider: 'claude', usage });
        }
      }

      if (message?.isApiErrorMessage === true || message?.message?.model === SYNTHETIC_MODEL) {
        noticeStreamed = true;
      }

      // Text, a tool call or a tool result means the stage is over: those rows
      // are the activity now, and a stale "Thinking" would sit above them.
      if (message?.type === 'assistant' || message?.type === 'user') {
        outputStarted = true;
      }
      if (message?.type === 'assistant') {
        awaitingBackground = false;
      }
      if (stageSent && (message?.type === 'assistant' || message?.type === 'user')) {
        sendStage(null);
      }

      // Use adapter to normalize SDK events into NormalizedMessage[]
      const normalized = context.normalizeMessage(transformedMessage, sid);
      const streamedRow = streamKey ? normalized.find((msg) => msg.kind === 'text' && msg.role === 'assistant') : null;
      if (streamedRow) streamedRow.streamKey = streamKey;
      for (const msg of normalized) {
        // Preserve parentToolUseId from SDK wrapper for subagent tool grouping
        if (transformedMessage.parentToolUseId && !msg.parentToolUseId) {
          msg.parentToolUseId = transformedMessage.parentToolUseId;
        }
        ws.send(msg);
      }

      // Drive the ring from per-step assistant usage only. The terminal
      // `result` reports CUMULATIVE turn usage — cache reads summed across every
      // tool step — which can exceed the context window and flash the wheel red.
      // The last assistant step already carries current context size.
      if (message?.type !== 'result') {
        const tokenBudgetData = extractTokenBudget(
          message,
          getClaudeContextCeiling(capturedSessionId || sessionId),
        );
        if (tokenBudgetData) {
          ws.send(createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget: tokenBudgetData, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        }
      }

      armBackgroundHold();
    }

    // Clean up session on completion
    clearBackgroundHold();
    textStream.close();
    inputChannel?.close();
    claimMintedTranscript();
    if (sessionKey()) {
      removeSession(sessionKey());
    }

    // Send the terminal completion event — skipped for aborted runs, whose
    // terminal `complete` (aborted: true) was already sent by abort-session.
    const wasAborted = wasRunAborted();
    logTurn('end', sessionKey(), {
      ms: sinceStart(),
      frames,
      retries,
      thinking_estimate: thinkingEstimate || undefined,
      aborted: wasAborted ? 'yes' : undefined,
      dropped: formatDroppedFrames(droppedFrames),
    });
    if (!wasAborted) {
      ws.send(createCompleteMessage({ provider: 'claude', sessionId: capturedSessionId || sessionId || null, exitCode: 0 }));
    }
    notifyRunStopped({
      userId: ws?.userId || null,
      provider: 'claude',
      sessionId: sessionId || capturedSessionId || null,
      sessionName: sessionSummary,
      stopReason: wasAborted ? 'aborted' : 'completed'
    });
    // Complete

  } catch (error) {
    textStream?.close();
    // Asked once: the first call clears the abort record.
    const aborted = wasRunAborted();
    logTurn('failed', sessionKey(), {
      ms: sinceStart(),
      frames,
      retries,
      thinking_estimate: thinkingEstimate || undefined,
      aborted: aborted ? 'yes' : undefined,
      dropped: formatDroppedFrames(droppedFrames),
      class: error?.errorClass,
      detail: typeof error?.message === 'string' ? error.message : undefined,
    });
    // An aborted run throws by design and its stack says nothing; a real failure
    // keeps its stack.
    if (!aborted) {
      console.error('SDK query error:', error);
    }

    // Clean up session on error
    clearBackgroundHold();
    inputChannel?.close();
    claimMintedTranscript();
    if (sessionKey()) {
      removeSession(sessionKey());
    }

    if (aborted) {
      // The abort already produced the terminal complete; a generator throw
      // caused by interrupt() or an aborted signal is expected noise, not a
      // user-facing error.
      return;
    }

    // Check if Claude CLI is installed for a clearer error message
    const installed = await context.isProviderInstalled();
    const errorContent = !installed
      ? 'Claude Code is not installed. Please install it first: https://docs.anthropic.com/en/docs/claude-code'
      : error.message;

    // Send error to WebSocket, then the terminal complete
    if (!duplicatesStreamedNotice(noticeStreamed, error)) {
      ws.send(createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
    }
    ws.send(createCompleteMessage({ provider: 'claude', sessionId: capturedSessionId || sessionId || null, exitCode: 1 }));
    notifyRunFailed({
      userId: ws?.userId || null,
      provider: 'claude',
      sessionId: sessionId || capturedSessionId || null,
      sessionName: sessionSummary,
      error
    });
  }
}

/**
 * Adds user text to the session's running turn. False once the run's input has
 * closed — the caller keeps the message queued for the next turn.
 * @param {string} sessionId - App session id
 * @param {string} content - Text to deliver
 * @returns {boolean} Whether the turn accepted it
 */
function steerClaudeSDKSession(sessionId, content) {
  const text = typeof content === 'string' ? content.trim() : '';
  const session = getSession(sessionId);
  if (!text || !session || session.status !== 'active' || !session.input) {
    return false;
  }
  return session.input.push(text);
}

/**
 * Aborts an active SDK session
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session was aborted, false if not found
 */
async function abortClaudeSDKSession(sessionId) {
  const session = getSession(sessionId);

  if (!session) {
    console.log(`Session ${sessionId} not found`);
    return false;
  }

  try {
    console.log(`Aborting SDK session: ${sessionId}`);

    // Mark before interrupting so the run loop knows not to emit its own
    // terminal complete (the abort handler sends the aborted one).
    abortedSessionIds.add(sessionId);

    // Call interrupt() on the query instance
    await session.instance.interrupt();

    // Update session status
    session.status = 'aborted';
    session.input?.close();

    // Clean up session
    removeSession(sessionId);

    return true;
  } catch (error) {
    console.error(`Error aborting session ${sessionId}:`, error);
    // The run keeps going; let it emit its own terminal complete.
    abortedSessionIds.delete(sessionId);
    return false;
  }
}

/**
 * Moves a turn's own permission bookkeeping to a new mode: `canUseTool` reads
 * the mode, and plan's extra auto-allowed tools come and go with it.
 */
function setTurnPermissionMode(turn, mode) {
  const { sdkOptions } = turn;
  if (mode === 'plan' && sdkOptions.permissionMode !== 'plan') {
    turn.planToolsAdded = PLAN_MODE_TOOLS.filter((tool) => !sdkOptions.allowedTools.includes(tool));
    sdkOptions.allowedTools.push(...turn.planToolsAdded);
  } else if (mode !== 'plan' && sdkOptions.permissionMode === 'plan') {
    sdkOptions.allowedTools = sdkOptions.allowedTools.filter((tool) => !turn.planToolsAdded.includes(tool));
    turn.planToolsAdded = [];
  }
  sdkOptions.permissionMode = mode;
}

/**
 * The effort to apply live, or undefined to leave it for the next send.
 * "default" is resolved to the model's own setting (ADR 0063): clearing it
 * through the flag layer would run the model's built-in default instead. `max`
 * is session-only in Claude Code, so the flag layer cannot carry it.
 */
function resolveLiveEffort(model, effort, models) {
  const option = models?.OPTIONS?.find((candidate) => candidate.value === model) || null;
  const level = effort === 'default'
    ? option?.effort?.resolvedDefault
    : resolveClaudeEffort(model, effort, models);
  return CLAUDE_PERSISTABLE_EFFORT_LEVELS.includes(level) ? level : undefined;
}

/**
 * Applies composer changes to the session's running turn. The session row's
 * picks (ADR 0025) are written by the composer's own requests; this changes
 * only what the live process runs with.
 * @param {string} sessionId - App session id
 * @param {import('@/shared/types.js').ChatControlChanges} changes
 * @returns {Promise<import('@/shared/types.js').ChatControlResult|null>} Null when no turn is live
 */
async function controlClaudeSDKSession(sessionId, changes) {
  const session = getSession(sessionId);
  if (!session || session.status !== 'active' || !session.turn) {
    return null;
  }
  const { instance, turn } = session;
  const { sdkOptions, effortModels } = turn;
  /** @type {import('@/shared/types.js').ChatControlKey[]} */
  const applied = [];
  const attempt = async (key, apply) => {
    try {
      await apply();
      applied.push(key);
    } catch (error) {
      console.warn(`[Claude SDK] Live ${key} change failed:`, error?.message || error);
    }
  };

  if (changes.permissionMode) {
    await attempt('permissionMode', async () => {
      await instance.setPermissionMode(changes.permissionMode);
      setTurnPermissionMode(turn, changes.permissionMode);
    });
  }
  // Never `setModel(undefined)`: that is Claude Code's fallback, not the picker's default.
  const model = changes.model === 'default' ? effortModels?.DEFAULT : changes.model;
  if (model) {
    await attempt('model', async () => {
      await instance.setModel(model);
      sdkOptions.model = model;
    });
  }
  // After the model, so "default" resolves against the model now running.
  const effort = changes.effort
    ? resolveLiveEffort(sdkOptions.model || effortModels?.DEFAULT, changes.effort, effortModels)
    : undefined;
  if (effort) {
    await attempt('effort', async () => {
      await instance.applyFlagSettings({ effortLevel: effort });
      sdkOptions.effort = effort;
    });
  }
  if (typeof changes.fastMode === 'boolean') {
    await attempt('fastMode', async () => {
      await instance.applyFlagSettings({ fastMode: changes.fastMode });
      sdkOptions.settings = { ...sdkOptions.settings, fastMode: changes.fastMode };
    });
  }

  logTurn('control', sessionId, {
    applied: applied.join(',') || 'none',
    mode: applied.includes('permissionMode') ? sdkOptions.permissionMode : undefined,
    model: applied.includes('model') ? sdkOptions.model : undefined,
    effort: applied.includes('effort') ? sdkOptions.effort : undefined,
  });
  return { applied };
}

const SIDE_QUESTION_UNAVAILABLE = 'Side questions are unavailable on this Claude version.';

/**
 * Answers one question beside a session: no transcript row, no queued turn, and
 * a run already in flight keeps going.
 *
 * A live run already owns a query, so the question rides it and reuses its
 * prompt cache. Idle sessions get a query resumed on the transcript whose prompt
 * stream never yields, so the SDK loads the conversation and runs no turn.
 *
 * @param {string} sessionId - App session id
 * @param {{ question: string, cwd?: string|null, signal?: AbortSignal }} request
 * @param {Object} context - Provider runtime context
 * @returns {Promise<{ answer: string, fallbackNotice?: string|null, synthetic?: boolean }>}
 */
async function askClaudeSideQuestion(sessionId, request, context) {
  const question = typeof request?.question === 'string' ? request.question.trim() : '';
  if (!question) {
    throw new Error('A side question needs a question.');
  }

  const live = getSession(sessionId);
  if (live?.instance) {
    return runSideQuestion(live.instance, question, request?.signal, request?.history);
  }

  const providerSessionId = context.resolveProviderSessionId(sessionId);
  if (!providerSessionId) {
    throw new Error('This session has nothing to ask about yet.');
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  request?.signal?.addEventListener('abort', onAbort, { once: true });

  // A prompt stream that never yields: the SDK loads the resumed transcript and
  // waits, so the side question is the only thing that reaches the model.
  const idlePrompt = (async function* () {
    await new Promise((resolve) => {
      controller.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  })();

  const queryInstance = query({
    prompt: idlePrompt,
    options: {
      env: { ...process.env },
      pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH),
      ...(request?.cwd ? { cwd: request.cwd } : {}),
      resume: providerSessionId,
      allowedTools: [],
      abortController: controller,
    },
  });

  try {
    return await runSideQuestion(queryInstance, question, request?.signal, request?.history);
  } finally {
    request?.signal?.removeEventListener('abort', onAbort);
    controller.abort();
  }
}

/**
 * Asks one question of a query instance and shapes the SDK's answer.
 *
 * `askSideQuestion` is absent from the SDK's published types, so an upgrade can
 * remove it without a type error; report that rather than failing the chat.
 */
async function runSideQuestion(queryInstance, question, signal, history = []) {
  if (typeof queryInstance.askSideQuestion !== 'function') {
    throw new Error(SIDE_QUESTION_UNAVAILABLE);
  }

  // Wire shape read from the CLI binary (2.1.270): snake_case `fallback_notice`.
  const earlier = (history || []).map((exchange) => ({
    question: exchange.question,
    response: exchange.response,
    ...(exchange.fallbackNotice ? { fallback_notice: exchange.fallbackNotice } : {}),
  }));
  const result = await queryInstance.askSideQuestion(question, {
    ...(signal ? { signal } : {}),
    ...(earlier.length ? { history: earlier } : {}),
  });
  const answer = typeof result?.response === 'string' ? result.response.trim() : '';
  if (!answer) {
    throw new Error('Claude returned no answer to that side question.');
  }

  const fallback = result?.refusalFallback;
  return {
    answer,
    synthetic: result?.synthetic === true,
    fallbackNotice: fallback?.fallbackModel
      ? `Answered by ${fallback.fallbackModel} instead of ${fallback.originalModel}.`
      : null,
  };
}

/**
 * Checks if an SDK session is currently active
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session is active
 */
function isClaudeSDKSessionActive(sessionId) {
  const session = getSession(sessionId);
  return session && session.status === 'active';
}

/**
 * Gets all active SDK session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getActiveClaudeSDKSessions() {
  return getAllSessions();
}

/**
 * Get pending tool approvals for a specific session.
 * @param {string} sessionId - The session ID
 * @returns {Array} Array of pending permission request objects
 */
function getPendingApprovalsForSession(sessionId) {
  // Provider-scoped: the registry is shared and the gateway asks every runtime
  // in turn. Without the filter, one pending prompt is replayed once per runtime
  // on `chat.subscribe`.
  return interactiveRequestRegistry.getPendingForSession(sessionId, 'claude');
}

/**
 * Reconnect a session's WebSocketWriter to a new raw WebSocket.
 * Called when client reconnects (e.g. page refresh) while SDK is still running.
 * @param {string} sessionId - The session ID
 * @param {Object} newRawWs - The new raw WebSocket connection
 * @returns {boolean} True if writer was successfully reconnected
 */
function reconnectSessionWriter(sessionId, newRawWs) {
  const session = getSession(sessionId);
  if (!session?.writer?.updateWebSocket) return false;
  session.writer.updateWebSocket(newRawWs);
  console.log(`[RECONNECT] Writer swapped for session ${sessionId}`);
  return true;
}

/**
 * Manual counterpart to the interval re-capture above, for the /context modal's
 * refresh button. Same mid-turn-only constraint: it asks the live query
 * instance, so it returns null when no turn is streaming.
 * @param {string} sessionId - App session id, which keys the live query
 * @param {string} providerSessionId - Claude's own id, which keys the cached reading
 * @returns {Promise<Object|null>} Fresh ceiling, or null if no live query
 */
async function refreshClaudeContextUsage(sessionId, providerSessionId) {
  const session = getSession(sessionId);
  if (!session?.instance) {
    return null;
  }
  return captureClaudeContextUsage(providerSessionId, session.instance);
}

// `resolveToolApproval`/`getPendingApprovalsForSession` wrap the interactive-
// request registry, which also carries AskUserQuestion — the permission surface
// resolves against the registry, not a tool-approval-only channel.
export const claudeRuntime = {
  run: queryClaudeSDK,
  abort: abortClaudeSDKSession,
  steer: steerClaudeSDKSession,
  control: controlClaudeSDKSession,
  askSideQuestion: askClaudeSideQuestion,
  permissions: {
    resolve: resolveToolApproval,
    listPending: getPendingApprovalsForSession,
  },
};

// Export public API
export {
  queryClaudeSDK,
  abortClaudeSDKSession,
  steerClaudeSDKSession,
  controlClaudeSDKSession,
  askClaudeSideQuestion,
  runSideQuestion,
  isClaudeSDKSessionActive,
  getActiveClaudeSDKSessions,
  resolveToolApproval,
  getPendingApprovalsForSession,
  reconnectSessionWriter,
  refreshClaudeContextUsage,
  duplicatesStreamedNotice,
  formatTurnLog,
  recordDroppedFrame,
  formatDroppedFrames,
  createTurnTokenCounter
};
