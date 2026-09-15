import express from 'express';

import { scheduledMessagesDb, sessionsDb, type ScheduledMessageRow } from '@/modules/database/index.js';
import {
  cancelScheduledMessage,
  createScheduledMessage,
  holdScheduledMessage,
  listScheduledMessagesForSession,
  readScheduledMessageAttachments,
  releaseScheduledMessageHold,
  renewScheduledMessageHold,
  saveScheduledMessageEdit,
} from '@/modules/scheduled-messages/services/scheduled-message-runtime.service.js';

const router = express.Router();

/** Rows go out camel-cased, matching every other session-shaped payload. */
function serialize(row: ScheduledMessageRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    provider: row.provider,
    content: row.content,
    trigger: row.trigger_kind,
    scheduledFor: row.scheduled_for,
    state: row.state,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    firedAt: row.fired_at,
    attachments: readScheduledMessageAttachments(row),
  };
}

const readToken = (body: unknown): string => {
  const token = (body as { token?: unknown } | undefined)?.token;
  return typeof token === 'string' ? token : '';
};

/** The sidebar's timer column: which sessions are waiting on something. */
router.get('/pending-sessions', (_req, res) => {
  res.json({ sessionIds: scheduledMessagesDb.listSessionIdsWithPending() });
});

router.get('/session/:sessionId', (req, res) => {
  const messages = listScheduledMessagesForSession(req.params.sessionId).map(serialize);
  res.json({ messages });
});

router.post('/', (req, res) => {
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  const trigger = req.body?.trigger === 'usage-reset' ? 'usage-reset' as const : 'time' as const;
  const scheduledFor = typeof req.body?.scheduledFor === 'string' ? req.body.scheduledFor : null;

  if (!sessionId || !content) {
    res.status(400).json({ error: 'sessionId and content are required.' });
    return;
  }

  // The provider comes from the session row, never from the client: it decides
  // which usage reset the message waits on.
  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    res.status(404).json({ error: `Session "${sessionId}" was not found.` });
    return;
  }

  if (trigger === 'time') {
    const dueAt = Date.parse(scheduledFor ?? '');
    if (!Number.isFinite(dueAt)) {
      res.status(400).json({ error: 'A time trigger needs a valid scheduledFor instant.' });
      return;
    }
    if (dueAt <= Date.now()) {
      res.status(400).json({ error: 'scheduledFor must be in the future.' });
      return;
    }
  }

  const row = createScheduledMessage({
    sessionId,
    provider: session.provider,
    content,
    options: req.body?.options,
    trigger,
    scheduledFor,
  });

  res.status(201).json({ message: serialize(row) });
});

/** Opens an edit: the message stays pending but cannot fire until the hold ends. */
router.post('/:id/hold', (req, res) => {
  const held = holdScheduledMessage(req.params.id);
  if (!held) {
    res.status(409).json({ error: 'That message is no longer pending.' });
    return;
  }
  res.json({ token: held.token, heldUntil: held.row.held_until, message: serialize(held.row) });
});

router.put('/:id/hold', (req, res) => {
  if (!renewScheduledMessageHold(req.params.id, readToken(req.body))) {
    res.status(409).json({ error: 'That message was sent, cancelled, or opened elsewhere.' });
    return;
  }
  res.json({ renewed: true });
});

router.delete('/:id/hold', (req, res) => {
  if (!releaseScheduledMessageHold(req.params.id, readToken(req.body))) {
    res.status(409).json({ error: 'That message was sent, cancelled, or opened elsewhere.' });
    return;
  }
  res.json({ released: true });
});

/** Saves an open edit; the message keeps its trigger. */
router.patch('/:id', (req, res) => {
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!content) {
    res.status(400).json({ error: 'content is required.' });
    return;
  }
  const row = saveScheduledMessageEdit(req.params.id, readToken(req.body), {
    content,
    options: req.body?.options,
  });
  if (!row) {
    res.status(409).json({ error: 'That message was sent, cancelled, or opened elsewhere.' });
    return;
  }
  res.json({ message: serialize(row) });
});

router.delete('/:id', (req, res) => {
  if (!cancelScheduledMessage(req.params.id)) {
    res.status(409).json({ error: 'That message is no longer pending.' });
    return;
  }
  res.json({ cancelled: true });
});

export default router;
