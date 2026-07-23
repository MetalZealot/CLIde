import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { removeJsonlFilesAndPruneEmptyDirs } from '@/modules/projects/services/project-delete.service.js';

async function makeTempProjectDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'clide-project-delete-'));
}

test('removeJsonlFilesAndPruneEmptyDirs deletes jsonl files and prunes the now-empty dir', async () => {
  const root = await makeTempProjectDir();
  try {
    const slugDir = path.join(root, '-tmp-probe');
    await fs.mkdir(slugDir, { recursive: true });
    const jsonlA = path.join(slugDir, 'a.jsonl');
    const jsonlB = path.join(slugDir, 'b.jsonl');
    await fs.writeFile(jsonlA, '{}');
    await fs.writeFile(jsonlB, '{}');

    await removeJsonlFilesAndPruneEmptyDirs([jsonlA, jsonlB]);

    await assert.rejects(fs.access(jsonlA));
    await assert.rejects(fs.access(jsonlB));
    // The per-project directory should be gone once it holds nothing.
    await assert.rejects(fs.access(slugDir));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('removeJsonlFilesAndPruneEmptyDirs leaves a dir that still has other files (e.g. subagent transcripts)', async () => {
  const root = await makeTempProjectDir();
  try {
    const slugDir = path.join(root, '-tmp-probe');
    const subagentDir = path.join(slugDir, 'session-1', 'subagents');
    await fs.mkdir(subagentDir, { recursive: true });
    const jsonl = path.join(slugDir, 'session-1.jsonl');
    await fs.writeFile(jsonl, '{}');
    await fs.writeFile(path.join(subagentDir, 'agent-1.jsonl'), '{}');

    await removeJsonlFilesAndPruneEmptyDirs([jsonl]);

    await assert.rejects(fs.access(jsonl));
    // Non-recursive rmdir must not touch a dir that still contains nested transcripts.
    await fs.access(slugDir);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('removeJsonlFilesAndPruneEmptyDirs tolerates already-missing files', async () => {
  const root = await makeTempProjectDir();
  try {
    const missing = path.join(root, 'gone', 'never.jsonl');
    await assert.doesNotReject(removeJsonlFilesAndPruneEmptyDirs([missing]));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
