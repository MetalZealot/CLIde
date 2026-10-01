# Environments: one CLIde app, sessions on more than one machine

- Status: not started
- Next: Phase 0 — run CLIde standalone on the second machine and use it from the
  phone directly, before writing any code.
- Context: the client's single-server assumption lives in `authenticatedFetch`
  (`src/utils/api.js`) and the two WebSocket URL builders
  (`src/contexts/WebSocketContext.tsx`, `src/components/shell/utils/socket.ts`).

The phone drives sessions on a second machine (a laptop) exactly as it drives the
home server's, from the same installed app and the same sidebar. A session runs
on the machine it started on and stays there.

## Shape

- **An environment is a CLIde server.** Each machine runs its own full CLIde: its
  own providers, provider logins, transcripts and user database. Nothing is
  synced between machines; the client just talks to more than one server.
- **The client connects to each server directly.** No server relays another's
  traffic, so the home server being busy or restarting never affects a laptop
  session, and vice versa.
- **The server side is already nearly ready.** Auth is a bearer token, not a
  cookie, and `cors()` runs with its permissive defaults, so a page served by one
  CLIde can already call another. Each machine needs HTTPS reachable from the
  phone, or the installed app (HTTPS) is blocked from connecting to it.
- **The work is the client.** Every request and socket assumes "the server that
  served this page". That becomes "the server that owns this session".
- **Sign in once per environment per device.** The two servers have separate
  user databases, so each issues its own token; the client stores one token per
  environment instead of one in total.
- **The environment list is stored on the home server**, so every device sees
  the same machines without configuring each one. That is a user-database write:
  back it up first.

## Phases

- [ ] 0. **CLIde runs on the laptop and the phone uses it directly**, as a second
      tab or installed app, no code changes. Proves CLIde runs on that OS and
      whether two sidebars are bearable before building one.
- [ ] 1. **Environment-aware client plumbing.** `authenticatedFetch` and both
      socket builders take an environment; tokens are stored per environment;
      the home server is the environment when none is named. With one
      environment configured, behaviour is unchanged.
- [ ] 2. **Settings → Environments**: add a machine by name and address, sign in
      to it, see whether it is reachable. List stored on the home server.
- [ ] 3. **One sidebar across machines.** Each environment's projects load
      independently and carry a machine label; an unreachable machine shows as
      offline without delaying or breaking the others.
- [ ] 4. **A session opens against its own machine**: chat, Shell, Files and Git
      all route to the environment that owns it.
- [ ] 5. **New Session gets an Environment picker**, listing the chosen
      machine's projects. Preselects the home server.
- [ ] 6. **Notifications from every machine reach the phone.** Each server sends
      its own push; the client subscribes to each.

## Done when

- From the phone app, a session started on the laptop appears in the sidebar
  beside the home server's, labelled, and a message sent to it gets a reply.
- With the laptop asleep, its sessions show as offline and everything on the
  home server works normally.
- With no second environment configured, nothing in CLIde looks or behaves
  differently.

## Not doing

- Moving a session from one machine to another. It stays where it started; move
  work between machines with git.
- Merging the same repository on two machines into one project row. Version one
  shows them as two rows with machine labels.
- Claude Code's cloud sessions as an environment. The CLI can start them
  (`--cloud`), but the Agent SDK that CLIde drives has no option for it.
- Per-environment Settings screens beyond Environments itself; other settings
  stay the home server's.
