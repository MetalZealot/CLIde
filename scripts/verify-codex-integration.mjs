// Codex behaviour CLIde claims, checked at every boundary it crosses: protocol, gateway,
// adapter, history, browser. A group's name identifies the broken boundary, so a failed
// group is never replaced by a broad `npm test` pass.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const moduleRequire = createRequire(import.meta.url);
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);

if (nodeMajor !== 22 && nodeMajor !== 24) {
  console.error(
    `Codex integration checks require the repository's supported Node 22 or 24 runtime; found ${process.version}.`,
  );
  console.error('On the CLIde Raspberry Pi, use the same Node 24 runtime as cloudcli.service.');
  process.exit(1);
}

try {
  const Database = moduleRequire('better-sqlite3');
  new Database(':memory:').close();
} catch (error) {
  console.error(`The installed native modules do not match ${process.version}.`);
  console.error('Use the Node runtime that installed node_modules, then retry.');
  if (error instanceof Error) {
    console.error(error.message);
  }
  process.exit(1);
}

const tsxCli = moduleRequire.resolve('tsx/cli');

function runGroup(label, tsxArguments, files) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(process.execPath, [tsxCli, ...tsxArguments, ...files], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runServerGroup(label, files) {
  runGroup(label, [
    '--tsconfig',
    'server/tsconfig.json',
    '--test',
    '--test-concurrency=1',
  ], files);
}

function runClientGroup(label, files) {
  runGroup(label, [
    '--tsconfig',
    'tsconfig.json',
    '--import',
    './src/test/setup-client-env.ts',
    '--test',
    '--test-concurrency=1',
  ], files);
}

console.log(`Codex integration check using ${process.version}`);

runServerGroup('1/4 pinned runtime and App Server protocol', [
  'server/modules/providers/tests/codex-runtime.test.ts',
]);

runServerGroup('2/4 browser gateway and streamed adapter contract', [
  'server/shared/tests/shared.test.ts',
  'server/modules/providers/tests/codex-app-server-chat.test.ts',
  'server/modules/providers/tests/provider-runtime.test.ts',
  'server/modules/websocket/tests/chat-session.test.ts',
  'server/modules/websocket/tests/chat-run-registry.test.ts',
]);

runServerGroup('3/4 persisted history and session identity', [
  'server/modules/database/tests/sessions.db.test.ts',
  'server/modules/providers/tests/codex-sessions.test.ts',
  'server/modules/providers/tests/provider-sessions.test.ts',
  'server/modules/providers/tests/provider-usage.test.ts',
]);

runClientGroup('4/4 browser reconciliation and rendering', [
  'src/components/chat/hooks/chatHooks.test.ts',
  'src/components/chat/utils/chatUtils.test.ts',
  'src/components/chat/view/subcomponents/chatSubcomponents.test.tsx',
  'src/stores/sessionStore.test.tsx',
]);

/** Live rows: [what, verify, required after]. The suite fakes App Server, so none of these is covered. */
const LIVE_ROWS = [
  ['Runtime identity', 'Diagnostics show the intended SDK, bundled CLI, and configured and actual transport', 'dependency, runtime or transport changes'],
  ['New then resumed', 'One sidebar row, one user turn, one reply; the resumed turn stays in the same CLIde session', 'gateway, session-id or App Server changes'],
  ['Plan then Default', 'Plan tools appear in Plan; the next Default turn clears collaboration mode', 'mode or capability changes'],
  ['Interactive request', 'An approval or question survives one refresh and resolves once; Send now steers, Queue waits, a composer queue wins', 'App Server, registry, WebSocket or replay changes'],
  ['Mixed attachments', 'An image and a non-image file both reach Codex and keep their indicators after reload', 'composer, upload, gateway, adapter or history changes'],
  ['Tool lifecycle', 'Command, file change, MCP call and web search render live and match after reload', 'normalizer, renderer or rollout-parser changes'],
  ['Stop', 'Aborting a first turn and a resumed turn leaves nothing running and no second sidebar row', 'abort, run-registry or session-mapping changes'],
  ['Rewind and fork', 'Rewind keeps the CLIde session id; fork makes a new session with correct lineage', 'session or turn identity changes'],
  ['Usage', 'Context usage updates during Chat; account usage loads without sharing Chat\'s process', 'usage or App Server client changes'],
  ['SDK escape hatch', 'With CLIDE_CODEX_CHAT_TRANSPORT=sdk, text and image Chat work and App-Server-only capabilities are not advertised', 'transport selection or capability changes'],
];

console.log('\nAutomated Codex integration checks passed.');
console.log('\nNot covered: a real Codex thread, ~/.codex, new rollout shapes, the installed PWA.');
console.log('After a dependency upgrade, provider refactor or upstream integration, run the rows that apply:\n');
for (const [row, verify, after] of LIVE_ROWS) {
  console.log(`  ${row.padEnd(20)} ${verify}\n  ${''.padEnd(20)} after ${after}`);
}
console.log('\nRecord accepted live evidence in the commit that takes the release.');
