export type SidebarSessionSignals = {
  attentionSessionIds: ReadonlySet<string>;
  unreadSessionIds: ReadonlySet<string>;
};

export type SidebarSessionSignalAction =
  | { type: 'request_attention'; sessionId: string }
  | { type: 'resolve_attention'; sessionId: string; markUnread: boolean }
  | { type: 'mark_unread'; sessionId: string }
  | { type: 'view'; sessionId: string }
  | { type: 'remove'; sessionId: string };

export const createSidebarSessionSignals = (): SidebarSessionSignals => ({
  attentionSessionIds: new Set(),
  unreadSessionIds: new Set(),
});

/**
 * Pending attention follows the request lifecycle, while unread follows the
 * viewing lifecycle. Opening a session therefore clears green but never
 * clears an unresolved yellow signal.
 */
export const reduceSidebarSessionSignals = (
  state: SidebarSessionSignals,
  action: SidebarSessionSignalAction,
): SidebarSessionSignals => {
  const { sessionId } = action;

  if (action.type === 'request_attention') {
    if (state.attentionSessionIds.has(sessionId) && !state.unreadSessionIds.has(sessionId)) {
      return state;
    }

    const attentionSessionIds = new Set(state.attentionSessionIds);
    const unreadSessionIds = new Set(state.unreadSessionIds);
    attentionSessionIds.add(sessionId);
    unreadSessionIds.delete(sessionId);
    return { attentionSessionIds, unreadSessionIds };
  }

  if (action.type === 'resolve_attention') {
    const hadAttention = state.attentionSessionIds.has(sessionId);
    const unreadChanges = action.markUnread
      ? !state.unreadSessionIds.has(sessionId)
      : false;
    if (!hadAttention && !unreadChanges) {
      return state;
    }

    const attentionSessionIds = new Set(state.attentionSessionIds);
    attentionSessionIds.delete(sessionId);
    const unreadSessionIds = action.markUnread
      ? new Set(state.unreadSessionIds).add(sessionId)
      : state.unreadSessionIds;
    return { attentionSessionIds, unreadSessionIds };
  }

  if (action.type === 'mark_unread') {
    if (state.attentionSessionIds.has(sessionId) || state.unreadSessionIds.has(sessionId)) {
      return state;
    }

    const unreadSessionIds = new Set(state.unreadSessionIds);
    unreadSessionIds.add(sessionId);
    return { ...state, unreadSessionIds };
  }

  if (action.type === 'view') {
    if (!state.unreadSessionIds.has(sessionId)) {
      return state;
    }

    const unreadSessionIds = new Set(state.unreadSessionIds);
    unreadSessionIds.delete(sessionId);
    return { ...state, unreadSessionIds };
  }

  if (!state.attentionSessionIds.has(sessionId) && !state.unreadSessionIds.has(sessionId)) {
    return state;
  }

  const attentionSessionIds = new Set(state.attentionSessionIds);
  const unreadSessionIds = new Set(state.unreadSessionIds);
  attentionSessionIds.delete(sessionId);
  unreadSessionIds.delete(sessionId);
  return { attentionSessionIds, unreadSessionIds };
};
