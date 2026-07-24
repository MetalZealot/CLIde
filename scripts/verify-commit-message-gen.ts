/**
 * Ad-hoc verification for the Source Control commit-message generator.
 *
 * Checks the two failure modes fixed together: the writer must actually collect
 * the agent's answer off the normalized stream, and the ephemeral run must not
 * leave a transcript (which the session watcher would surface as a phantom
 * sidebar session).
 *
 * Run: npx tsx --tsconfig server/tsconfig.json scripts/verify-commit-message-gen.ts
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

// @ts-expect-error - plain JS module without types
import { queryClaudeSDK } from '../server/claude-sdk.js';

const CWD = '/home/gnuthall/Projects/cloudcli';
const PROJECT_DIR = path.join(os.homedir(), '.claude', 'projects', '-home-gnuthall-Projects-cloudcli');

async function listTranscripts(): Promise<Set<string>> {
  const entries = await fs.readdir(PROJECT_DIR);
  return new Set(entries);
}

const before = await listTranscripts();

let responseText = '';
const writer = {
  send: (data: unknown) => {
    const parsed = (typeof data === 'string' ? JSON.parse(data) : data) as Record<string, unknown>;
    if (parsed?.kind === 'text' && parsed.role === 'assistant' && typeof parsed.content === 'string') {
      responseText += parsed.content;
    }
  },
  setSessionId: () => {},
};

await queryClaudeSDK(
  'Generate a conventional commit message for adding a --verbose flag to the CLI. Return ONLY the commit message.',
  { cwd: CWD, permissionMode: 'bypassPermissions', model: 'sonnet', persistSession: false },
  writer,
);

const after = await listTranscripts();
const created = [...after].filter((name) => !before.has(name));

console.log('--- collected text ---');
console.log(responseText || '(empty)');
console.log('--- new files in project dir ---');
console.log(created.length ? created : '(none)');
console.log(responseText.trim() && created.length === 0 ? 'PASS' : 'FAIL');
