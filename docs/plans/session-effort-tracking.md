# Per-session effort follows the conversation

- Status: phase 1 done
- Next: phase 2 — make `SessionSlot` the one owner of model and effort, and
  remove the duplicate `/active-model` fetch in `useChatProviderState`.
- Context: [session/model anchors](../maps/code-anchors.md);
  [provider capabilities](../maps/clide-provider-capability-map.md);
  [ADR 0003](../decisions/0003-per-session-model-tracking.md);
  [ADR 0025](../decisions/0025-session-model-picks-live-in-the-database.md).

## Phases

- [x] **1. Give effort durable session ownership.** Add nullable `effort` and
      `effort_updated_at` columns through the schema and migration system, plus
      provider-scoped repository reads and writes. Add provider-neutral
      requested/effective effort types and a resolver with the same recency
      rule as model: a newer explicit pick wins until a later provider turn
      supplies better evidence. Claude's transcript `effort` and Codex
      `turn_context` effort are effective truth; an adapter without reliable
      turn evidence must report only the stored request or provider default,
      never invent effective state. Cursor remains unsupported through the
      capability contract.
- [ ] **2. Make one client store own model and effort.** Extend `SessionSlot`
      with effort value, source, loading state, and fetch timestamp; remove the
      duplicate active-model fetch in `useChatProviderState` at the same time
      so display and send read one session-settings owner. Keep provider-level
      model and effort values only as fresh-chat seeds. Promote the effort seed
      onto the row when the app allocates the first session ID; on an existing
      session, omit effort while its settings are unresolved so the backend
      resolves the row/transcript instead of leaking another session's value.
- [ ] **3. Persist deliberate choices without slider-write races.** Add thin
      effort read/write routes backed by the resolver, save keyboard/click
      choices immediately, and separate drag preview from pointer-release
      commit so moving across the effort track does not issue competing writes.
      Reconcile a stored effort when a model change makes it invalid, preserve
      an explicit `default` choice, and snapshot the resolved per-session
      effort into queued turns. After a successful model or effort change,
      show one non-blocking message: **Changing model or effort may reduce
      cached-input reuse on the next turn.** Do not claim that the conversation
      or cache was erased.
- [ ] **4. Prove isolation, precedence, and degradation.** Cover migration,
      provider/id scoping, pick-versus-transcript timestamps, fresh-session
      promotion, stale fetches, session switching, refresh, queued sends,
      model/effort compatibility, unsupported providers, and two clients
      reading the same row. Run the provider/session contract suite and builds,
      then live-test Codex and Claude in the installed PWA with Grayson; keep
      automated checks, running-service state, and personal acceptance as
      separate gates.

## Done when

- Session A set to Medium and session B set to High each display and send their
  own effort after repeated switching, refresh, and opening from another
  browser; neither temporarily falls back to the other's provider seed.
- A picker change survives before the next turn, while a newer native-provider
  turn can supersede that request wherever the provider records effective
  effort.
- A brand-new chat still inherits the provider seed, then owns that effort from
  the moment its stable CLIde session ID is allocated.
- Display, immediate sends, and queued sends use the same session-owned model
  and effort state, including while a settings request is in flight.
- Model or effort changes show the cache-reuse notice without implying lost
  conversation context, and effort controls remain absent for unsupported
  providers.

## Not doing

- Synchronizing CLIde's picker with a separately running provider Shell.
- Preserving or clearing provider prompt caches, or promising a cache hit.
- Moving permission, collaboration mode, or tool settings into this change.
- Adding effort support to a provider that does not expose it, or changing the
  providers' existing model/effort wire formats.
