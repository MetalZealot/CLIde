import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { BackgroundOutput } from '@/shared/types.js';

import { encodeClaudeProjectDir } from './claude-rewind.util.js';

/** The tail Claude Code's own /tasks view shows. */
export const BACKGROUND_OUTPUT_TAIL_BYTES = 8 * 1024;

/** Claude Code writes each background command's output under its per-user temp dir, by project and session. */
export function claudeTaskOutputPath(projectPath: string, providerSessionId: string, taskId: string): string {
  return path.join(
    os.tmpdir(),
    `claude-${process.getuid?.() ?? 0}`,
    encodeClaudeProjectDir(projectPath),
    providerSessionId,
    'tasks',
    `${taskId}.output`,
  );
}

export async function readClaudeBackgroundOutput(
  projectPath: string,
  providerSessionId: string,
  taskId: string,
  filePath: string = claudeTaskOutputPath(projectPath, providerSessionId, taskId),
): Promise<BackgroundOutput | null> {
  // Both ids become path segments.
  if (!/^[\w-]+$/.test(providerSessionId) || !/^[\w-]+$/.test(taskId)) return null;
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(filePath, 'r');
  } catch {
    return null;
  }
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, BACKGROUND_OUTPUT_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return { output: buffer.toString('utf8'), truncated: size > length, live: false };
  } finally {
    await handle.close();
  }
}
