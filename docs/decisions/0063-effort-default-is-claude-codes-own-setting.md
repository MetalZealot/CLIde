# 0063 — A chat's Default effort is Claude Code's own per-model setting

- Date: 2026-09-30
- Status: Accepted

When a chat names no effort, CLIde sends none, so Claude Code runs the level saved for that model under `modelSettings.<model>.effortLevel` — the setting its own effort slider writes — or the model's built-in default.
The picker shows that resolved level as the Default stop instead of a separate "Default" stop, and picking that level stores `default` (no override), so the chat keeps following the setting if it later changes.
Settings › Claude › Default Effort writes the same key, so Shell and Chat cannot drift; `max` is session-only in Claude Code and is never written.
A new chat always starts on Default: the effort seed is deliberately not persisted, so a level picked in one chat never becomes every later chat's.
Providers that cannot resolve their default (Codex, OpenCode) omit `effort.resolvedDefault` and keep the separate Default stop.
