# 0062 — Chat activity and metadata text scale with the reading size

- Date: 2026-09-30
- Status: Accepted; supersedes the "metadata keeps fixed metrics" part of [0043](0043-reading-size-is-content-scoped-and-device-local.md)

Chat text that is not a message has two roles: activity rows (`text-chat-activity`) and metadata such as timestamps, notices, citations and the compaction divider (`text-chat-meta`), both in `text-muted-foreground`.
Both sizes are fixed offsets from `--chat-prose-size`, so a reading-size preset moves them with the messages; at the default preset they reproduce the earlier 13/14px rows and 12px metadata.
Fixed metadata let the "smallest" phone preset shrink message text to the activity-row size, erasing the hierarchy, and left five sizes and two grey systems in use.
The composer, tool output (mono detail and diffs), editor and terminal still keep fixed metrics, as 0043 decided.
The older standalone tool panels (to-do and task lists, plans, question forms) have not adopted the roles yet.
