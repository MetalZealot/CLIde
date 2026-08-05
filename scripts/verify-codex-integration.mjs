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
  'server/modules/providers/tests/codex-app-server-protocol-drift.test.ts',
  'server/modules/providers/tests/codex-usage.test.ts',
]);

runServerGroup('2/4 browser gateway and streamed adapter contract', [
  'server/shared/tests/image-attachments.test.ts',
  'server/modules/providers/tests/codex-app-server-chat.test.ts',
  'server/modules/providers/tests/provider-runtime.service.test.ts',
  'server/modules/providers/tests/interactive-request-registry.test.ts',
  'server/modules/websocket/tests/chat-attachment-filter.test.ts',
  'server/modules/websocket/tests/chat-session-addressing.test.ts',
  'server/modules/websocket/tests/chat-run-registry.test.ts',
]);

runServerGroup('3/4 persisted history and session identity', [
  'server/modules/database/tests/sessions-provider-mapping.test.ts',
  'server/modules/providers/tests/codex-sessions.test.ts',
  'server/modules/providers/tests/provider-attachment-history.test.ts',
  'server/modules/providers/tests/provider-token-usage.service.test.ts',
]);

runClientGroup('4/4 browser reconciliation and rendering', [
  'src/components/chat/hooks/chatHooks.test.ts',
  'src/components/chat/tools/components/ContentRenderers/QuestionAnswerContent.test.tsx',
  'src/components/chat/utils/chatUtils.test.ts',
  'src/components/chat/view/subcomponents/chatSubcomponents.test.tsx',
  'src/stores/sessionStore.test.tsx',
]);

console.log('\nAutomated Codex integration checks passed.');
console.log(
  'Complete the live smoke rows in docs/maps/codex-integration-conformance.md before deployment acceptance.',
);
