import { readFile } from 'node:fs/promises';

import type { ProviderSessionEffortEvidence } from '@/shared/types.js';

type ClaudeEffortEvent = {
  sessionId?: string;
  session_id?: string;
  effort?: unknown;
  isSidechain?: unknown;
  timestamp?: unknown;
};

/**
 * Reads the effort Claude actually ran the session's last turn at.
 *
 * Claude Code stamps a top-level `effort` on transcript entries, which makes
 * the transcript the same kind of ground truth for effort that it already is
 * for the model: an effort changed outside the app (a Shell `/model`, fast
 * mode) shows up here and nowhere else.
 *
 * Sidechain entries are skipped. Those are subagent turns, which run at their
 * own effort and say nothing about the conversation the user is looking at.
 */
export const readClaudeSessionEffortFromJsonl = async (
  sessionId: string,
  jsonlPath: string,
): Promise<ProviderSessionEffortEvidence | null> => {
  const content = await readFile(jsonlPath, 'utf8');
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const event = JSON.parse(lines[index]) as ClaudeEffortEvent;

      if (event.isSidechain === true) {
        continue;
      }

      // Transcript files can carry entries from a superseded provider session
      // after a rewind; an entry that names a different session is not ours.
      const eventSessionId = event.sessionId ?? event.session_id;
      if (eventSessionId && eventSessionId !== sessionId) {
        continue;
      }

      const effort = typeof event.effort === 'string' ? event.effort.trim() : '';
      if (!effort) {
        continue;
      }

      return {
        effort,
        timestamp: typeof event.timestamp === 'string' ? event.timestamp : undefined,
      };
    } catch {
      // Skip malformed JSONL lines that can happen during concurrent writes.
    }
  }

  return null;
};
