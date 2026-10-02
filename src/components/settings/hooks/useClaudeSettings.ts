import { useCallback, useEffect, useMemo, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { SettingsProject } from '../types/types';
import { projectPathOf } from '../utils/claudeConfiguration';

export type ClaudeSettingSource = 'user' | 'project' | 'local' | 'managed' | 'flag';

export type ClaudeSettingControl =
  | { kind: 'boolean' }
  | { kind: 'number' }
  | { kind: 'string' }
  | { kind: 'enum'; options: string[] };

export type ClaudeSettingEntry = {
  key: string;
  tier: 'exposed' | 'adapt' | 'display' | 'terminal' | 'out-of-scope' | 'unclassified';
  value?: unknown;
  source: ClaudeSettingSource | null;
  path?: string;
  alsoSetIn: ClaudeSettingSource[];
  redacted?: true;
  control?: ClaudeSettingControl;
  description?: string;
  inUserFile: boolean;
  userValue?: unknown;
  overrides?: { workspacePath: string; source: ClaudeSettingSource; value: unknown }[];
};

/** A value to save, or `undefined` to delete the key so Claude Code's default applies. */
export type SaveClaudeSetting = (key: string, value: unknown) => Promise<boolean>;

const overviewUrl = (projects: SettingsProject[]): string => {
  const paths = [...new Set(projects.map(projectPathOf).filter(Boolean))];
  const query = paths.map((value) => `workspacePath=${encodeURIComponent(value)}`).join('&');
  return `/api/providers/claude/settings-overview${query ? `?${query}` : ''}`;
};

/**
 * Claude Code's user settings, each key annotated with the projects that
 * override it, plus the one way to change them. Every save re-reads, so a row
 * always shows what the file holds rather than what was asked for.
 */
export function useClaudeSettings(projects: SettingsProject[], enabled = true) {
  const url = useMemo(() => overviewUrl(projects), [projects]);
  const [entries, setEntries] = useState<Map<string, ClaudeSettingEntry> | null>(null);
  const [error, setError] = useState<'load' | 'save' | null>(null);

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    try {
      const response = await authenticatedFetch(url);
      const body = (await response.json()) as { success?: boolean; data?: { entries: ClaudeSettingEntry[] } };
      if (isCancelled()) return;
      if (body.success && body.data) {
        setEntries(new Map(body.data.entries.map((entry) => [entry.key, entry])));
        setError(null);
      } else {
        setError('load');
      }
    } catch (loadError) {
      console.error('Error loading Claude settings:', loadError);
      if (!isCancelled()) setError('load');
    }
  }, [url]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    void load(() => cancelled);
    return () => { cancelled = true; };
  }, [enabled, load]);

  const save: SaveClaudeSetting = useCallback(async (key, value) => {
    try {
      const response = await authenticatedFetch(`/api/providers/claude/settings/${encodeURIComponent(key)}`, value === undefined
        ? { method: 'DELETE' }
        : { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) });
      const body = (await response.json()) as { success?: boolean };
      setError(body.success ? null : 'save');
      await load();
      return Boolean(body.success);
    } catch (saveError) {
      console.error('Error saving Claude setting:', saveError);
      setError('save');
      return false;
    }
  }, [load]);

  return { entries, error, save };
}
