/**
 * Every composer send from the press of Send until the server confirms it
 * (`chat_input_accepted` with the same `requestId`). The bubble's stage label,
 * the activity line's deferral, resend-on-reconnect and the two-minute give-up
 * all read this one record. Upload and session creation happen in the
 * composer; the delivery itself belongs to `useSendOutboxDriver`.
 */
import { useSyncExternalStore } from 'react';

import type { PendingRewind } from '../components/chat/hooks/useChatComposerState';
import { readShellCommand } from '../components/chat/utils/chatFormatting';
import { safeLocalStorage } from '../components/chat/utils/chatStorage';

export type SendStage = 'uploading' | 'creating' | 'waiting' | 'sending' | 'failed';

export type ChatSendFrame = {
  /** `chat.shell` carries a `!` command, without its `!`, as `content`. */
  type: 'chat.send' | 'chat.shell';
  sessionId: string;
  requestId: string;
  content: string;
  options: Record<string, unknown>;
};

/**
 * A draft as the frame it goes out as: a `!` draft runs as a shell command,
 * without its `!`. A rewind edit re-sends its prompt verbatim, `!` included.
 */
export function draftSendFrame(draft: {
  sessionId: string;
  requestId: string;
  content: string;
  options: Record<string, unknown>;
  attachments: unknown[];
}): ChatSendFrame {
  const command = draft.options.rewindToMessageId === undefined
    ? readShellCommand(draft.content, draft.attachments.length)
    : null;
  return command
    ? { type: 'chat.shell', sessionId: draft.sessionId, requestId: draft.requestId, content: command, options: draft.options }
    : {
      type: 'chat.send',
      sessionId: draft.sessionId,
      requestId: draft.requestId,
      content: draft.content,
      options: { ...draft.options, attachments: draft.attachments },
    };
}

export type OutboxEntry = {
  requestId: string;
  /** Null until a brand-new chat has its session. */
  sessionId: string | null;
  projectId: string | null;
  content: string;
  stage: SendStage;
  attachmentCount: number;
  /** Start of the give-up window: the press, restarted when an upload finishes and on Retry. Uploads are not on it. */
  startedAt: number;
  /** First time the frame went to a socket: from here the server may have run it. */
  firstSentAt: number | null;
  /** Ready once uploads and the session id are in hand. */
  frame: ChatSendFrame | null;
  /** When the frame last went to the socket. */
  sentAt: number | null;
  /** The receipt is late enough to say "Sending…". */
  slow: boolean;
  /** A liveness probe already went out for this attempt. */
  probed: boolean;
  error: string | null;
};

export const SEND_GIVE_UP_MS = 2 * 60_000;
/** Retry stays safe while the server still remembers the id (24 h); after this only Edit is offered. */
export const SEND_RETRY_WINDOW_MS = 12 * 60 * 60_000;

/** What Edit puts back: the composer's files until they are uploaded, and the rewind the send was making. */
export type SendEditContext = { files: File[]; rewind: PendingRewind | null };

const entries = new Map<string, OutboxEntry>();
const listeners = new Set<() => void>();
/** Re-runs a send that failed before its frame existed (upload or session creation); dropped once it does. */
const runners = new Map<string, () => Promise<void>>();
const aborters = new Map<string, AbortController>();
const editContexts = new Map<string, SendEditContext>();
let dispatcher: ((requestId: string) => void) | null = null;

const emit = () => {
  for (const listener of listeners) listener();
};

export function mintRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  // Plain-HTTP LAN origins are not secure contexts and lack randomUUID.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const LOCAL_SEND_PREFIX = 'local_send_';

/** The optimistic bubble's row id, which ties it to its send. */
export const localSendMessageId = (requestId: string) => `${LOCAL_SEND_PREFIX}${requestId}`;

export function requestIdFromMessageId(id: unknown): string | null {
  return typeof id === 'string' && id.startsWith(LOCAL_SEND_PREFIX) ? id.slice(LOCAL_SEND_PREFIX.length) : null;
}

export function getSend(requestId: string): OutboxEntry | undefined {
  return entries.get(requestId);
}

export function listSends(): OutboxEntry[] {
  return [...entries.values()];
}

