# 0067 — Chat messages are one typed shape, shared by server and client

- Date: 2026-10-05
- Status: Proposed

`NormalizedMessage` moves to `shared/chat-protocol/` as a union of saved row kinds (text, thinking, tool call and result, error, compaction, …) and a union of live-only events, each kind carrying only its own fields, imported by both server and client; history, live frames and the agent API all carry these shapes, and the catch-all index signature goes.
It is typed in place: the client's hand-copied type in `useSessionStore.ts` is deleted, `ChatMessage` is typed from the union, and the store's pagination, scroll restoration and reconciliation stay as they are.
Rejected: a second event model replacing the client store, which both branch drafts proposed, deleting about 2,500 lines and 132 tests with no plan for scrolling, history loading or ADR 0056; and leaving the shape untyped, whose hand copy has already drifted (4 fields only on the client, 2 only on the server).
A row keeps one id from live to reload, because React keys, scroll anchors, rewind, Find and history bookmarks all key on it; streamed text, which gets a random id today, is the one case to fix.
The envelope carries a version so an outdated browser is told to reload, and every frame the SDK can send, including ones outside its own type union such as `command_lifecycle`, has a typed home or a recorded drop, so an SDK update that adds a message type fails the type check instead of vanishing.
