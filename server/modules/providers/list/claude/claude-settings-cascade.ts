/**
 * The Claude Code settings cascade as a session in a given project would see
 * it, resolved by the SDK's own merge engine without spawning the CLI, plus
 * the writes the Configuration screen makes to the user file.
 *
 * `resolveSettings()` is `@alpha` and only ever feeds the read path; a write
 * goes through the shared settings-file writer and never depends on it.
 */

import path from 'node:path';

import { resolveSettings } from '@anthropic-ai/claude-agent-sdk';

import {
  CLAUDE_SETTINGS_CATALOG,
  type ClaudeSettingTier,
} from '@/modules/providers/list/claude/claude-settings-catalog.js';
import { updateClaudeSettingsFile } from '@/modules/providers/list/claude/claude-settings-file.js';
import {
  readClaudeSettingsSchema,
  type ClaudeSettingControl,
} from '@/modules/providers/list/claude/claude-settings-schema.js';

export type ClaudeSettingSource = 'user' | 'project' | 'local' | 'managed' | 'flag';

export type ClaudeCascadeEntry = {
  key: string;
  /** `unclassified` is a key the SDK resolved but the catalog has never seen. */
  tier: ClaudeSettingTier | 'unclassified';
  /** Absent when no file sets the key. */
  value?: unknown;
  /** The source whose value won; null when no file sets the key. */
  source: ClaudeSettingSource | null;
  path?: string;
  /** Every other source that also sets the key, low→high precedence. */
  alsoSetIn: ClaudeSettingSource[];
  /** The value was withheld; `value` lists names only. */
  redacted?: true;
  /** Present on keys the screen may edit; writes always land in the user file. */
  control?: Exclude<ClaudeSettingControl, { kind: 'complex' }>;
  description?: string;
  /** Whether the user file sets the key, i.e. whether Reset has anything to remove. */
  inUserFile: boolean;
  /** The user file's own value for an editable key, which a higher source may override. */
  userValue?: unknown;
  /** Projects whose own files set the key, so the user value does not apply there. */
  overrides?: ClaudeSettingOverride[];
};

