# 0061 — Follow installed provider CLIs

- Date: 2026-09-22
- Status: Accepted; supersedes runtime selection policy in [0034](0034-codex-managed-native-runtime.md)

Claude and Codex follow their configured installed launcher, including installer-managed symlink changes, instead of requiring approval of each executable version.
Codex checks changed executables against the required App Server interface and reports incompatibility without silently using its bundled CLI.
Existing Codex fingerprint selections migrate to the configured launcher or the first discovered standalone installation; the SDK remains a separately locked application dependency.
New Session checks for updates and offers an explicit Update action for supported native installations, serialized against this server's Chat, jobs, and provider Shell sessions, with cancellation while waiting.
Active Codex work finishes before its App Server is recycled; this avoids both update-by-update manual approval and replacing a process midway through a turn.
