# 0031 — Selection follows the theme; sidebar status uses symbols

- Date: 2026-08-08
- Status: Accepted

## Decision

Selected sidebar rows continue to use `primary`, whose colour belongs to the active theme rather than to a fixed blue palette.
Running, unread-finished, and needs-attention states use distinct accessible symbols with centrally owned semantic colours instead of tinting the whole row.

## Rejected

Fixed blue selection and full-row green, amber, or gray status fills were rejected because they compete with theme colour and make selection and state share the same visual channel.

## Why

Separating a theme-relative selection surface from compact status symbols lets a green, red, or neutral theme remain coherent without changing status meaning.
Shape, motion, and accessible labels also preserve the distinction when theme and status hues happen to be similar.
