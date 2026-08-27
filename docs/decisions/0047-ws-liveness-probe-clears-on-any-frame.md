# 0047 — The liveness probe clears on any inbound frame, not a matching echo

- Date: 2026-08-27
- Status: Accepted

## Decision

The client-driven liveness watchdog treats any inbound frame as proof the
socket is alive. It does not require the echo matching the probe it sent.

## Rejected

Matched echoes — the watchdog tracks each probe by id and clears only on the
reply carrying that id.

## Why

Matched echoes detect one narrow extra failure: a server that still emits
traffic while the path serving this session is dead. Every part of the observed
failure — dead Stop, frozen "thinking", the wall of missed messages on
reconnect — is already handled by ADR 0006's four mechanisms, so the stricter
rule buys a case that has not occurred here. It costs on the failure mode that
has: a phone on a slow or switching link, where a probe reply can arrive late
or out of order while data keeps flowing, and a strict watchdog reads that as
death and tears down a working connection. Sensitivity is not free when the
primary client is mobile.

## Consequence

A half-open socket that keeps producing unrelated traffic will not be detected
by the watchdog alone; it is caught by the server heartbeat instead. Anyone
tightening this rule should first establish that the permissive one actually
missed a failure in use, not in theory.