export type ClaudeSettingOverride = {
  workspacePath: string;
  source: ClaudeSettingSource;
  value: unknown;
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

/** Union-typed keys whose plain form CLIde writes; the richer form stays file-only. */
const CONTROL_OVERRIDES: Record<string, ClaudeCascadeEntry['control']> = {
  attribution: { kind: 'boolean' },
};

/**
 * The generated control for a key the screen may write, if it is one: an
 * `adapt` key, or one newer than the catalog, whose SDK type is simple.
 */
const editableControl = (key: string): ClaudeCascadeEntry['control'] => {
  const tier = CLAUDE_SETTINGS_CATALOG[key];
  if (tier !== undefined && tier !== 'adapt') return undefined;
  if (CONTROL_OVERRIDES[key]) return CONTROL_OVERRIDES[key];
  const control = readClaudeSettingsSchema().get(key)?.control;
  return control && control.kind !== 'complex' ? control : undefined;
};

export const readClaudeSettingsCascade = async (
  workspacePath: string | null,
): Promise<ClaudeSettingsCascade> => {
  // Without a project, project and local are skipped rather than resolved
  // against the server's own working directory.
  const resolved = await resolveSettings(workspacePath
    ? { cwd: path.resolve(workspacePath) }
    : { settingSources: ['user'] });

  // A project rooted at the home directory reads the user file a second time as
  // its project file; that is the user file, not an override of it.
  const userPath = resolved.sources.find(({ source }) => source === 'user')?.path;
  const sourceOf = (source: string, filePath?: string): ClaudeSettingSource => (
    userPath && filePath === userPath ? 'user' : source as ClaudeSettingSource
  );

  const sources = resolved.sources.map(({ source, path: filePath, settings }) => ({
    source: sourceOf(source, filePath),
    ...(filePath ? { path: filePath } : {}),
    keyCount: Object.keys(settings).length,
  }));
  const userSettings = (resolved.sources.find(({ source }) => source === 'user')?.settings ?? {}) as Record<string, unknown>;
  const effective = resolved.effective as Record<string, unknown>;
  const provenance = resolved.provenance as Record<string, { source: string; path?: string } | undefined>;
  const schema = readClaudeSettingsSchema();

  // Every set key, plus every `adapt` or uncatalogued key so an unset one can be set.
  const keys = new Set([
    ...Object.keys(effective),
    ...Object.keys(CLAUDE_SETTINGS_CATALOG).filter((key) => CLAUDE_SETTINGS_CATALOG[key] === 'adapt'),
    ...[...schema.keys()].filter((key) => !(key in CLAUDE_SETTINGS_CATALOG)),
  ]);

  const entries = [...keys]
    .map((key): ClaudeCascadeEntry => {
      const setBy = resolved.sources
        .filter(({ settings }) => Object.prototype.hasOwnProperty.call(settings, key))
        .map(({ source, path: filePath }) => sourceOf(source, filePath));
      const isSet = Object.prototype.hasOwnProperty.call(effective, key);
      const source = isSet
        ? (provenance[key] ? sourceOf(provenance[key].source, provenance[key].path) : setBy[setBy.length - 1] ?? 'user')
        : null;
      const control = editableControl(key);
      const description = schema.get(key)?.description;
      return {
        key,
        tier: CLAUDE_SETTINGS_CATALOG[key] ?? 'unclassified',
        ...(isSet ? redact(key, effective[key]) : {}),
        source,
        ...(provenance[key]?.path ? { path: provenance[key]?.path } : {}),
        alsoSetIn: [...new Set(setBy.filter((candidate) => candidate !== source))],
        ...(control ? { control } : {}),
        ...(description ? { description } : {}),
        inUserFile: Object.prototype.hasOwnProperty.call(userSettings, key),
        ...(control && Object.prototype.hasOwnProperty.call(userSettings, key) ? { userValue: userSettings[key] } : {}),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return { workspacePath: workspacePath ? path.resolve(workspacePath) : null, sources, entries };
};

/**
 * The user and managed settings, with each key annotated by the projects whose
 * own files override it. Projects resolve one at a time to keep the load flat.
 */
export const readClaudeSettingsOverview = async (
  workspacePaths: string[],
): Promise<Pick<ClaudeSettingsCascade, 'entries'>> => {
  const base = await readClaudeSettingsCascade(null);
  const overrides = new Map<string, ClaudeSettingOverride[]>();
  for (const workspacePath of new Set(workspacePaths.map((candidate) => path.resolve(candidate)))) {
    const project = await readClaudeSettingsCascade(workspacePath).catch(() => null);
    for (const entry of project?.entries ?? []) {
      if (entry.source !== 'project' && entry.source !== 'local') continue;
      const list = overrides.get(entry.key) ?? [];
      list.push({ workspacePath, source: entry.source, value: entry.value });
      overrides.set(entry.key, list);
    }
  }
  return {
    entries: base.entries.map((entry) => (
      overrides.has(entry.key) ? { ...entry, overrides: overrides.get(entry.key) } : entry
    )),
  };
};

export class ClaudeSettingWriteError extends Error {}

/** Checks `value` against the key's generated control; throws on anything else. */
const validateSettingValue = (key: string, value: unknown): unknown => {
  const control = editableControl(key);
  if (!control) throw new ClaudeSettingWriteError(`${key} is not editable from CLIde.`);
  switch (control.kind) {
    case 'boolean':
      if (typeof value === 'boolean') return value;
      break;
    case 'number':
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      break;
    case 'string':
      if (typeof value === 'string' && value.trim() !== '') return value.trim();
      break;
    case 'enum':
      if (typeof value === 'string' && control.options.includes(value)) return value;
      break;
  }
  throw new ClaudeSettingWriteError(`${key} must be a ${control.kind === 'enum' ? control.options.join(' | ') : control.kind}.`);
};

/** Sets one editable key in the user file; `undefined` removes it so Claude Code's default applies. */
export const writeClaudeSetting = async (
  key: string,
  value: unknown,
  settingsPath?: string,
): Promise<void> => {
  const next = value === undefined ? undefined : validateSettingValue(key, value);
  if (value === undefined && !editableControl(key)) {
    throw new ClaudeSettingWriteError(`${key} is not editable from CLIde.`);
  }
  await updateClaudeSettingsFile((settings) => {
    if (next === undefined) delete settings[key];
    else settings[key] = next;
  }, settingsPath);
};
