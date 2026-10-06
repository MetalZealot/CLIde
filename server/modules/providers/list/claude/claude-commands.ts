import os from 'node:os';

import { query, type SlashCommand } from '@anthropic-ai/claude-agent-sdk';

import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { ProviderCommand } from '@/shared/types.js';

/** The CLI answers from its `initialize` reply, ~4.5 s after spawn (measured 2026-10-05). */
const CLAUDE_CLI_COMMANDS_TIMEOUT_MS = 20_000;

/** `init.terminal_slash_commands` at CLI 2.1.286, for before any chat has reported its own. */
const TERMINAL_COMMANDS_FALLBACK = ['doctor', 'color', 'focus', 'reload-plugins'];

/**
 * Commands no web client should offer: internal or retired rows, and ones that
 * change state CLIde tracks itself (its composer controls, the session's
 * identity and title) before CLIde reads those changes back.
 */
const HIDDEN_COMMANDS = new Set([
  '__remote-workflow', 'workflow-launch-exec', 'extra-usage', 'agents', 'heapdump',
  'model', 'effort', 'fast', 'clear', 'rename',
]);

let terminalCommands: string[] | null = null;

/**
 * Records the CLI's own list of terminal-bound commands, which arrives only on a
 * chat's `init` frame. Called by the Claude runtime; the slash menu hides them.
 */
export function rememberClaudeTerminalCommands(names: unknown): void {
  if (Array.isArray(names) && names.every((name) => typeof name === 'string')) {
    terminalCommands = names;
  }
}

/**
 * Maps the CLI's command rows onto menu rows, hiding what a web client cannot
 * run. When a builtin and a user row share a name, the CLI runs the builtin.
 * Exported for the provider tests, which replay a recorded idle session.
 */
export function toProviderCommands(rows: SlashCommand[]): ProviderCommand[] {
  const hidden = new Set([...HIDDEN_COMMANDS, ...(terminalCommands ?? TERMINAL_COMMANDS_FALLBACK)]);
  const byName = new Map<string, ProviderCommand>();
  for (const row of rows) {
    const name = typeof row?.name === 'string' ? row.name.trim().replace(/^\//, '') : '';
    if (!name || hidden.has(name)) continue;
    const command: ProviderCommand = {
      name: `/${name}`,
      description: typeof row.description === 'string' ? row.description : '',
      argumentHint: typeof row.argumentHint === 'string' ? row.argumentHint : '',
      aliases: Array.isArray(row.aliases) ? row.aliases.map((alias) => `/${alias}`) : [],
      builtin: row.builtin === true,
    };
    const existing = byName.get(command.name);
    if (!existing || (command.builtin && !existing.builtin)) {
      byName.set(command.name, command);
    }
  }
  return [...byName.values()];
}

// One idle `claude` at a time: each holds ~230 MB while it starts.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Asks the installed CLI which commands a project offers, without starting a
 * conversation: the prompt never yields, so nothing reaches the model, and
 * `persistSession: false` keeps it out of the session list. Settings sources
 * load the project's and user's commands, skills and plugins; MCP servers stay
 * off so listing never starts one.
 */
export function listClaudeCliCommands(cwd?: string): Promise<ProviderCommand[]> {
  const run = async (): Promise<ProviderCommand[]> => {
    const controller = new AbortController();
    const idlePrompt = (async function* () {
      await new Promise<void>((resolve) => {
        controller.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    })();
    const queryInstance = query({
      prompt: idlePrompt,
      options: {
        env: { ...process.env },
        pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH),
        cwd: cwd || os.tmpdir(),
        persistSession: false,
        settingSources: ['project', 'user', 'local'],
        strictMcpConfig: true,
        mcpServers: {},
        allowedTools: [],
        abortController: controller,
      },
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('claude command list timed out')), CLAUDE_CLI_COMMANDS_TIMEOUT_MS);
    });
    try {
      return toProviderCommands(await Promise.race([queryInstance.supportedCommands(), timeout]));
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
