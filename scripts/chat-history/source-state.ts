import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Benchmarks fingerprint runtime source so concurrent work cannot look like the same build.
export function historySourceState() {
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', 'src', 'server', 'shared'], { encoding: 'utf8' }).split('\0').filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const file of paths) { hash.update(file); hash.update('\0'); hash.update(readFileSync(file)); }
  return { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceSha256: hash.digest('hex'), dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() };
}
