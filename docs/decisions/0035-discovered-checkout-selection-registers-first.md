# 0035 — Discovered checkout selection registers first

- Date: 2026-08-12
- Status: Accepted

## Decision

A discovered worktree remains visible in the New Session picker, labelled NOT
ADDED. Selecting it runs the existing Add operation first and targets the
registered project returned by that operation; its synthetic discovery id never
reaches chat routing. A failed Add leaves the picker open and shows the error.

## Rejected

Hiding discovered worktrees would make the picker disagree with the Worktrees
panel, while selecting their synthetic ids would violate ADR 0033.

## Why

New Session is the shortest path from finding a checkout to working in it, and
registration is the boundary that gives the checkout a stable CLIde project id.
