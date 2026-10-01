/**
 * The Claude Code settings cascade as a session in a given project would see
 * it, resolved by the SDK's own merge engine without spawning the CLI.
 *
 * Read-only. `resolveSettings()` is `@alpha`; this is the only caller, so an
 * SDK change to it breaks one screen and nothing that writes.
 */

import path from 'node:path';

import { resolveSettings } from '@anthropic-ai/claude-agent-sdk';

import {
  CLAUDE_SETTINGS_CATALOG,
  type ClaudeSettingTier,
} from '@/modules/providers/list/claude/claude-settings-catalog.js';

export type ClaudeSettingSource = 'user' | 'project' | 'local' | 'managed' | 'flag';

export type ClaudeCascadeEntry = {
  key: string;
  /** `unclassified` is a key the SDK resolved but the catalog has never seen. */
  tier: ClaudeSettingTier | 'unclassified';
  value: unknown;
  /** The source whose value won. */
  source: ClaudeSettingSource;
  path?: string;
  /** Every other source that also sets the key, low→high precedence. */
  alsoSetIn: ClaudeSettingSource[];
  /** The value was withheld; `value` lists names only. */
  redacted?: true;
};

export type ClaudeSettingsCascade = {
  /** The project resolved against, or null for user and managed only. */
  workspacePath: string | null;
  sources: { source: ClaudeSettingSource; path?: string; keyCount: number }[];
  entries: ClaudeCascadeEntry[];
};

/** `env` routinely carries API keys; only its variable names leave the server. */
const redact = (key: string, value: unknown): Pick<ClaudeCascadeEntry, 'value' | 'redacted'> => (
  key === 'env' && value && typeof value === 'object'
    ? { value: Object.keys(value).sort(), redacted: true }
    : { value }
);

export const readClaudeSettingsCascade = async (
  workspacePath: string | null,
): Promise<ClaudeSettingsCascade> => {
  // Without a project, project and local are skipped rather than resolved
  // against the server's own working directory.
  const resolved = await resolveSettings(workspacePath
    ? { cwd: path.resolve(workspacePath) }
    : { settingSources: ['user'] });

  const sources = resolved.sources.map(({ source, path: filePath, settings }) => ({
    source: source as ClaudeSettingSource,
    ...(filePath ? { path: filePath } : {}),
    keyCount: Object.keys(settings).length,
  }));

  const entries = Object.entries(resolved.effective as Record<string, unknown>)
    .map(([key, value]): ClaudeCascadeEntry => {
      const provenance = (resolved.provenance as Record<string, { source: string; path?: string } | undefined>)[key];
      const setBy = resolved.sources
        .filter(({ settings }) => Object.prototype.hasOwnProperty.call(settings, key))
        .map(({ source }) => source as ClaudeSettingSource);
      const source = (provenance?.source ?? setBy[setBy.length - 1] ?? 'user') as ClaudeSettingSource;
      return {
        key,
        tier: CLAUDE_SETTINGS_CATALOG[key] ?? 'unclassified',
        ...redact(key, value),
        source,
        ...(provenance?.path ? { path: provenance.path } : {}),
        alsoSetIn: [...new Set(setBy.filter((candidate) => candidate !== source))],
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return { workspacePath: workspacePath ? path.resolve(workspacePath) : null, sources, entries };
};
