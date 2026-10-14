# 0081 — A finished plan becomes a card in the chat

- Date: 2026-10-13
- Status: Accepted; supersedes 0078 for a finished plan

## Decision

When a plan finishes, the banner leaves and a collapsed card holding the plan
sits after the work it finished in, above the turn's reply; each finished plan keeps its own
card, rebuilt from the transcript's plan calls. The newest plan takes step names
missing from the loaded page from the provider's stored copy; an older plan the
loaded page cannot name has no card, and one never named keeps 0078's muted banner.

## Rejected

Keeping the finished banner until the next plan (0078), which held 40px for the
rest of the session and lost the plan once replaced; dropping it on the next
prompt, which still lost it.

## Why

The maintainer chose it (2026-10-13) so a new plan never throws an old one away.
