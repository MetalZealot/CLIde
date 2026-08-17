import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

/**
 * Records the (SDK, runtime) version pair Chat is actually running.
 *
 * Both halves are deliberately unpinned and move independently: the SDK only
 * when `package.json` is bumped, the `claude` on PATH whenever it self-updates.
 * A runtime that moved underneath a working session is otherwise invisible —
 * inferred from changed behaviour rather than observed — so the pair is written
 * whenever it changes and the move is logged once.
 */

const moduleRequire = createRequire(import.meta.url);

const DEFAULT_STORE_PATH = path.join(os.homedir(), '.cloudcli', 'claude-version-pair.json');

export type ClaudeVersionPair = {
  /** Installed `@anthropic-ai/claude-agent-sdk`, i.e. the control-protocol client. */
  sdk: string | null;
  /** The `claude` binary CLIde spawns, which is never the SDK's bundled fallback. */
  runtime: string | null;
};

export type ClaudeVersionPairRecord = ClaudeVersionPair & {
  observedAt: string;
  /** The pair this one replaced; absent until something moves. */
  previous?: ClaudeVersionPair & { observedAt: string };
};

/** Pulls the version out of `claude --version` ("2.1.233 (Claude Code)"). */
export function parseClaudeRuntimeVersion(output: string): string | null {
  return output.match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/)?.[0] ?? null;
}

export function readClaudeSdkVersion(): string | null {
  try {
    // The package exports neither ./package.json nor ./sdk.mjs, so resolve the
    // main entry and read the manifest beside it.
    const manifest = path.join(path.dirname(moduleRequire.resolve('@anthropic-ai/claude-agent-sdk')), 'package.json');
    const version = JSON.parse(readFileSync(manifest, 'utf8')).version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

const readRecord = (storePath: string): ClaudeVersionPairRecord | null => {
  try {
    const parsed = JSON.parse(readFileSync(storePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as ClaudeVersionPairRecord) : null;
  } catch {
    return null;
  }
};

/** One line naming which half moved, or null when the pair is unchanged. */
export function describeClaudeVersionDrift(
  previous: ClaudeVersionPair,
  current: ClaudeVersionPair,
): string | null {
  const moved: string[] = [];
  if (previous.runtime !== current.runtime) {
    moved.push(`Claude Code runtime ${previous.runtime ?? 'unknown'} -> ${current.runtime ?? 'unknown'}`);
  }
  if (previous.sdk !== current.sdk) {
    moved.push(`Agent SDK ${previous.sdk ?? 'unknown'} -> ${current.sdk ?? 'unknown'}`);
  }
  return moved.length > 0 ? moved.join('; ') : null;
}

/**
 * Persists the pair when it differs from the stored one. Unchanged pairs are
 * not rewritten, so this stays cheap on the auth-status path that calls it.
 */
export function recordClaudeVersionPair(
  pair: ClaudeVersionPair,
  storePath: string = DEFAULT_STORE_PATH,
): { record: ClaudeVersionPairRecord; drift: string | null } {
  const stored = readRecord(storePath);
  const drift = stored ? describeClaudeVersionDrift(stored, pair) : null;

  if (stored && !drift) {
    return { record: stored, drift: null };
  }

  const record: ClaudeVersionPairRecord = {
    ...pair,
    observedAt: new Date().toISOString(),
    ...(stored && drift
      ? { previous: { sdk: stored.sdk, runtime: stored.runtime, observedAt: stored.observedAt } }
      : {}),
  };

  try {
    if (!existsSync(path.dirname(storePath))) {
      mkdirSync(path.dirname(storePath), { recursive: true });
    }
    writeFileSync(storePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.warn('Unable to persist the Claude version pair:', error);
  }

  return { record, drift };
}

/** Records the pair implied by a `claude --version` result and logs any move. */
export function observeClaudeVersionPair(
  versionOutput: string,
  storePath: string = DEFAULT_STORE_PATH,
): ClaudeVersionPairRecord {
  const { record, drift } = recordClaudeVersionPair(
    { sdk: readClaudeSdkVersion(), runtime: parseClaudeRuntimeVersion(versionOutput) },
    storePath,
  );
  if (drift) {
    console.warn(`[Claude] version pair moved: ${drift}`);
  }
  return record;
}
