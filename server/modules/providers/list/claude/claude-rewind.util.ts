import fs from 'node:fs';

/**
 * Helpers for conversation rewind against Claude Code transcript jsonl files.
 *
 * Ground truth (scripts/verify-rewind-sdk.ts, 2026-07-22):
 * - `resumeSessionAt` accepts only ASSISTANT uuids; the anchor is inclusive. A
 *   user entry's parentUuid chain leads directly to the assistant entry the SDK
 *   would anchor the next turn to.
 * - A rewound turn is APPENDED to the same jsonl with parentUuid at the anchor:
 *   the transcript becomes a tree and the abandoned tail stays. Readers must
 *   follow the active parent chain — see {@link filterToActiveBranch}.
 */

/** The minimal transcript-entry shape these helpers care about. */
export type RewindTranscriptEntry = {
  uuid?: string;
  parentUuid?: string | null;
  type?: string;
  isSidechain?: boolean;
};

const UUID_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Normalized message ids are the transcript uuid plus an optional part suffix
 * (`_text_0`, `_tr_<toolUseId>`, `_images`). Returns the leading uuid, or null
 * when the id is not transcript-backed.
 */
export function extractBaseTranscriptUuid(messageId: unknown): string | null {
  if (typeof messageId !== 'string') {
    return null;
  }
  const match = messageId.match(UUID_PREFIX_RE);
  return match ? match[0].toLowerCase() : null;
}

export type ResumeAnchor =
  | { found: true; anchorUuid: string | null }
  | { found: false; anchorUuid: null };

/**
 * Given the uuid of the user message being edited, find the uuid to pass as
 * `resumeSessionAt`: the nearest ASSISTANT ancestor on the parentUuid chain.
 *
 * `anchorUuid: null` with `found: true` means no assistant ancestor — the edited
 * message is the session's first, so the caller must start fresh.
 */
export function computeResumeAnchor(
  entries: RewindTranscriptEntry[],
  editedUserUuid: string,
): ResumeAnchor {
  const byUuid = new Map<string, RewindTranscriptEntry>();
  for (const entry of entries) {
    if (entry.uuid) {
      byUuid.set(entry.uuid.toLowerCase(), entry);
    }
  }

  const edited = byUuid.get(editedUserUuid.toLowerCase());
  if (!edited) {
    return { found: false, anchorUuid: null };
  }

  const seen = new Set<string>();
  let parentUuid = edited.parentUuid ?? null;
  while (parentUuid) {
    const key = parentUuid.toLowerCase();
    if (seen.has(key)) {
      break; // defensive: cycle in a corrupt transcript
    }
    seen.add(key);
    const parent = byUuid.get(key);
    if (!parent) {
      break;
    }
    if (parent.type === 'assistant') {
      return { found: true, anchorUuid: parent.uuid ?? null };
    }
    parentUuid = parent.parentUuid ?? null;
  }

  return { found: true, anchorUuid: null };
}

/**
 * Drop transcript entries on an abandoned branch.
 *
 * The active branch is the ancestor chain of the LAST (file order) non-sidechain
 * user/assistant entry. An entry is dropped only when its own ancestor walk
 * reaches the active chain without the entry being on it — i.e. it provably
 * forked off. Everything else is kept: entries without a uuid (metadata rows),
 * sidechain entries (subagent activity), and chain segments disconnected from
 * the active root (pre-compaction history ending at its own null root).
 */
export function filterToActiveBranch<T extends RewindTranscriptEntry>(entries: T[]): T[] {
  const byUuid = new Map<string, T>();
  let tip: T | null = null;
  for (const entry of entries) {
    if (!entry.uuid || entry.isSidechain) {
      continue;
    }
    byUuid.set(entry.uuid.toLowerCase(), entry);
    if (entry.type === 'user' || entry.type === 'assistant') {
      tip = entry;
    }
  }

  if (!tip) {
    return entries;
  }

  const active = new Set<string>();
  let cursor: T | null = tip;
  while (cursor?.uuid) {
    const key = cursor.uuid.toLowerCase();
    if (active.has(key)) {
      break; // defensive: cycle
    }
    active.add(key);
    cursor = cursor.parentUuid ? (byUuid.get(cursor.parentUuid.toLowerCase()) ?? null) : null;
  }

  // Classify each main-chain entry: keep unless its ancestor walk hits the
  // active chain from outside. Memoized so shared prefixes walk once.
  const verdictByUuid = new Map<string, boolean>(); // true = keep
  const isKept = (entry: T): boolean => {
    const chain: string[] = [];
    let current: T | null = entry;
    let verdict: boolean | null = null;
    const walked = new Set<string>();
    while (current?.uuid) {
      const key = current.uuid.toLowerCase();
      if (walked.has(key)) {
        verdict = true; // corrupt cycle — keep rather than hide data
        break;
      }
      walked.add(key);
      const memo = verdictByUuid.get(key);
      if (memo !== undefined) {
        verdict = memo;
        break;
      }
      if (active.has(key)) {
        // Reached the active chain. Kept only if the FIRST node of the walk was
        // already active.
        verdict = chain.length === 0;
        break;
      }
      chain.push(key);
      current = current.parentUuid ? (byUuid.get(current.parentUuid.toLowerCase()) ?? null) : null;
    }
    if (verdict === null) {
      verdict = true; // disconnected from the active chain (compaction etc.)
    }
    for (const key of chain) {
      verdictByUuid.set(key, verdict);
    }
    return verdict;
  };

  return entries.filter((entry) => {
    if (!entry.uuid || entry.isSidechain) {
      return true;
    }
    // Only rendered message kinds are ever hidden; chain-link metadata rows
    // (attachment, system) stay regardless of branch.
    if (entry.type !== 'user' && entry.type !== 'assistant') {
      return true;
    }
    if (active.has(entry.uuid.toLowerCase())) {
      return true;
    }
    return isKept(entry);
  });
}

/**
 * Parse a transcript jsonl into the minimal entry shape. Malformed lines are
 * skipped (they can occur during concurrent writes).
 */
export function readTranscriptEntries(jsonlPath: string): RewindTranscriptEntry[] {
  const entries: RewindTranscriptEntry[] = [];
  let content: string;
  try {
    content = fs.readFileSync(jsonlPath, 'utf8');
  } catch {
    return entries;
  }
  for (const line of content.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      entries.push({
        uuid: typeof raw.uuid === 'string' ? raw.uuid : undefined,
        parentUuid: typeof raw.parentUuid === 'string' ? raw.parentUuid : null,
        type: typeof raw.type === 'string' ? raw.type : undefined,
        isSidechain: raw.isSidechain === true,
      });
    } catch {
      // skip malformed line
    }
  }
  return entries;
}

/** Longest encoded project directory the runtime writes before it truncates. */
const CLAUDE_PROJECT_DIR_MAX = 200;

/**
 * Mirrors Claude Code's `~/.claude/projects` directory encoder, decoded from
 * the CLI binary, 2.1.233. Past the length limit it truncates the encoded form
 * and appends a base-36 `h*31 + c` hash of the ORIGINAL path, not the encoded
 * one. Only reached when a session row carries no `jsonlPath`.
 */
export function encodeClaudeProjectDir(cwd: string): string {
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  if (encoded.length <= CLAUDE_PROJECT_DIR_MAX) {
    return encoded;
  }
  let hash = 0;
  for (let i = 0; i < cwd.length; i += 1) {
    hash = ((hash << 5) - hash + cwd.charCodeAt(i)) | 0;
  }
  return `${encoded.slice(0, CLAUDE_PROJECT_DIR_MAX)}-${Math.abs(hash).toString(36)}`;
}
