# MCP scope storage collisions

- Status: not started
- Next: re-map the provider config-storage paths after the v1.37 module
  migration, then add the storage-identity comparison.
- Context: observed on Codex and Cursor · present in `upstream/main` at v1.37
  (`264e0946`), so likely upstreamable — see [`upstream-candidates.md`](../upstream-candidates.md)

A provider's *project* scope can resolve to the same configuration storage
target as its *user* scope, so one MCP server lists twice and either card can
mutate the same file.

**Fix it at the provider configuration-storage boundary, not by deduplicating
server names in the React client.** When project scope aliases user scope:
listing that project scope returns no second copy; add, edit and delete against
it fail *before* reading or writing provider configuration; the error explains
that the project scope aliases the user configuration and cannot be represented
separately; and legitimate same-name entries in genuinely distinct files stay
separate.

Keep it a small provider-layer correction with focused tests.

## Phases

- [ ] **1. Storage identity.** Compare **both** the canonical configuration path
      and the logical MCP table within it. Path-only comparison is wrong for
      Claude, whose user and local scopes deliberately share `~/.claude.json`
      while addressing different tables. A provider-local
      `{ configPath, tableKey }` is enough for the observed cases. Keep it
      provider-owned — the client must not reconstruct provider filesystem rules.
      Normalize absolute paths before comparing; resolve existing symlinks only
      if that can be done without turning a missing project config into an error,
      otherwise ship canonical lexical paths and leave symlink aliases as a tested
      follow-up. **Never create a config file just to compare paths.**
- [ ] **2. Listing.** A scoped list request whose storage identity equals the
      user scope's returns a successful **empty** project list; the user-scoped
      request still returns the entries. Do not error during Settings background
      refresh — a known alias is not a broken file, and a banner would make a
      safely skipped duplicate look like provider failure.
- [ ] **3. Mutations.** Upsert and delete against a colliding project scope reject
      before touching the file, with a stable testable code
      (`MCP_SCOPE_STORAGE_COLLISION` or the current repository convention) and
      `409 Conflict` — both scopes are individually valid but cannot be distinct
      targets at that workspace. The message names the provider and explains that
      the project uses the provider's user MCP file. It must never expose tokens,
      headers, environment values, or config contents.
- [ ] **4. One shared guard**, not client filtering or a copy of the check in each
      provider.

## Done when

Distinct scopes still list independently — `~/.codex/config.toml`
`[mcp_servers.docs]` and `<other-project>/.codex/config.toml`
`[mcp_servers.docs]` are meaningful separate entries, not duplicates, and the
same holds for every provider. Covered by tests for the Codex collision, the
Cursor collision, distinct scopes staying distinct, a Claude regression, an
OpenCode audit, and global add.

## Not doing

Changing the `cloudcli-browser` command, arguments, URL, token, or registration
scope. Adding or removing any real MCP entry. Migrating `~/.codex/config.toml`,
`~/.cursor/mcp.json`, `.mcp.json`, or `opencode.json`. Changing Codex trust
policy or reproducing its full config-layer discovery. Merging user and project
entries by name or content. Changing provider precedence. Redesigning the MCP
Settings screen. Making global add transactional. Touching `auth.db`, project
rows, sessions, or provider authentication. The separate
[Browser MCP hardening](browser-mcp-hardening.md) work.
