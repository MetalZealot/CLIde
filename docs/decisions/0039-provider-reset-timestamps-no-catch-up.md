# 0039 — Usage reset alerts follow provider timestamps without catch-up

- Date: 2026-08-16
- Status: Accepted

## Decision

Usage reset alerts are scheduled from provider-issued reset timestamps, coalesced per provider and minute, and recorded before delivery so a restart cannot duplicate them. Resets already past when the server starts are skipped rather than replayed.

## Rejected

Local countdown inference and catch-up alerts after downtime were rejected because neither proves that a provider reset occurred while CLIde was offline.

## Why

Provider timestamps are the strongest available account-level fact and remain usable if a later usage refresh fails or an OAuth access token expires. Persisting observed and notified identities in user-keyed application configuration provides restart safety without a database migration.
