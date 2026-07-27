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

import { buildClaudeUserContent, normalizeImageDescriptors } from './shared/image-attachments.js';
import { readClaudeContextWindowOverride, resolveClaudeContextCeiling } from './modules/providers/list/claude/claude-context-window.js';
import { captureClaudeContextUsage, getClaudeContextCeiling } from './modules/providers/list/claude/claude-context-usage.js';
import { CLAUDE_FALLBACK_MODELS } from './modules/providers/list/claude/claude-models.provider.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { resolveClaudeCodeExecutablePath } from './shared/claude-cli-path.js';
import {
  createNotificationEvent,
  notifyRunFailed,
  notifyRunStopped,
  notifyUserIfEnabled
} from './services/notification-orchestrator.js';
import {
  computeResumeAnchor,
  extractBaseTranscriptUuid,
  readTranscriptEntries,
} from './modules/providers/list/claude/claude-rewind.util.js';
import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { interactiveRequestRegistry } from './modules/providers/services/interactive-request-registry.service.js';
import { createCompleteMessage, createNormalizedMessage } from './shared/utils.js';

const activeSessions = new Map();
// Sessions cancelled via abort-session. The abort handler already sent the
// terminal `complete` (aborted: true) to the client, so the run loop must not
// emit a second one when its generator winds down.
const abortedSessionIds = new Set();

const TOOL_APPROVAL_TIMEOUT_MS = parseInt(process.env.CLAUDE_TOOL_APPROVAL_TIMEOUT_MS, 10) || 55000;

