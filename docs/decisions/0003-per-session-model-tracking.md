# 0003 — Active model is tracked per session; transcript is ground truth

- Date: 2026-07-21
- Status: Accepted

## Decision

The model a session is running is tracked per session, not as one global
selection. The session transcript (the model recorded on real assistant turns)
is the ground truth for what a session's active model is; the client-side
selection is only a seed for *new* sessions and a cache for display.

## Rejected

The upstream approach: a single global "selected model" key that both seeds new
sessions and is displayed as the current model for whatever session is open.

## Why

A global key is simply wrong once sessions are long-lived and resumable: two
sessions can run different models, and the model can change *inside* a session
through paths that never touch the UI picker (Shell-side `/model`, fast-mode
toggling). Any cached value therefore goes stale; only the transcript reflects
what actually ran, which is why resume logic derives the model from it
(`resolveResumeModel`) rather than trusting the stored selection. Introduced in
`8771eea`. The subsystem is still evolving — see TODO.md "Model picker
follow-ups" for known-open bugs before touching it.
