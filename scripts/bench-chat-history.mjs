import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const strict = args.includes('--check');
let failed = false;
if (!args.includes('--regressions-only')) {
  const measured = spawnSync(process.execPath, ['--expose-gc', '--import', 'tsx', 'scripts/chat-history/measure.ts', ...args], {
    cwd: root, stdio: 'inherit', env: { ...process.env, TSX_TSCONFIG_PATH: 'server/tsconfig.json' },
  });
  if (measured.error) throw measured.error;
  failed ||= measured.status !== 0;
}
if (strict || args.includes('--regressions-only')) {
  for (const [config, preload, file] of [
    ['server/tsconfig.json', [], 'server/modules/providers/tests/provider-sessions.test.ts'],
    ['tsconfig.json', ['--import', './src/test/setup-client-env.ts'], 'src/components/chat/hooks/chatHooks.test.ts'],
  ]) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', ...preload, '--test', '--test-name-pattern=history performance target', file], {
      cwd: root, stdio: 'inherit', env: { ...process.env, TSX_TSCONFIG_PATH: config },
    });
    if (result.error) throw result.error;
    failed ||= result.status !== 0;
  }
}
process.exitCode = failed ? 1 : 0;
