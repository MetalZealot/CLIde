# Complete, provider-correct chat exports

- Status: complete
- Next: source and focused export tests are the current authority
- Context: client-only; the normalized chat message model is the export boundary

## Phases

- [x] 1. Markdown, HTML and PDF share provider-correct labels and opt-in tool-call, tool-result and reasoning content
- [x] 2. Export loads the complete session instead of silently using only the pages already in memory
- [x] 3. Focused automated checks passed and Grayson accepted the live export behavior

## Done when

- A Codex session labels assistant turns `Codex`, never `Claude`; every other provider uses its own localized label.
- Tool calls, tool results and reasoning are independently deliberate: calls and results are off by default, results require calls, and reasoning is off by default.
- Exporting a paginated session first loads its complete normalized history and reports a preparation failure instead of downloading a partial file.
- Markdown, HTML and PDF contain the same selected conversation entries, with tool payloads rendered safely.

## Not doing

- Reconstructing exact per-message model history, exporting provider-native transcript records, or embedding attachment binaries.
