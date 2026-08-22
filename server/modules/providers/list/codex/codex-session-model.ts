import { readFile } from 'node:fs/promises';

import type { ProviderSessionModelEvidence } from '@/shared/types.js';

type CodexRolloutEntry = {
  type?: unknown;
  timestamp?: unknown;
  payload?: {
    model?: unknown;
  };
};

const readModelString = (value: unknown): string | null => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);

/**
 * Reads the model Codex actually ran the session's latest turn with.
 *
 * Used by the Codex model adapter to keep display and resume state tied to the
 * session rather than Codex's global config. Malformed trailing JSONL is
 * skipped because the provider may still be writing the rollout concurrently.
 */
export const readCodexSessionModelFromRollout = async (
  rolloutPath: string,
): Promise<ProviderSessionModelEvidence | null> => {
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

      const model = readModelString(entry.payload?.model);
      if (!model) {
        continue;
      }

      return {
        model,
        timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : undefined,
      };
    } catch {
      // Concurrent writes can leave an incomplete final line; keep scanning.
    }
  }

  return null;
};
