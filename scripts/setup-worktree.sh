#!/usr/bin/env bash
#
# setup-worktree.sh — make a git worktree usable for CLIde development.
#
#   ~/Projects/cloudcli/scripts/setup-worktree.sh ~/Projects/cloudcli-wt-foo
#
# git worktree only checks out *tracked* files, so a fresh worktree is missing
# the gitignored things the app needs: node_modules and .env.local. This runs a
# real `npm ci` (every checkout owns its dependencies, so a branch may change
# package.json without touching main), links Claude Code's memory directory and
# personal permission grants, and allocates a free SERVER_PORT / VITE_PORT pair
# so the worktree can run alongside the 3001 systemd service.
#
# Safe to re-run. It never overwrites a real file whose contents differ from
# main's, and it never deletes anything through a symlink.
#
set -euo pipefail

die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
skip() { printf '  \033[90m·\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

[ $# -eq 1 ] || die "usage: $(basename "$0") <path-to-worktree>"

TARGET=$(cd "$1" 2>/dev/null && pwd) || die "no such directory: $1"

# The main worktree is always the first entry of `git worktree list`.
MAIN=$(git -C "$TARGET" worktree list --porcelain 2>/dev/null | head -1 | cut -d' ' -f2-) \
  || die "$TARGET is not inside a git repository"
[ -n "$MAIN" ] || die "could not determine the main worktree for $TARGET"

if [ "$TARGET" = "$MAIN" ]; then
  die "$TARGET is the main worktree; run this against a secondary worktree"
fi

printf '\nSetting up \033[1m%s\033[0m\n' "$TARGET"
printf '  (main worktree: %s)\n\n' "$MAIN"

# --- node_modules ----------------------------------------------------------
#
# A real install, never a link to main's. Sharing one node_modules meant a branch
# could not change package.json, `npm install` in a worktree silently edited the
# checkout serving production, and tsc's cache (inside node_modules) was shared
# too. Older worktrees that still carry the link are converted here.
if [ -L "$TARGET/node_modules" ]; then
  rm -- "$TARGET/node_modules"     # removes the link only, never its target
  warn "node_modules — removed the legacy link to main's; installing a real copy"
fi
if [ -d "$TARGET/node_modules" ]; then
  ok "node_modules — present"
else
  printf '  … node_modules — running npm ci (a few minutes on this machine)\n'
  (cd "$TARGET" && npm ci --no-audit --no-fund) || die "npm ci failed in $TARGET"
  ok "node_modules — installed"
fi

# --- agent + editor config -------------------------------------------------
#
# Nothing to do here any more, and that is the point. `CLAUDE.md`,
# `.claude/settings.json`, `.claude/hooks/` and `.claude/skills/` are tracked in
# git (force-added past upstream's `.gitignore`), so `git worktree add` delivers
# them itself. Host facts live in each agent's own global config --
# `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` -- which load in every checkout.
#
# Only `.claude/settings.local.json` stays untracked, because it holds personal
# permission grants rather than project config. Link it so a worktree does not
# re-prompt for everything already allowed in main.
link_settings_local() {
  local src="$MAIN/.claude/settings.local.json"
  local dst="$TARGET/.claude/settings.local.json"

  [ -f "$src" ] || return 0
  mkdir -p "$TARGET/.claude"
  if [ -e "$dst" ] || [ -L "$dst" ]; then
    warn "settings.local.json — already present, left alone"
    return 0
  fi
  ln -s "$src" "$dst"
  ok "settings.local.json — linked to main (personal permission grants)"
}

link_settings_local

# --- Claude Code memory ----------------------------------------------------
#
# Memory lives OUTSIDE the checkout, at ~/.claude/projects/<cwd with / as ->,
# and is keyed by absolute path with no fallback to a parent or to the main
# worktree. So every worktree session started with an empty memory: main had 30
# facts, each worktree had zero (measured 2026-08-06). That is the single
# largest reason a worktree session behaves like it has never seen this app --
# it loses the session-id model, the model-picker resolution, the test-runner
# invocation, client-build-needs-no-restart, and so on.
#
# Unlike CLAUDE.md, a symlinked memory directory IS read (verified 2026-08-06:
# a worktree probe correctly answered a fact present only in main's memory), so
# linking the whole directory gives every worktree one shared, always-current
# memory rather than a divergent copy.
link_memory_from_main() {
  local base="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"
  local src="$base/$(printf '%s' "$MAIN"   | tr '/' '-')/memory"
  local dst="$base/$(printf '%s' "$TARGET" | tr '/' '-')/memory"

  if [ ! -d "$src" ]; then
    skip "memory — main has none yet at $src"
    return
  fi
  if [ -L "$dst" ]; then
    ok "memory — already linked to main's"
    return
  fi
  if [ -e "$dst" ]; then
    warn "memory — a real directory exists here; left it alone"
    warn "    merge it into main's by hand, then re-run: $0 '$TARGET'"
    return
  fi

  mkdir -p "$(dirname "$dst")"
  ln -s "$src" "$dst"
  ok "memory — linked to main's ($(ls "$src" | wc -l) files)"
}

link_memory_from_main

# --- ports -----------------------------------------------------------------
#
# Collect every port already spoken for: listening sockets on the box, plus
# whatever the other worktrees have already claimed in their .env.local.
claimed_ports() {
  ss -tlnH 2>/dev/null | awk '{print $4}' | sed 's/.*://'
  git -C "$MAIN" worktree list --porcelain 2>/dev/null \
    | awk '/^worktree /{print $2}' \
    | while read -r wt; do
        [ -f "$wt/.env.local" ] || continue
        [ "$wt" = "$TARGET" ] && continue
        grep -hoE '^(SERVER_PORT|VITE_PORT)=[0-9]+' "$wt/.env.local" 2>/dev/null | cut -d= -f2
      done
  printf '3001\n5173\n'   # main's defaults, even when nothing is running
}

TAKEN=$(claimed_ports | sort -un)

next_free() {
  local port=$1
  while printf '%s\n' "$TAKEN" | grep -qx "$port"; do
    port=$((port + 1))
  done
  printf '%s' "$port"
}

if [ -f "$TARGET/.env.local" ] && grep -q '^SERVER_PORT=' "$TARGET/.env.local"; then
  existing=$(grep -oE '^(SERVER_PORT|VITE_PORT)=[0-9]+' "$TARGET/.env.local" | paste -sd' ')
  ok ".env.local — already has ports ($existing)"
else
  SERVER_PORT=$(next_free 3002)
  TAKEN="$TAKEN
$SERVER_PORT"
  VITE_PORT=$(next_free 5174)

  # Carry over the Tailscale/LAN hostnames so Vite accepts non-localhost hosts.
  ALLOWED=$(grep -h '^VITE_ALLOWED_HOSTS=' "$MAIN/.env.local" 2>/dev/null || true)

  {
    printf '# Generated by scripts/setup-worktree.sh for this worktree.\n'
    printf '# Ports are chosen to avoid the 3001 systemd service and other worktrees.\n'
    printf 'SERVER_PORT=%s\n' "$SERVER_PORT"
    printf 'VITE_PORT=%s\n' "$VITE_PORT"
    [ -n "$ALLOWED" ] && printf '%s\n' "$ALLOWED"
  } > "$TARGET/.env.local"

  ok ".env.local — created (SERVER_PORT=$SERVER_PORT, VITE_PORT=$VITE_PORT)"
fi

# --- what to do next -------------------------------------------------------
sp=$(grep -oE '^SERVER_PORT=[0-9]+' "$TARGET/.env.local" | cut -d= -f2)
vp=$(grep -oE '^VITE_PORT=[0-9]+' "$TARGET/.env.local" | cut -d= -f2)

cat <<EOF

Ready. From $TARGET:

  npm run build
  node --env-file=.env.local dist-server/server/index.js   # backend on :$sp
  npm run dev                                              # Vite on :$vp -> :$sp

Note the --env-file. Only Vite reads .env.local; the server does not, so a bare
"npm run server" ignores the SERVER_PORT allocated above and falls back to the
3001 default -- the port an already-running instance occupies. It will either
fail to bind or, if that instance is stopped, quietly take its place and write
to the real database.
EOF