export function openSend(
  entry: Pick<OutboxEntry, 'requestId' | 'sessionId' | 'projectId' | 'content' | 'stage' | 'attachmentCount'>,
  run: (() => Promise<void>) | null,
  editContext: SendEditContext = { files: [], rewind: null },
): void {
  entries.set(entry.requestId, {
    ...entry,
    startedAt: Date.now(),
    firstSentAt: null,
    frame: null,
    sentAt: null,
    slow: false,
    probed: false,
    error: null,
  });
  if (run) runners.set(entry.requestId, run);
  editContexts.set(entry.requestId, editContext);
  rememberUnsent(entry.requestId);
  emit();
}

export function updateSend(requestId: string, patch: Partial<Omit<OutboxEntry, 'requestId'>>): void {
  const current = entries.get(requestId);
  if (!current) return;
  entries.set(requestId, { ...current, ...patch });
  if (patch.sessionId !== undefined) rememberUnsent(requestId);
  emit();
}

/** The frame is ready: the give-up clock restarts and the re-run closure is no longer needed. */
export function setSendFrame(requestId: string, frame: ChatSendFrame): void {
  runners.delete(requestId);
  updateSend(requestId, { frame, startedAt: Date.now() });
}

/** The files are on the server now; Edit rebuilds them from the uploaded copies. */
export function releaseSendFiles(requestId: string): void {
  const context = editContexts.get(requestId);
  if (context) editContexts.set(requestId, { ...context, files: [] });
}

/** Aborted when the send gives up, so a hung upload or create stops with it. */
export function sendSignal(requestId: string): AbortSignal {
  let controller = aborters.get(requestId);
  if (!controller || controller.signal.aborted) {
    controller = new AbortController();
    aborters.set(requestId, controller);
  }
  return controller.signal;
}

export function failSend(requestId: string, error: string | null = null): void {
  const current = entries.get(requestId);
  if (!current || current.stage === 'failed') return;
  aborters.get(requestId)?.abort();
  aborters.delete(requestId);
  entries.set(requestId, { ...current, stage: 'failed', slow: false, error });
  emit();
}

/** The server confirmed it, or the user took it back: forget it everywhere. */
export function settleSend(requestId: string): OutboxEntry | undefined {
  const current = entries.get(requestId);
  if (!current) return undefined;
  entries.delete(requestId);
  runners.delete(requestId);
  editContexts.delete(requestId);
  aborters.get(requestId)?.abort();
  aborters.delete(requestId);
  forgetUnsent(requestId);
  emit();
  return current;
}

/** Takes a send back for editing: its text, files and rewind, and it is forgotten. */
export function withdrawSend(requestId: string): { entry: OutboxEntry; context: SendEditContext } | null {
  const context = editContexts.get(requestId) ?? { files: [], rewind: null };
  const entry = settleSend(requestId);
  return entry ? { entry, context } : null;
}

export function canRetrySend(entry: OutboxEntry, now = Date.now()): boolean {
  return entry.firstSentAt === null || now - entry.firstSentAt < SEND_RETRY_WINDOW_MS;
}

export function setSendDispatcher(next: ((requestId: string) => void) | null): void {
  dispatcher = next;
}

/** Without a driver mounted (mid re-render), the send waits; the driver's clock picks it up. */
export function dispatchSend(requestId: string): void {
  if (dispatcher) dispatcher(requestId);
  else updateSend(requestId, { stage: 'waiting' });
}

/** A send whose frame is ready at once, such as a queued message: opened, framed and delivered. */
export function deliverNow(frame: ChatSendFrame, projectId: string | null): void {
  openSend({
    requestId: frame.requestId,
    sessionId: frame.sessionId,
    projectId,
    content: frame.content,
    stage: 'waiting',
    attachmentCount: 0,
  }, null);
  setSendFrame(frame.requestId, frame);
  dispatchSend(frame.requestId);
}

/** Retry keeps the request id, so a copy that did arrive is confirmed rather than run again. */
export function retrySend(requestId: string): void {
  const current = entries.get(requestId);
  if (!current || current.stage !== 'failed' || !canRetrySend(current)) return;
  entries.set(requestId, {
    ...current,
    stage: current.frame ? 'sending' : current.sessionId ? 'uploading' : 'creating',
    startedAt: Date.now(),
    sentAt: null,
    slow: false,
    probed: false,
    error: null,
  });
  emit();
  if (current.frame) {
    dispatchSend(requestId);
  } else {
    void runners.get(requestId)?.();
  }
}

