# CLIde Tool Activity Display — Investigation Handoff

## Purpose

Investigate a cleaner way for CLIde to display agent tool activity in chat, especially when Claude or Codex perform many reads, searches, shell commands, or other repeated operations.

The current UI reduces some repetition by grouping consecutive calls of the same tool, but it still exposes too much low-level execution machinery and often produces summaries that are technically accurate but not useful to a human reader.

**Do not jump straight into implementation.** First verify the current data available from each provider, inspect the existing grouping/rendering pipeline, and determine what semantic activity model is realistically supportable.

---

## Current CLIde Behavior

Relevant areas already identified:

- `src/components/chat/utils/toolGrouping.ts`
- `src/components/chat/view/subcomponents/ToolGroupContainer.tsx`
- `src/components/chat/tools/ToolRenderer.tsx`
- `src/components/chat/tools/configs/toolConfigs.ts`

Current grouping behavior:

- Groups consecutive tool-use messages.
- Only groups calls when they use the **same `toolName`**.
- Grouping threshold is currently `2`.
- Hidden reasoning can be skipped so it does not interrupt otherwise consecutive tool calls.
- Group headers show:
  - tool type
  - count (`xN`)
  - previews derived from the first few tool inputs

Example:

```text
Bash x24 / node -e ..., cat > ..., +22 more
```

This compresses repeated syntax, but not the meaning of the activity.

---

## Main UX Problem

CLIde currently groups by **tool identity** rather than **user-meaningful activity**.

For example:

```text
Glob
Grep
Read
Read
Grep
Bash
Read
```

may all represent one coherent task:

```text
Exploring the usage implementation
```

The user usually does not need every read/search/process call presented as a first-class chat item.

The raw tool stream is useful as telemetry and for debugging, but it should not dominate the conversation.

---

## Important Existing Data

### Claude

Claude Bash tool calls can include a `description`.

`ToolRenderer.tsx` already extracts and passes this through to `BashCommandDisplay`.

Example:

```text
Check Claude OAuth token expiry times
```

However, `ToolGroupContainer.tsx` currently builds its collapsed preview using tool config values/titles and does not appear to use this secondary description.

Investigate whether this useful descriptive data can be preserved in grouped/semantic activity summaries.

### Codex

Codex command execution data does not appear to provide an equivalent per-command natural-language `description`.

Its structured command execution data primarily includes fields such as:

- command
- aggregated output
- exit code
- status

Codex does separately emit reasoning/summary-like activity text.

Investigate whether those messages can safely inform an activity heading without incorrectly binding reasoning text to a specific tool call.

Do **not** assume a 1:1 relationship unless the event ordering/data model guarantees one.

---

## External UX Direction

Modern coding-agent interfaces increasingly treat low-level tool calls as **progress/activity**, not normal conversation content.

Common patterns include:

- collapsing repeated reads/searches
- summarizing exploration
- emphasizing file edits, commands, approvals, failures, and final results
- allowing deeper expansion when the user wants raw detail
- offering different conversation-density levels

A useful conceptual target is:

```text
Explored usage implementation
7 files · 5 searches

Ran 3 checks
3 commands · 1.8s

Edited 4 files
```

rather than:

```text
Read
Read
Grep
Glob
Bash
Bash
Edit
Edit
```

---

## Proposed Information Hierarchy

Aim toward three levels:

### 1. Activity summary

The default transcript representation.

Examples:

```text
Explored usage implementation
7 files · 5 searches
```

```text
Ran 3 checks
```

```text
Edited 4 files
```

### 2. Operations

Visible when the activity block is expanded.

Example:

```text
Read    useProviderUsage.ts
Read    claude-usage.provider.ts
Grep    "stale" in server/modules
Grep    "refresh token" in docs/
Read    upstream-candidates.md
```

### 3. Raw details

Optional deeper disclosure.

Examples:

- full shell command
- stdout/stderr
- complete search results
- raw parameters
- full diff

The desired hierarchy is:

```text
activity → operation → raw detail
```

rather than:

```text
tool group → tool card → output
```

---

## Progressive Collapse

Investigate whether activity blocks can remain informative while work is happening, then compact themselves once finished.

Example while active:

```text
Exploring usage implementation…
Read  useProviderUsage.ts
```

Then:

```text
Exploring usage implementation…
Grep  "refresh token" in server/modules
```

After completion:

```text
Explored usage implementation
7 files · 5 searches · 12s
```

This keeps the user informed during execution without leaving a large amount of historical UI clutter behind.

---

## Semantic Activity Categories

Do not necessarily group every tool the same way.

Potential categories:

### Exploration / observation

Likely safe to collapse aggressively:

- Read
- Grep
- Glob
- directory listing
- code search
- metadata inspection
- web/document lookup where applicable

Potential summary:

```text
Explored authentication flow
8 files · 4 searches
```

### Checks / diagnostics

Examples:

- `git status`
- `rg`
- small inspection scripts
- tests
- type checks
- lint
- build validation

Potential summary:

```text
Ran 4 checks
```

Some shell commands may belong here rather than under a generic `Bash` group.

