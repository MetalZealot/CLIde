import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import type { AnyRecord } from '@/shared/types.js';

/**
 * A Codex rewind or `/fork` writes a *new* rollout that carries none of the
 * parent conversation, only `forked_from_id` back to it. Reading one rollout
 * therefore shows a session starting at its fork point. These helpers walk the
 * lineage so a transcript reader sees the whole conversation.
 */

/** One rollout in a lineage, oldest first. */
export type CodexTranscriptSegment = {
  path: string;
  /**
   * Rows at or above this ordinal are the branch the fork abandoned.
   * `null` keeps every row, which is what an end-of-thread `/fork` wants.
   */
  ordinalLimit: number | null;
};

type CodexRolloutMeta = {
  forkedFromId: string | null;
  forkedFromOrdinalExclusive: number | null;
};

const CHAIN_DEPTH_LIMIT = 32;

function codexSessionsRoot(): string {
  return path.join(os.homedir(), '.codex', 'sessions');
}

async function readFirstJsonlRow(filePath: string): Promise<AnyRecord | null> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      return JSON.parse(trimmed) as AnyRecord;
    }
    return null;
  } catch {
    return null;
  } finally {
    reader.close();
    stream.destroy();
  }
}

async function readRolloutMeta(filePath: string): Promise<CodexRolloutMeta | null> {
  const row = await readFirstJsonlRow(filePath);
  if (!row || row.type !== 'session_meta') {
    return null;
  }
  const payload = row.payload as AnyRecord | undefined;
  const forkedFromId = typeof payload?.forked_from_id === 'string' ? payload.forked_from_id : null;
  const explicit = typeof payload?.forked_from_ordinal_exclusive === 'number'
    ? payload.forked_from_ordinal_exclusive
    : null;
  // Ordinals continue across a fork, so a child's own is the fork point when
  // the rollout predates `forked_from_ordinal_exclusive`.
  const metaOrdinal = typeof row.ordinal === 'number' ? row.ordinal : null;

  return { forkedFromId, forkedFromOrdinalExclusive: explicit ?? metaOrdinal };
}

async function findInDirectory(directory: string, suffix: string): Promise<string | null> {
  try {
    const names = await fs.promises.readdir(directory);
    const match = names.find((name) => name.endsWith(suffix));
    return match ? path.join(directory, match) : null;
  } catch {
    return null;
  }
}

/**
 * Rollout filenames end in the provider session id, but the date-partitioned
 * directory is the fork's own creation date, so a parent can sit under another.
 */
async function findRolloutPath(
  providerSessionId: string,
  hintDirectory: string | null,
): Promise<string | null> {
  const suffix = `-${providerSessionId}.jsonl`;

  if (hintDirectory) {
    const nearby = await findInDirectory(hintDirectory, suffix);
    if (nearby) {
      return nearby;
    }
  }

  const root = codexSessionsRoot();
  try {
    const entries = await fs.promises.readdir(root, { recursive: true });
    const match = entries.find((entry) => entry.endsWith(suffix));
    return match ? path.join(root, match) : null;
  } catch {
    return null;
  }
}

/**
 * Resolves a rollout into its full lineage, oldest ancestor first. A rollout
 * with no parent, or whose parent has been deleted, yields itself alone.
 */
export async function buildCodexTranscriptChain(leafPath: string): Promise<CodexTranscriptSegment[]> {
  const segments: CodexTranscriptSegment[] = [{ path: leafPath, ordinalLimit: null }];
  const visited = new Set<string>([path.resolve(leafPath)]);
  let currentPath = leafPath;

  for (let depth = 0; depth < CHAIN_DEPTH_LIMIT; depth += 1) {
    const meta = await readRolloutMeta(currentPath);
    if (!meta?.forkedFromId) {
      break;
    }

    const parentPath = await findRolloutPath(meta.forkedFromId, path.dirname(currentPath));
    if (!parentPath) {
      break;
    }

    const resolved = path.resolve(parentPath);
    if (visited.has(resolved)) {
      break;
    }
    visited.add(resolved);

    segments.unshift({ path: parentPath, ordinalLimit: meta.forkedFromOrdinalExclusive });
    currentPath = parentPath;
  }

  return segments;
}

/** Streams every surviving row of a lineage in conversation order. */
export async function* streamCodexTranscriptRows(
  segments: CodexTranscriptSegment[],
): AsyncGenerator<AnyRecord> {
  for (const segment of segments) {
    const stream = fs.createReadStream(segment.path);
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of reader) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        let row: AnyRecord;
        try {
          row = JSON.parse(trimmed) as AnyRecord;
        } catch {
          continue;
        }

        if (
          segment.ordinalLimit !== null
          && typeof row.ordinal === 'number'
          && row.ordinal >= segment.ordinalLimit
        ) {
          continue;
        }

        yield row;
      }
    } finally {
      reader.close();
      stream.destroy();
    }
  }
}
