import express from 'express';

import { scheduledMessagesDb, sessionsDb, type ScheduledMessageRow } from '@/modules/database/index.js';
import {
  cancelScheduledMessage,
  createScheduledMessage,
  listScheduledMessagesForSession,
  pauseScheduledMessage,
  readScheduledMessageAttachments,
  resumeScheduledMessage,
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

/** Opens an edit: the message stays listed but cannot send until resumed. */
router.post('/:id/pause', (req, res) => {
  const row = pauseScheduledMessage(req.params.id);
  if (!row) {
    res.status(409).json({ error: 'That message already sent or was cancelled.' });
    return;
  }
  res.json({ message: serialize(row) });
});

/** Ends an edit without changes; the message waits again on its original trigger. */
router.post('/:id/resume', (req, res) => {
  const row = resumeScheduledMessage(req.params.id);
  if (!row) {
    res.status(409).json({ error: 'That message is not paused.' });
    return;
  }
  res.json({ message: serialize(row) });
});

/** Saves an edit and puts the message back to waiting on its original trigger. */
router.patch('/:id', (req, res) => {
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!content) {
    res.status(400).json({ error: 'content is required.' });
    return;
  }
  const row = resumeScheduledMessage(req.params.id, { content, options: req.body?.options });
  if (!row) {
    res.status(409).json({ error: 'That message is not paused.' });
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