### Changes

Should remain prominent:

- Edit
- Write
- ApplyPatch
- migrations
- dependency changes
- commits

Potential summary:

```text
Edited 4 files
```

Diffs should remain easy to access.

### High-attention events

Should **not** disappear into generic activity summaries:

- permission requests
- user questions
- failures
- warnings
- denied actions
- destructive operations
- commands requiring attention
- unresolved errors

These should remain first-class transcript events.

---

## Provider-Neutral UX

The UI should not depend on Claude-specific metadata.

Use provider-specific fields as enhancements, not requirements.

Example:

- Claude Bash description available → show it.
- Codex description unavailable → derive a useful fallback from the command/category.
- Reasoning text may improve activity headings when safely associated.

The same semantic activity model should work for:

- Claude
- Codex
- future providers

---

## Responsive Behavior

Keep the same mental model across compact/mobile, medium/tablet, and expanded/desktop layouts.

Do not create separate provider/activity paradigms per viewport.

Suggested direction:

### Mobile

Prefer a compact single-row activity summary:

```text
Explored usage implementation    7 files · 5 searches
```

Expanded content should remain dense and avoid nested large cards.

### Desktop

Can afford slightly richer summaries:

```text
Explored usage implementation
7 files · 5 searches · 12s
```

Potentially show the current operation while active.

The semantics should remain identical between layouts; only density should change.

---

## Conversation Density

Architect the renderer so different levels of detail could eventually be supported, even if only one ships initially.

Possible modes:

### Normal

Recommended default.

- semantic activity summaries
- changes visible
- failures visible
- permissions visible
- raw machinery collapsed

### Detailed

Debug-oriented.

- individual tool operations visible
- descriptions visible
- raw commands/output easier to inspect

### Summary

Highly compact.

- assistant prose
- meaningful changes
- failures
- approvals
- final results

Do not add this setting merely because other apps have one. First ensure the underlying activity model supports it cleanly.

---

## Questions to Investigate

### Data / provider adapters

1. What exact fields does Claude currently send for:
   - Bash
   - Read
   - Grep
   - Glob
   - Edit / Write
   - reasoning / status text?

2. What exact fields does Codex currently send for:
   - command execution
   - file reads/searches
   - edits
   - reasoning
   - progress/status events?

3. Are there stable event IDs, parent IDs, turn IDs, or timestamps that can associate reasoning with subsequent operations?

4. Does CLIde discard useful provider metadata before the renderer receives it?

5. Is any useful Codex activity/description data present in the raw provider stream but currently normalized away?

### Grouping model

6. Should grouping happen:
   - during provider normalization,
   - while constructing chat messages,
   - or only at render time?

7. What defines one activity cluster?

Potential signals:

- consecutive observational tools
- same assistant turn
- nearby timing
- reasoning/progress message boundary
- tool category
- file/path similarity
- explicit provider metadata

8. What events must always terminate an activity cluster?

Potential examples:

- assistant prose
- user question
- permission request
- error
- edit
- destructive command
- subagent boundary

9. How should mixed runs such as this behave?

```text
Grep
Read
Read
Bash: rg ...
Read
Glob
```

Should the shell search remain part of `Explored`, or become a separate `Ran command` activity?

### UI

10. What is the minimum useful information for a collapsed activity?

Possible fields:

- activity verb/title
- file count
- search count
- command count
- edit count
- duration
- status
- failure indicator

11. Should active blocks show only the most recent operation or several?

12. Should completed activities auto-collapse?

13. How should errors inside an otherwise successful activity be surfaced?

14. Should expanded activity rows reuse existing tool renderers or use a new compact operation-row renderer?

Avoid simply nesting the current large tool cards inside another activity container.

---

## Likely Architectural Direction

A promising direction is to introduce an intermediate semantic representation above raw tool messages.

Conceptually:

```ts
ActivityGroup {
  type: 'exploration' | 'checks' | 'changes' | 'other'
  title?: string
  status: 'running' | 'completed' | 'error'
  operations: ActivityOperation[]
  startedAt?: ...
  completedAt?: ...
}
```

Each provider still emits raw tool events.

CLIde normalizes those into provider-neutral operations, then groups suitable operations into semantic activities.

The renderer displays the semantic activity by default and retains access to raw tool detail underneath.

Do not treat this sketch as the required implementation. Verify whether it fits the existing chat architecture before introducing new abstraction.

---

## Recommended Investigation Outcome

The investigation should finish with:

1. A map of the exact activity-related fields available from Claude and Codex.
2. Identification of any currently discarded useful metadata.
3. A proposed provider-neutral operation schema, if justified.
4. Clear grouping rules with examples and edge cases.
5. A compact mobile and expanded desktop rendering proposal.
6. A decision on whether progressive auto-collapse is practical.
7. A decision on whether existing `ToolGroupContainer` can evolve into this model or should be replaced.
8. A scoped implementation plan.

The central design principle:

> **Do not present the agent's raw API/tool-call stream as the conversation. Translate it into a human-readable activity timeline while keeping raw details inspectable.**
