# 0043 — Reading size is content-scoped and device-local

- Date: 2026-08-21
- Status: Accepted

## Decision

Compact, Default, and Large scale ordinary user and assistant content while
interface chrome, tools, metadata, the composer, editor, and terminal keep fixed
metrics. The choice is stored per browser because phone and desktop readability
needs differ.

## Rejected

A global interface scale would couple dense navigation and technical output to
long-form reading, while an unconstrained slider could create incoherent size,
line-height, paragraph, and code combinations.

## Why

The Typography Studio showed that 15px phone prose restores cohesion with the
sidebar while the existing 14px desktop prose already feels balanced. Presets
coordinate the dependent metrics and keep future font-family changes separate.
