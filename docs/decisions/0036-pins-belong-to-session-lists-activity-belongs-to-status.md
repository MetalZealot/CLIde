# 0036 — Pins belong to session lists; activity belongs to status

- Date: 2026-08-14
- Status: Accepted

## Decision

Projects keep pinned sessions inside their repository and Sessions presents one flat list with all pins first; neither uses a Pinned section.
Activity renders no duplicate session list: repository and session symbols identify it in the expanded sidebar, while the collapsed rail retains its aggregate signal.

## Rejected

Retaining or relabelling the two global sections was rejected because their identical rows concealed opposite copy-versus-move behaviour.

## Why

The existing hierarchy already locates active work through repository roll-ups and exact session symbols, and the pin icon plus stable leading position communicates persistence without another label.
