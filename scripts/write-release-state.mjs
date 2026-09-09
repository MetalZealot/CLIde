#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), '..');
const STATE_DIR = join(ROOT, '.generated', 'release');

async function git(args, root) {
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], { encoding: 'utf8' });
  return stdout.trim();
}

export async function hashFile(path) {
  const content = await readFile(path);
  return createHash('sha256').update(content).digest('hex');
}

export async function hashDirectory(root) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit(root);
  files.sort((left, right) => relative(root, left).localeCompare(relative(root, right)));

  const hash = createHash('sha256');
  for (const path of files) {
    const name = relative(root, path);
    const content = await readFile(path);
    hash.update(`${Buffer.byteLength(name)}:${name}:${content.length}:`);
    hash.update(content);
  }
  return hash.digest('hex');
}

export async function createReleaseRecord(kind, {
  root = ROOT,
  now = () => new Date(),
} = {}) {
  if (!['dependencies', 'client', 'server'].includes(kind)) {
    throw new Error(`Unknown release-state kind: ${kind}`);
  }

  const [commit, branch, status, lockHash] = await Promise.all([
    git(['rev-parse', 'HEAD'], root),
    git(['rev-parse', '--abbrev-ref', 'HEAD'], root),
    git(['status', '--porcelain', '--untracked-files=normal'], root),
    hashFile(join(root, 'package-lock.json')),
  ]);
  const artifactPath = kind === 'dependencies'
    ? null
    : join(root, kind === 'client' ? 'dist' : 'dist-server');

  return {
    schemaVersion: 1,
    kind,
    commit,
    branch,
    dirty: status.length > 0,
    lockHash,
    artifactHash: artifactPath ? await hashDirectory(artifactPath) : null,
    createdAt: now().toISOString(),
  };
}

export async function writeReleaseRecord(kind, options = {}) {
  const root = options.root ?? ROOT;
  const stateDir = options.stateDir ?? join(root, '.generated', 'release');
  const record = await createReleaseRecord(kind, { ...options, root });
  const target = join(stateDir, `${kind}.json`);
  const temporary = `${target}.${process.pid}.tmp`;

  await mkdir(stateDir, { recursive: true });
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  const kind = process.argv[2];
  writeReleaseRecord(kind, { root: ROOT, stateDir: STATE_DIR })
    .then((record) => {
      console.log(`release-state: ${kind} recorded for ${record.commit.slice(0, 8)}${record.dirty ? ' (dirty)' : ''}`);
    })
    .catch((error) => {
      console.error(`release-state: ${error.message}`);
      process.exitCode = 1;
    });
}
