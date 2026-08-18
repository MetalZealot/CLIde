import { readFile } from 'node:fs/promises';

import type { ProviderSessionEffortEvidence } from '@/shared/types.js';

type CodexRolloutEntry = {
  type?: unknown;
  timestamp?: unknown;
  payload?: {
    effort?: unknown;
    collaboration_mode?: {
      settings?: {
        reasoning_effort?: unknown;
      };
    };
  };
};

const readEffortString = (value: unknown): string | null => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);

/**
 * Reads the effort Codex actually ran the session's last turn at.
 *
 * Codex opens every turn with a `turn_context` entry describing the settings
 * that turn ran under, `effort` among them, so the newest one is effective
 * truth. The collaboration mode's `reasoning_effort` is the same value seen
 * through the mode's settings and is read only as a fallback, for rollouts
 * written before the top-level field existed.
 */
export const readCodexSessionEffortFromRollout = async (
  rolloutPath: string,
): Promise<ProviderSessionEffortEvidence | null> => {
  const content = await readFile(rolloutPath, 'utf8');
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]) as CodexRolloutEntry;
      if (entry.type !== 'turn_context') {
        continue;
      }

      const effort = readEffortString(entry.payload?.effort)
        ?? readEffortString(entry.payload?.collaboration_mode?.settings?.reasoning_effort);
      if (!effort) {
        continue;
      }

      return {
        effort,
        timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : undefined,
      };
    } catch {
      // Skip malformed JSONL lines that can happen during concurrent writes.
    }
  }

  return null;
};
