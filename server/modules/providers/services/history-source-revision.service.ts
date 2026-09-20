import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';

import type {
  HistorySourceRevision,
  HistorySourceStamp,
  HistorySourceTarget,
} from '@/shared/types.js';

async function readFingerprint(target: HistorySourceTarget): Promise<HistorySourceStamp | null> {
  let stat;
  try {
    stat = await fsp.stat(target.path, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && target.optional) {
      return {
        path: target.path,
        kind: 'missing',
        fingerprint: 'missing',
        size: 0,
        requireTrailingNewline: Boolean(target.requireTrailingNewline),
      };
    }
    return null;
  }

  const actualKind = stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : null;
  if (actualKind !== target.kind) {
    return null;
  }

  if (target.requireTrailingNewline && stat.size > 0n) {
    let handle;
    try {
      handle = await fsp.open(target.path, 'r');
      const ending = Buffer.allocUnsafe(1);
      const { bytesRead } = await handle.read(ending, 0, 1, Number(stat.size - 1n));
      if (bytesRead !== 1 || ending[0] !== 0x0a) {
        return null;
      }
    } catch {
      return null;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  return {
    path: target.path,
    kind: actualKind,
    fingerprint: [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs]
      .map(String)
      .join(':'),
    size: Number(stat.size),
    requireTrailingNewline: Boolean(target.requireTrailingNewline),
  };
}

function revisionFor(scope: string, sources: HistorySourceStamp[]): string {
  const hash = createHash('sha256');
  hash.update(scope);
  for (const source of sources) {
    hash.update('\0');
    hash.update(source.path);
    hash.update('\0');
    hash.update(source.kind);
    hash.update('\0');
    hash.update(source.fingerprint);
  }
  return hash.digest('hex');
}

/**
 * Claude and Codex providers use this to capture all filesystem dependencies
 * behind one normalized history result. A partial JSONL tail or unreadable
 * required source returns null, preventing the result from entering the cache.
 */
export async function captureHistorySourceRevision(
  scope: string,
  targets: HistorySourceTarget[],
): Promise<HistorySourceRevision | null> {
  const uniqueTargets = [...new Map(targets.map((target) => [target.path, target])).values()]
    .sort((left, right) => left.path.localeCompare(right.path));
  const sources: HistorySourceStamp[] = [];
  for (const target of uniqueTargets) {
    const source = await readFingerprint(target);
    if (!source) {
      return null;
    }
    sources.push(source);
  }
  return {
    scope,
    revision: revisionFor(scope, sources),
    sourceBytes: sources.reduce((total, source) => total + source.size, 0),
    sources,
  };
}

/**
 * Provider readers use this fast path to validate known dependencies with
 * metadata only. Changed sources fall back to provider-specific discovery so
 * newly added Claude agents and changed Codex ancestry are included.
 */
export async function isHistorySourceRevisionCurrent(
  revision: HistorySourceRevision,
): Promise<boolean> {
  for (const source of revision.sources) {
    if (source.kind === 'missing') {
      try {
        await fsp.stat(source.path);
        return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          return false;
        }
        continue;
      }
    }

    const current = await readFingerprint({
      path: source.path,
      kind: source.kind,
      requireTrailingNewline: false,
    });
    if (!current || current.fingerprint !== source.fingerprint) {
      return false;
    }
  }
  return true;
}
