# Environments: one CLIde app, sessions on more than one machine

- Status: not started
- Next: Phase 0 — CLIde installed on the second machine and reachable from the
  phone over HTTPS, before writing any code.
- Context: the client's single-server assumption lives in `authenticatedFetch`
  (`src/utils/api.js`) and the two WebSocket URL builders
  (`src/contexts/WebSocketContext.tsx`, `src/components/shell/utils/socket.ts`).
  The model follows T3 Code's environments (`docs/user/remote-access.md` and
  `packages/client-runtime/src/state/projectGrouping.ts` in pingdotgg/t3code).

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
- **Each device keeps its own machine list**, as T3 Code does: a device adds a
  machine once and keeps its token. No server stores another's address.
- **The same repository on two machines is one project.** Projects are matched
  by normalized git remote URL; the project row holds sessions from both
  machines, each labelled. A folder with no remote stays its own row.
- **A session belongs to the machine it was created on**, and opening it talks
  to that machine. If the machine is offline, the session shows but cannot open.

## Phases

- [ ] 0. **CLIde runs on the laptop, reachable over Tailscale HTTPS.** No code;
      proves it installs and runs on that OS and the phone can reach it.
- [ ] 1. **Environment-aware client plumbing.** `authenticatedFetch` and both
      socket builders take an environment; tokens are stored per environment;
      the home server is the environment when none is named. With one
      environment configured, behaviour is unchanged.
- [ ] 2. **Settings → Environments**: add a machine by name and address, sign in
      to it, see whether it is reachable. List kept on this device.
      Address suggestions come from the tailnet's device list when Tailscale is
      present; a tailnet machine without HTTPS shows the `tailscale serve`
      command to copy.
- [ ] 3. **One sidebar across machines.** Each environment's projects load
      independently and merge by git remote; sessions carry a machine label; an
      unreachable machine shows as offline without delaying the others.
- [ ] 4. **A session opens against its own machine**: chat, Shell, Files and Git
      all route to the environment that owns it.
- [ ] 5. **Machine picker under the composer** for a new session. Picking a
      project keeps the current machine if the project exists there, otherwise
      switches to one that has it.
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
- Pairing by QR code or one-time link; version one signs in with the password.
- Load balancing new sessions across machines.
- Claude Code's cloud sessions as an environment. The CLI can start them
  (`--cloud`), but the Agent SDK that CLIde drives has no option for it.
- Per-environment Settings screens beyond Environments itself; other settings
  stay the home server's.
- CLIde changing Tailscale. It reads tailnet state only; `tailscale serve` needs
  root and is system networking, so the user runs it.