export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useOutboxEntry(requestId: string | null): OutboxEntry | undefined {
  return useSyncExternalStore(
    subscribeOutbox,
    () => (requestId ? entries.get(requestId) : undefined),
  );
}

/** A send to this session is still on its way, so its run has not started. */
export function useHasPendingSend(sessionId: string | null): boolean {
  return useSyncExternalStore(subscribeOutbox, () => {
    if (!sessionId) return false;
    for (const entry of entries.values()) {
      if (entry.sessionId === sessionId && entry.stage !== 'failed') return true;
    }
    return false;
  });
}

/*
 * Unconfirmed text survives the page: a send Android killed mid-flight comes back
 * in the composer. Records are shared by every tab, so the owning page refreshes
 * `seenAt` while it lives; only a record nobody has refreshed is an orphan.
 */

const UNSENT_KEY = 'clide:unsent-sends:v1';
const UNSENT_MAX_AGE_MS = 24 * 60 * 60_000;
export const UNSENT_HEARTBEAT_MS = 30_000;
const UNSENT_ORPHAN_AFTER_MS = 3 * UNSENT_HEARTBEAT_MS;
const PAGE_ID = mintRequestId();

type UnsentRecord = {
  requestId: string;
  projectId: string | null;
  content: string;
  at: number;
  ownerId?: string;
  seenAt?: number;
};

function readUnsent(): UnsentRecord[] {
  try {
    const parsed = JSON.parse(safeLocalStorage.getItem(UNSENT_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - UNSENT_MAX_AGE_MS;
    return parsed.filter((record): record is UnsentRecord =>
      typeof record?.requestId === 'string' && typeof record?.content === 'string' && record.at > cutoff);
  } catch {
    return [];
  }
}

function writeUnsent(records: UnsentRecord[]): void {
  if (records.length === 0) safeLocalStorage.removeItem(UNSENT_KEY);
  else safeLocalStorage.setItem(UNSENT_KEY, JSON.stringify(records));
}

function rememberUnsent(requestId: string): void {
  const entry = entries.get(requestId);
  if (!entry || !entry.projectId || !entry.content.trim()) return;
  const records = readUnsent().filter((record) => record.requestId !== requestId);
  records.push({
    requestId,
    projectId: entry.projectId,
    content: entry.content,
    at: entry.startedAt,
    ownerId: PAGE_ID,
    seenAt: Date.now(),
  });
  writeUnsent(records);
}

/** The owning page is alive: keeps its records from being taken by another tab. */
export function touchUnsent(now = Date.now()): void {
  const records = readUnsent();
  let changed = false;
  for (const record of records) {
    if (record.ownerId === PAGE_ID && entries.has(record.requestId)) {
      record.seenAt = now;
      changed = true;
    }
  }
  if (changed) writeUnsent(records);
}

function forgetUnsent(requestId: string): void {
  const records = readUnsent();
  const kept = records.filter((record) => record.requestId !== requestId);
  if (kept.length !== records.length) writeUnsent(kept);
}

/**
 * Text of this project's sends left unconfirmed by a page that is gone, removed
 * as it is returned. A send another live tab still refreshes is not an orphan.
 */
export function takeOrphanedUnsent(projectId: string, now = Date.now()): string | null {
  const records = readUnsent();
  const orphans = records.filter((record) => record.projectId === projectId
    && !entries.has(record.requestId)
    && (record.ownerId === PAGE_ID || now - (record.seenAt ?? record.at) >= UNSENT_ORPHAN_AFTER_MS));
  if (orphans.length === 0) return null;
  writeUnsent(records.filter((record) => !orphans.includes(record)));
  return orphans.map((record) => record.content).join('\n\n');
}

/** Test-only: drop every entry and the dispatcher. */
export function resetOutboxForTests(): void {
  entries.clear();
  runners.clear();
  editContexts.clear();
  for (const controller of aborters.values()) controller.abort();
  aborters.clear();
  dispatcher = null;
  safeLocalStorage.removeItem(UNSENT_KEY);
  emit();
}
