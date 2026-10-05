<div align="center">
  <img src="public/logo.svg" alt="CLIde" width="64" height="64">
  <h1>CLIde</h1>
  <p>A self-hosted web app for driving coding agents from your phone or a desktop browser.</p>
</div>

CLIde runs on a machine you own and gives you one interface for
[Claude Code](https://docs.anthropic.com/en/docs/claude-code),
[Codex](https://developers.openai.com/codex),
[Cursor CLI](https://docs.cursor.com/en/cli/overview) and
[OpenCode](https://opencode.ai). It installs as a phone app (PWA) and picks up the
sessions those agents already keep on disk, including ones started in a terminal.

It is a personal fork of CloudCLI UI (https://github.com/siteboon/claudecodeui),
modified heavily, and is not the original CloudCLI UI software.

## What it does

- **Chat** with each agent: streaming replies, tool activity, approvals, model and
  effort pickers, resume, rewind and fork.
- **Sessions** from every provider in one sidebar, searchable, starrable and
  archivable, with token and context usage.
- **Shell**: a terminal in the project directory.
- **Files** and **Source Control**: browse and edit the project, stage, commit and
  switch branches.
- **Browser**: a Playwright browser per chat that you and the agent share.
- **Scheduled messages** and Auto-Continue for long runs, with push notifications
  when a turn needs you.
- **Voice**: dictation and read-aloud through an optional local speech service.
- **Agent tools**: each provider's skills, plugins and MCP servers, as the provider
  reports them.

## Install and run

You need Node.js 22 or 24, and at least one agent CLI installed and signed in.

```bash
git clone https://github.com/MetalZealot/CLIde.git
cd CLIde
cp .env.example .env      # optional: port, bind address, database path
npm ci
npm run build
npm run server
```

Open `http://localhost:3001` and create the first account. CLIde keeps its own
database at `~/.cloudcli/auth.db`, outside the checkout; set `DATABASE_PATH` in
`.env` to move it. Each agent's transcripts stay where that agent writes them.

To reach it from a phone, serve it over HTTPS (a reverse proxy, or a tunnel such as
Tailscale Serve) and use the browser's "Install app" option.

For development, `npm run dev` runs the server with Vite's live reload on port 5173.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): how the system is put together and the rules
  it relies on.
- [AGENTS.md](AGENTS.md): how work is done in this repo.
- [docs/](docs/): maps of how things work today, decisions and their reasons, and plans.

## Credit and licence

CLIde is built on CloudCLI UI (https://github.com/siteboon/claudecodeui) by Siteboon
AI B.V. and its contributors. It is not affiliated with or endorsed by Siteboon.

Licensed under the GNU Affero General Public License v3.0 or later
(AGPL-3.0-or-later). See [LICENSE](LICENSE), including the additional terms under
Section 7, and [NOTICE](NOTICE). If you run a modified version as a network service,
you must offer its source to the people who use it.
