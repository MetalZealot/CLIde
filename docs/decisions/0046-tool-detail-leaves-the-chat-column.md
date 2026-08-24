# 0046 — Tool detail leaves the chat column instead of nesting inside it

- Date: 2026-08-23
- Status: Accepted

## Decision

An activity's operation list expands inline on desktop and opens as a bottom
sheet on mobile; raw detail — file contents, diffs, command output — never
renders inside either, and on mobile routes to the existing full-screen
code-editor overlay. Back from raw detail returns to the operation list, not
to the chat.

## Rejected

Nesting all three levels inline on mobile, as claude.ai/code does today.

## Why

Nesting puts a horizontally-scrolling code block inside an accordion inside
the vertically-scrolling chat; each level eats horizontal padding until code
wraps mid-token in roughly 200px, which is the defect this rework exists to
remove. This is [ADR 0020](0020-no-plugin-exception-to-one-scroll-container.md)'s
one-scroll-container rule applied to chat: a surface that scrolls sideways has
to own the viewport. Desktop needs no sheet because the chat pane is the wide
one; the narrow-dock alternative other editors take — punting diffs to a
separate pane — is the same rule pointed sideways.
