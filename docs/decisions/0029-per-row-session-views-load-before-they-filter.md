# 0029 — A repository row's session view is per row, in memory, and loads before it filters

- Date: 2026-08-06
- Status: Accepted

## Decision

A sidebar repository row (ADR 0016) can sort and filter its own session list.
Three properties of that view are deliberate and are the thing this record
exists to protect:

- **The view belongs to the row, not to the sidebar.** Each row keys its own
  `RepositoryViewOptions` (sort, plus which checkouts to keep). There is no
  global session sort.
- **It lives in memory only.** It survives navigating into a session and back —
  which costs nothing, because the sidebar is never unmounted — and it is gone
  on refresh. Nothing is written to `localStorage` or the database.
- **A customized row loads every session it has before it answers.** Turning on
  a sort or a filter drives the row's pagination to completion first; only then
  is the view applied, and the row's own count then describes the filtered list
  rather than the server's total.

For the same reason, the row's "show more" became **"show all"**: one press
opens the row completely instead of revealing five at a time.

## Context

The server pages sessions per `project_path`, ordered `isStarred DESC` then
newest first, twenty at a time; a row shows five until asked for more. A row is
a *repository*, so its list is merged client-side across every checkout.

Applying a sort or filter to whatever happened to be loaded would therefore
produce an alphabetical list missing most of the alphabet, and a worktree filter
that reports nothing while its matches sit behind a button. The count beside the
row would go on quoting the server's unfiltered total while the list below it
showed something narrower. All three are the same defect: a control that looks
like it describes the row, but describes a page.

## Rejected

- **Filtering the loaded page and disclosing the limit.** The existing session
  *search* does this and it is defensible there — a search is understood to find
  what it can reach. A filter reads as a promise about the whole set. Given the
  real ceiling is 200 rows and the live database holds ~50 sessions in total,
  buying honesty with one extra fetch is cheap.
- **Server-side sorted and filtered pagination.** `ORDER BY` cannot be a bound
  parameter, so sort keys would need an enum-to-SQL map, and both the page query
  and its `COUNT(*)` would need the same `WHERE` or `total`/`hasMore` start
  lying. The blocker is structural, though: the server pages by `project_path`
  while a row is a repository, and a correctly-ordered repository page cannot be
  assembled by paging each checkout and merging. It needs the checkout union in
  one query — a new API shape, not a new parameter. Revisit if a single
  repository ever approaches the 200-row ceiling.
- **Keeping "show more" alongside "show all".** Two controls for one list, where
  the incremental one is busywork once the set is loaded anyway.
- **Persisting views.** A sort you set yesterday and forgot is worse than one you
  set again. Clearing on refresh also means no migration and no stale key.
- **Sorting or filtering by model.** `sessions.model` exists (ADR 0025) but is
  serialized into neither the session list (`SESSION_ROW_COLUMNS`,
  `mapSessionRowToSummary`) nor the watcher's `session_upserted` payload — the
  same two-site trap `isStarred` has. Beyond the plumbing, 260 of ~286 live rows
  carry no model at all, and `opus` and `opus[1m]` would read as two models. The
  menu would filter on an empty field. Deferred, not refused.

## Consequences

- Pinned sessions are outside this entirely. They are *moved* into the Pinned
  section rather than copied (2026-08-05), so a per-row view does not govern
  them and must not appear to.
- The filter control is shown only while its row is expanded, or whenever a view
  is active. A filtered row that is then collapsed keeps the control lit,
  because with the list hidden it is the only thing still saying the row is not
  showing everything.
- Filtering to every worktree collapses back to "no filter", so the lit state
  never claims a filter that hides nothing.
- The load-all loop is driven by an effect keyed on the row's arriving pages and
  stops when no checkout reports more. Adding another way to mark a row as
  wanting its full set means adding it to that effect's condition, not writing a
  second loop.