const TOOLS_REQUIRING_INTERACTION = new Set(['AskUserQuestion', 'ExitPlanMode']);

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
  const { sessionId, cwd, toolsSettings, permissionMode, effort } = options;

  const sdkOptions = {};

  // Forward all host env vars (e.g. ANTHROPIC_BASE_URL) to the subprocess.
  // Since SDK 0.2.113, options.env replaces process.env instead of overlaying it.
  sdkOptions.env = { ...process.env };

  // Resolve the executable eagerly on Windows because the SDK uses raw child_process.spawn,
  // which does not reliably follow npm's shell wrappers like cross-spawn does.
  sdkOptions.pathToClaudeCodeExecutable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);

  if (cwd) {
    sdkOptions.cwd = cwd;
  }

  if (permissionMode && permissionMode !== 'default') {
    sdkOptions.permissionMode = permissionMode;
  }

  const settings = toolsSettings || {
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false
  };

  if (settings.skipPermissions && permissionMode !== 'plan') {
    sdkOptions.permissionMode = 'bypassPermissions';
  }

  let allowedTools = [...(settings.allowedTools || [])];

  if (permissionMode === 'plan') {
    const planModeTools = ['Read', 'Task', 'exit_plan_mode', 'TodoRead', 'TodoWrite', 'WebFetch', 'WebSearch'];
    for (const tool of planModeTools) {
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

  sdkOptions.model = options.model || CLAUDE_FALLBACK_MODELS.DEFAULT;

  const resolvedEffort = resolveClaudeEffort(
    sdkOptions.model,
    effort,
    options.effortModels || CLAUDE_FALLBACK_MODELS,
  );
  if (resolvedEffort) {
    sdkOptions.effort = resolvedEffort;
  }

  sdkOptions.systemPrompt = {
    type: 'preset',
    preset: 'claude_code'
  };

  sdkOptions.settingSources = ['project', 'user', 'local'];

  // Ephemeral runs (e.g. the Source Control commit-message generator) opt out
  // of transcript persistence: without this the SDK writes a jsonl into
  // ~/.claude/projects/ and the session watcher surfaces the one-shot query as
  // a real session in the project's sidebar.
  if (options.persistSession === false) {
    sdkOptions.persistSession = false;
  }

  // Snapshot files before edits (file-history-snapshot/-delta rows in the
  // session jsonl) so a future file-restore rewind has checkpoints to work
  // with. Conversation-only rewind does not depend on this. Pointless without
  // a transcript to write the snapshots into.
  if (process.env.CLIDE_DISABLE_CHECKPOINTS !== '1' && options.persistSession !== false) {
    sdkOptions.enableFileCheckpointing = true;
  }

  if (sessionId) {
    sdkOptions.resume = sessionId;
  }

  if (sessionId && options.resumeSessionAt) {
    // Rewind: resume only up to (and including) this assistant-message uuid.
    // Verified 2026-07-22 (scripts/verify-rewind-sdk.ts): the SDK keeps the
    // same session id and APPENDS the new turn with parentUuid set to the
    // anchor — the transcript becomes a tree and readers must follow the
    // active parent chain.
    sdkOptions.resumeSessionAt = options.resumeSessionAt;
  }

  return sdkOptions;
}

/**
 * Adds a session to the active sessions map
 * @param {string} sessionId - Session identifier
 * @param {Object} queryInstance - SDK query instance
 * @param {Object} writer - WebSocket writer for reconnect support
 */
function addSession(sessionId, queryInstance, writer = null) {
  activeSessions.set(sessionId, {
    instance: queryInstance,
    startTime: Date.now(),
    status: 'active',
    writer
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
  // Extract parent_tool_use_id for subagent tool grouping
  if (sdkMessage.parent_tool_use_id) {
    return {
      ...sdkMessage,
      parentToolUseId: sdkMessage.parent_tool_use_id
    };
  }
  return sdkMessage;
}

function readNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Picks the ring's denominator for one frame.
 *
 * Order is deliberate: the `CONTEXT_WINDOW` env override is the operator escape
 * hatch and outranks everything; then the SDK's own `maxTokens`, which the
 * session reported about itself; then the derived fallback, used until the
 * mid-turn control request lands (~1s into the first turn) and forever on CLIs
 * that do not answer it.
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

  const messageUsage = sdkMessage.message?.usage || sdkMessage.usage;
  if (messageUsage && typeof messageUsage === 'object') {
    const directInputTokens = readNumber(messageUsage.input_tokens ?? messageUsage.inputTokens);
    const cacheCreationTokens = readNumber(messageUsage.cache_creation_input_tokens ?? messageUsage.cacheCreationInputTokens ?? messageUsage.cacheCreationTokens);
    const cacheReadTokens = readNumber(messageUsage.cache_read_input_tokens ?? messageUsage.cacheReadInputTokens ?? messageUsage.cacheReadTokens);
    const cacheTokens = cacheCreationTokens + cacheReadTokens;
    const inputTokens = directInputTokens + cacheTokens;
    const outputTokens = readNumber(messageUsage.output_tokens ?? messageUsage.outputTokens);
    const totalUsed = inputTokens + outputTokens;
    // Assistant frames name the model that produced this usage, so the derived
    // fallback still tracks the session's real model when the SDK reading has
    // not landed yet.
    const contextWindow = pickContextWindow(ceiling, {
      model: sdkMessage.message?.model ?? sdkMessage.model,
    });

    // Claude Code streams locally-fabricated assistant messages (session-limit
    // notices, API-error placeholders, "No response requested.") with an
    // all-zero usage object. Emitting that as a token_budget frame would reset
    // the composer's context ring to empty when a session ends on a usage
    // limit, so skip rows with no real input and keep the last real reading.
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
      // Undefined until the SDK reading lands; the client treats a missing
      // threshold as "no auto-compact marker", not as zero.
      autoCompactThreshold: ceiling?.autoCompactThreshold,
      isAutoCompactEnabled: ceiling?.isAutoCompactEnabled,
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
  // SDK `ModelUsage` entries carry the model's own contextWindow, which
  // outranks the local registry table — a model newer than that table still
  // resolves correctly here.
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
    breakdown: {
      input: inputTokens,
      output: outputTokens,
    },
  };
}

/**
 * Builds the SDK `prompt` payload for one turn.
 *
 * Plain text turns pass the string through unchanged. Turns with image
 * attachments use the SDK's streaming-input mode: a single SDKUserMessage
 * whose content carries the prompt text plus one base64 `image` block per
 * attachment (read from the global `~/.cloudcli/assets` folder).
 *
 * @param {string} command - User prompt
 * @param {Array} images - Image descriptors ({ path, name?, mimeType? })
 * @param {string} cwd - Project working directory image paths resolve against
 * @returns {Promise<string|AsyncIterable>} SDK prompt payload
 */
async function buildPromptPayload(command, images, cwd) {
  if (normalizeImageDescriptors(images).length === 0) {
    return command;
  }

  const content = await buildClaudeUserContent(command, images, cwd);
  return (async function* () {
    yield {
      type: 'user',
      message: {
        role: 'user',
        content
      },
      parent_tool_use_id: null,
      timestamp: new Date().toISOString()
    };
  })();
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
  const encodedCwd = String(options.cwd).replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', encodedCwd, `${providerSessionId}.jsonl`);
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
 * @returns {Promise<void>}
 */
async function queryClaudeSDK(command, options = {}, ws) {
  const { sessionId, sessionSummary } = options;
  let capturedSessionId = sessionId;
  let sessionCreatedSent = false;

  // Conversation rewind: translate the edited message uuid into the resume
  // shape before option mapping. A fresh start behaves like a brand-new
  // session — the writer remaps the announced provider id onto the app
  // session, so the client never notices the id change.
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

  const emitNotification = (event) => {
    notifyUserIfEnabled({
      userId: ws?.userId || null,
      writer: ws,
      event
    });
  };

  try {
    const resolvedModel = await providerModelsService.resolveResumeModel(
      'claude',
      sessionId,
      options.model,
    );
    let effortModels = CLAUDE_FALLBACK_MODELS;
    try {
      effortModels = (await providerModelsService.getProviderModels('claude')).models;
    } catch (error) {
      console.warn('[Claude SDK] Unable to load provider models for effort validation:', error);
    }

    const sdkOptions = mapCliOptionsToSDK({
      ...options,
      // Editing the first message has nothing to resume: start fresh and let
      // the announced id be remapped onto the app session.
      sessionId: rewindPlan?.freshStart ? null : sessionId,
      resumeSessionAt: rewindPlan?.resumeSessionAt,
      model: resolvedModel || options.model,
      effortModels,
    });

    const mcpServers = await loadMcpConfig(options.cwd);
    if (mcpServers) {
      sdkOptions.mcpServers = mcpServers;
    }

    // Turns with image attachments switch to streaming input so the images
    // ride along as real content blocks. Built per query attempt because an
    // async generator cannot be replayed once consumed.
    const createPrompt = () => buildPromptPayload(command, options.images, options.cwd);

    sdkOptions.hooks = {
      Notification: [{
        matcher: '',
        hooks: [async (input) => {
          const message = typeof input?.message === 'string' ? input.message : 'Claude requires your attention.';
          emitNotification(createNotificationEvent({
            provider: 'claude',
            sessionId: capturedSessionId || sessionId || null,
            kind: 'action_required',
            code: 'agent.notification',
            meta: { message, sessionName: sessionSummary },
            severity: 'warning',
            requiresUserAction: true,
            dedupeKey: `claude:hook:notification:${capturedSessionId || sessionId || 'none'}:${message}`
          }));
          return {};
        }]
      }]
    };

    // Caveat: in 'auto' and 'bypassPermissions' modes the SDK resolves approval
    // at the permission-mode step and skips this callback, so interactive tools
    // (AskUserQuestion, ExitPlanMode) won't reach the UI — the classifier/bypass
    // auto-approves them and the model acts on a generated answer. Move these
    // tools to a PreToolUse hook (runs before the mode check) if we need them
    // to work in those modes.
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
      // message with the answer as soon as the user submits it, instead of
      // waiting on the full round trip to the SDK's own tool_result.
      ws.send(createNormalizedMessage({ kind: 'permission_request', requestId, toolName, input, toolId: context?.toolUseID, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
      emitNotification(createNotificationEvent({
        provider: 'claude',
        sessionId: capturedSessionId || sessionId || null,
        kind: 'action_required',
        code: 'permission.required',
        meta: { toolName, sessionName: sessionSummary },
        severity: 'warning',
        requiresUserAction: true,
        dedupeKey: `claude:permission:${capturedSessionId || sessionId || 'none'}:${requestId}`
      }));

      const decision = await waitForToolApproval(requestId, {
        timeoutMs: requiresInteraction ? 0 : undefined,
        signal: context?.signal,
        metadata: {
          _sessionId: capturedSessionId || sessionId || null,
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

    // Query constructor reads this synchronously.
    const prevStreamTimeout = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000';

    let queryInstance;
    try {
      queryInstance = query({
        prompt: await createPrompt(),
        options: sdkOptions
      });
    } catch (hookError) {
      // Older/newer SDK versions may not accept hook shapes yet.
      // Keep notification behavior operational via runtime events even if hook registration fails.
      console.warn('Failed to initialize Claude query with hooks, retrying without hooks:', hookError?.message || hookError);
      delete sdkOptions.hooks;
      queryInstance = query({
        prompt: await createPrompt(),
        options: sdkOptions
      });
    }

    // Restore immediately — Query constructor already captured the value
    if (prevStreamTimeout !== undefined) {
      process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = prevStreamTimeout;
    } else {
      delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    }

    // Track the query instance for abort capability
    if (capturedSessionId) {
      addSession(capturedSessionId, queryInstance, ws);
    }

    // Process streaming messages
    console.log('Starting async generator loop for session:', capturedSessionId || 'NEW');
    let contextUsageRequested = false;
    for await (const message of queryInstance) {
      // Capture session ID from first message
      if (message.session_id && !capturedSessionId) {

        capturedSessionId = message.session_id;
        addSession(capturedSessionId, queryInstance, ws);

        // Set session ID on writer
        if (ws.setSessionId && typeof ws.setSessionId === 'function') {
          ws.setSessionId(capturedSessionId);
        }

        // Send session-created event only once for new sessions
        if (!sessionId && !sessionCreatedSent) {
          sessionCreatedSent = true;
          ws.send(createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'claude' }));
        }
      } else if (message.session_id && capturedSessionId && message.session_id !== capturedSessionId) {
        // Defensive: the SDK announced a different session id on a resumed
        // query (e.g. a forked resume). Re-key abort tracking and let the
        // writer remap the provider id onto the stable app session id.
        removeSession(capturedSessionId);
        capturedSessionId = message.session_id;
        addSession(capturedSessionId, queryInstance, ws);
        if (ws.setSessionId && typeof ws.setSessionId === 'function') {
          ws.setSessionId(capturedSessionId);
        }
      }

      // Ask the SDK what this session's real context ceiling and auto-compact
      // threshold are. It only answers while a turn is streaming — at the
      // terminal `result` the transport is already closing — and the round trip
      // costs ~1s, so fire it once per turn and never await it here: blocking
      // the loop would stall every frame behind it. Frames that stream before
      // it lands use the derived fallback, and the answer is cached for the
      // rest of this turn, for later turns, and for /token-usage.
      if (!contextUsageRequested && capturedSessionId) {
        contextUsageRequested = true;
        void captureClaudeContextUsage(capturedSessionId, queryInstance);
      }

      // Transform and normalize message via adapter
      const transformedMessage = transformMessage(message);
      const sid = capturedSessionId || sessionId || null;

      // Use adapter to normalize SDK events into NormalizedMessage[]
      const normalized = sessionsService.normalizeMessage('claude', transformedMessage, sid);
      for (const msg of normalized) {
        // Preserve parentToolUseId from SDK wrapper for subagent tool grouping
        if (transformedMessage.parentToolUseId && !msg.parentToolUseId) {
          msg.parentToolUseId = transformedMessage.parentToolUseId;
        }
        ws.send(msg);
      }

      // Drive the composer's context-usage wheel from per-step assistant usage
      // only. The terminal `result` message reports CUMULATIVE usage for the
      // whole turn — summing cache reads across every tool step — which can far
      // exceed the context window and briefly flashes the wheel red before the
      // next turn corrects it. The wheel wants current context size, which the
      // last assistant step already carries, so skip the cumulative summary.
      if (message?.type !== 'result') {
        const tokenBudgetData = extractTokenBudget(
          message,
          getClaudeContextCeiling(capturedSessionId || sessionId),
        );
        if (tokenBudgetData) {
          ws.send(createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget: tokenBudgetData, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        }
      }
    }

    // Clean up session on completion
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    // Send the terminal completion event — skipped for aborted runs, whose
    // terminal `complete` (aborted: true) was already sent by abort-session.
    const wasAborted = capturedSessionId ? abortedSessionIds.delete(capturedSessionId) : false;
    if (!wasAborted) {
      ws.send(createCompleteMessage({ provider: 'claude', sessionId: capturedSessionId || sessionId || null, exitCode: 0 }));
    }
    notifyRunStopped({
      userId: ws?.userId || null,
      provider: 'claude',
      sessionId: capturedSessionId || sessionId || null,
      sessionName: sessionSummary,
      stopReason: wasAborted ? 'aborted' : 'completed'
    });
    // Complete

  } catch (error) {
    console.error('SDK query error:', error);

    // Clean up session on error
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    const wasAborted = capturedSessionId ? abortedSessionIds.delete(capturedSessionId) : false;
    if (wasAborted) {
      // The abort already produced the terminal complete; a generator throw
      // caused by interrupt() is expected noise, not a user-facing error.
      return;
    }

    // Check if Claude CLI is installed for a clearer error message
    const installed = await providerAuthService.isProviderInstalled('claude');
    const errorContent = !installed
      ? 'Claude Code is not installed. Please install it first: https://docs.anthropic.com/en/docs/claude-code'
      : error.message;

    // Send error to WebSocket, then the terminal complete
    ws.send(createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
    ws.send(createCompleteMessage({ provider: 'claude', sessionId: capturedSessionId || sessionId || null, exitCode: 1 }));
    notifyRunFailed({
      userId: ws?.userId || null,
      provider: 'claude',
      sessionId: capturedSessionId || sessionId || null,
      sessionName: sessionSummary,
      error
    });
  }
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
  return interactiveRequestRegistry.getPendingForSession(sessionId);
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

// Export public API
export {
  queryClaudeSDK,
  abortClaudeSDKSession,
  isClaudeSDKSessionActive,
  getActiveClaudeSDKSessions,
  resolveToolApproval,
  getPendingApprovalsForSession,
  reconnectSessionWriter
};
