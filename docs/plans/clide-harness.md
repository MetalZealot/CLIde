# Every agent session knows where in CLIde it is running

- Status: not started
- Next: Phase 0 — inventory what each adapter injects today and what each provider already tells its agent
- Context: [provider capability map](../maps/clide-provider-capability-map.md),
  [session forensics skill](../../.claude/skills/session-forensics/SKILL.md),
  [project board](markdown-project-board.md), [agent runtime rebuild](agent-runtime-rebuild.md)

The harness is what CLIde adds around each agent beyond the provider's own
behaviour. Knowledge reaches the agent by one of three routes, chosen by its kind:

- **Session facts** — fixed for the session's life, unknowable to the agent
  otherwise: its CLIde `session_id` and `provider_session_id`, the project, the
  port serving its checkout, the plan and phase it was started from.  Injected once
  at session start.
- **Live state** — changes mid-session: the board, other sessions active in the same
  checkout.  Exposed as tools the agent calls, never placed in the instructions,
  so the prompt prefix stays cacheable.
- **Procedures** — how to do a job, such as session forensics.  Skills, loaded only
  when relevant.

Codex already receives CLIde-written developer instructions for the Browser tab;
Claude receives the stock preset with nothing appended.  This plan replaces that
one-off with a shared contract.

## Phases

- [ ] 0. Inventory: what each adapter adds today, what each provider tells its agent
      natively (Claude's environment block already gives the working directory and
      branch), and each provider's slot for added instructions.
- [ ] 1. One session-context block, built from the running server and placed by
      each adapter in its native slot — Claude's system-prompt append, Codex's
      developer instructions — with a capability flag where a provider has none.
      Codex's Browser text moves into it.  Claude and Codex first.
- [ ] 2. Session forensics trimmed to start from the ids the agent is given.
- [ ] 3. Live-state tools beside the Browser tools: this session's own status, other
      sessions in the same checkout, the board summary.
- [ ] 4. Board's **Start session** passes its plan and phase through the block.

## Done when

- A new Claude or Codex session asked "what is your CLIde session id, and which port
  serves this checkout?" answers correctly without searching.
- The block is identical on every turn of a session and stays within a budget agreed
  in phase 1.
- No host value — path, hostname, port — is written in source; each comes from the
  running server.

## Not doing

- Replacing `AGENTS.md`/`CLAUDE.md`: project guidance stays in the repository; the
  harness adds only what CLIde itself knows.
- Putting changing state into the instructions.
