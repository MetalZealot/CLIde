/**
 * Every composer send from the press of Send until the server confirms it
 * (`chat_input_accepted` with the same `requestId`). The bubble's stage label,
 * the activity line's deferral, resend-on-reconnect and the two-minute give-up
 * all read this one record. Upload and session creation happen in the
 * composer; the delivery itself belongs to `useSendOutboxDriver`.
 */
import { useSyncExternalStore } from 'react';

import { safeLocalStorage } from '../components/chat/utils/chatStorage';

export type SendStage = 'uploading' | 'creating' | 'waiting' | 'sending' | 'failed';

export type ChatSendFrame = {
  type: 'chat.send';
  sessionId: string;
  requestId: string;
  content: string;
  options: Record<string, unknown>;
};

export type OutboxEntry = {
  requestId: string;
  /** Null until a brand-new chat has its session. */
  sessionId: string | null;
  projectId: string | null;
  content: string;
  stage: SendStage;
  attachmentCount: number;
  /** Start of the give-up window; Retry restarts it. */
  startedAt: number;
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

const entries = new Map<string, OutboxEntry>();
const listeners = new Set<() => void>();
/** Re-runs a send that failed before its frame existed (upload or session creation). */
const runners = new Map<string, () => Promise<void>>();
const aborters = new Map<string, AbortController>();
/** The composer's own files, so Edit hands back exactly what was attached. */
const attachedFiles = new Map<string, File[]>();
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
  run: () => Promise<void>,
  files: File[] = [],
): void {
  entries.set(entry.requestId, {
    ...entry,
    startedAt: Date.now(),
    frame: null,
    sentAt: null,
    slow: false,
    probed: false,
    error: null,
  });
  runners.set(entry.requestId, run);
  if (files.length > 0) attachedFiles.set(entry.requestId, files);
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
  attachedFiles.delete(requestId);
  aborters.get(requestId)?.abort();
  aborters.delete(requestId);
  forgetUnsent(requestId);
  emit();
  return current;
}

/** Takes a send back for editing: its text and files, and it is forgotten. */
export function withdrawSend(requestId: string): { entry: OutboxEntry; files: File[] } | null {
  const files = attachedFiles.get(requestId) ?? [];
  const entry = settleSend(requestId);
  return entry ? { entry, files } : null;
}

export function setSendDispatcher(next: ((requestId: string) => void) | null): void {
  dispatcher = next;
}

export function dispatchSend(requestId: string): void {
  dispatcher?.(requestId);
}

/** Retry keeps the request id, so a copy that did arrive is confirmed rather than run again. */
export function retrySend(requestId: string): void {
  const current = entries.get(requestId);
  if (!current || current.stage !== 'failed') return;
  entries.set(requestId, {
    ...current,
    stage: current.frame ? 'sending' : current.attachmentCount > 0 ? 'uploading' : 'creating',
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

/* Unconfirmed text survives the page: a send Android killed mid-flight comes back in the composer. */

const UNSENT_KEY = 'clide:unsent-sends:v1';
const UNSENT_MAX_AGE_MS = 24 * 60 * 60_000;

type UnsentRecord = { requestId: string; projectId: string | null; content: string; at: number };

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
  if (!entry || !entry.content.trim()) return;
  const records = readUnsent().filter((record) => record.requestId !== requestId);
  records.push({ requestId, projectId: entry.projectId, content: entry.content, at: entry.startedAt });
  writeUnsent(records);
}

function forgetUnsent(requestId: string): void {
  const records = readUnsent();
  const kept = records.filter((record) => record.requestId !== requestId);
  if (kept.length !== records.length) writeUnsent(kept);
}

/**
 * Text of this project's sends left unconfirmed by an earlier page, removed as
 * it is returned. Sends still tracked by this page are not orphans.
 */
export function takeOrphanedUnsent(projectId: string): string | null {
  const records = readUnsent();
  const orphans = records.filter((record) => record.projectId === projectId && !entries.has(record.requestId));
  if (orphans.length === 0) return null;
  writeUnsent(records.filter((record) => !orphans.includes(record)));
  return orphans.map((record) => record.content).join('\n\n');
}

/** Test-only: drop every entry and the dispatcher. */
export function resetOutboxForTests(): void {
  entries.clear();
  runners.clear();
  attachedFiles.clear();
  for (const controller of aborters.values()) controller.abort();
  aborters.clear();
  dispatcher = null;
  safeLocalStorage.removeItem(UNSENT_KEY);
  emit();
}
