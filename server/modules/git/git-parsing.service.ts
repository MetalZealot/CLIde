type GitStatusSummary = {
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
  staged: string[];
};

type GitCommitSummary = {
  hash: string;
  parents: string[];
  refs: string[];
  author: string;
  email: string;
  date: string;
  message: string;
  stats: string;
};

const GIT_LOG_FIELD_SEPARATOR = '\u001f';

/** Parses NUL-delimited porcelain output into UI status buckets. */
export function parseGitStatusOutput(statusOutput: string): GitStatusSummary {
  const result: GitStatusSummary = { modified: [], added: [], deleted: [], untracked: [], staged: [] };
  const entries = statusOutput.split('\0');
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || entry.length < 4) continue;
    const indexStatus = entry[0];
    const worktreeStatus = entry[1];
    const filePath = entry.slice(3);
    if (indexStatus === 'R' || indexStatus === 'C') index += 1;
    if (indexStatus === '?') { result.untracked.push(filePath); continue; }
    if (indexStatus === '!') continue;
    const conflict = indexStatus === 'U' || worktreeStatus === 'U'
      || (indexStatus === 'A' && worktreeStatus === 'A')
      || (indexStatus === 'D' && worktreeStatus === 'D');
    if (conflict) { result.modified.push(filePath); continue; }
    if (indexStatus !== ' ') result.staged.push(filePath);
    if (indexStatus === 'D' || worktreeStatus === 'D') result.deleted.push(filePath);
    else if (indexStatus === 'A' || worktreeStatus === 'A') result.added.push(filePath);
    else result.modified.push(filePath);
  }
  return result;
}

export type WorktreeChangeSummary = {
  /** Tracked changes plus untracked files, matching what the Changes tab lists. */
  changedFiles: number;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
};

/**
 * Parses `git status --porcelain=v2 --branch` into the per-worktree counts the
 * Worktrees panel shows.
 *
 * v2 rather than v1 because only v2 reports `branch.ab`, so one invocation
 * answers both "is it dirty" and "is it unpushed". Entry lines are counted, not
 * collected: paths in v2 are quoted when they contain control characters, and a
 * count needs no unquoting.
 */
export function parseWorktreeStatusPorcelainV2(statusOutput: string): WorktreeChangeSummary {
  const summary: WorktreeChangeSummary = { changedFiles: 0, ahead: 0, behind: 0, hasUpstream: false };

  for (const line of statusOutput.split('\n')) {
    if (line.startsWith('# branch.ab ')) {
      // "# branch.ab +2 -1" — always both fields, always signed.
      const [aheadField, behindField] = line.slice('# branch.ab '.length).trim().split(' ');
      summary.ahead = Math.abs(Number.parseInt(aheadField, 10)) || 0;
      summary.behind = Math.abs(Number.parseInt(behindField, 10)) || 0;
      summary.hasUpstream = true;
      continue;
    }
    if (line.startsWith('#')) continue;
    // 1 ordinary, 2 renamed/copied, u unmerged, ? untracked. "!" ignored files
    // never appear without --ignored.
    if (/^[12u?] /.test(line)) summary.changedFiles += 1;
  }

  return summary;
}

/** Parses the Git history format used by the commits endpoint, including shortstat lines. */
export function parseGitLogWithStats(stdout: string): GitCommitSummary[] {
  const commits: GitCommitSummary[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    if (line.includes(GIT_LOG_FIELD_SEPARATOR)) {
      const [hash = '', parents = '', refs = '', author = '', email = '', date = '', ...message] =
        line.split(GIT_LOG_FIELD_SEPARATOR);
      commits.push({
        hash, parents: parents.split(' ').filter(Boolean), refs: refs.split(', ').filter(Boolean),
        author, email, date, message: message.join(GIT_LOG_FIELD_SEPARATOR), stats: '',
      });
    } else if (commits.length > 0 && /files? changed/.test(line)) {
      const latestCommit = commits.at(-1);
      if (latestCommit) latestCommit.stats = line.trim();
    }
  }
  return commits;
}
