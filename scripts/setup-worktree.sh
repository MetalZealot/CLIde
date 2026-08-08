#!/usr/bin/env bash
#
# setup-worktree.sh — make a git worktree usable for CLIde development.
#
#   ~/Projects/cloudcli/scripts/setup-worktree.sh ~/Projects/cloudcli-wt-foo
#
# git worktree only checks out *tracked* files, so a fresh worktree is missing
# every gitignored thing the app needs: node_modules, CLAUDE.md, .claude/, and
# .env.local. This links them to the main worktree — except CLAUDE.md, which is
# written as a real file because Claude Code will not load a symlinked one — and
# allocates a free SERVER_PORT / VITE_PORT pair so the worktree can run
# alongside the 3001 systemd service without a collision.
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

# --- link a gitignored path from main into the worktree --------------------
#
# Symlinked rather than copied so there is one source of truth: editing the
# linked path in any worktree edits main's file.
link_from_main() {
  local name=$1
  local src="$MAIN/$name"
  local dst="$TARGET/$name"

  if [ ! -e "$src" ]; then
    skip "$name — not present in main, nothing to link"
    return
  fi

  # Never touch a tracked file. Replacing one with a symlink shows up as a
  # typechange in git status and would end up in a commit.
  if git -C "$TARGET" ls-files --error-unmatch "$name" >/dev/null 2>&1; then
    skip "$name — tracked by git, comes with the worktree already"
    return
  fi

  if [ -L "$dst" ]; then
    ok "$name — already linked"
    return
  fi

  if [ -e "$dst" ]; then
    # A real file/dir is already there. Only replace it if it is byte-identical
    # to main's, so local edits are never silently destroyed.
    if diff -rq "$dst" "$src" >/dev/null 2>&1; then
      rm -rf -- "$dst"          # safe: $dst is a real path, not a symlink
      ln -s "$src" "$dst"
      ok "$name — replaced identical copy with a link"
    else
      warn "$name — a *different* copy exists here; left it alone"
      warn "    compare with: diff -r '$dst' '$src'"
    fi
    return
  fi

  ln -s "$src" "$dst"
  ok "$name — linked"
}

# --- node_modules ----------------------------------------------------------
if [ -L "$TARGET/node_modules" ]; then
  ok "node_modules — already linked to main"
elif [ -d "$TARGET/node_modules" ]; then
  size=$(du -sh "$TARGET/node_modules" 2>/dev/null | cut -f1)
  warn "node_modules — real directory here ($size), not a link; left it alone"
  warn "    to share main's instead:  rm -rf '$TARGET/node_modules' && $0 '$TARGET'"
else
  ln -s "$MAIN/node_modules" "$TARGET/node_modules"
  ok "node_modules — linked to main (no install needed)"
fi

# --- agent + editor config -------------------------------------------------
#
# CLAUDE.md is deliberately NOT linked. Claude Code silently ignores an
# instruction file reached through a symlink -- no warning, the file is just
# absent from context (proved 2026-08-04 on 2.1.221: a symlinked CLAUDE.md
# loaded nothing, an identical real file in the same directory loaded fine).
# A linked CLAUDE.md therefore left every worktree session uninstructed.
#
# The stub below is a real file. It imports the *branch's own* tracked
# AGENTS.md -- verified to resolve relative to the importing file, so a
# worktree gets its branch's guide, not main's -- and points back at main for
# host-specific facts, which Claude reads on demand.
write_claude_stub() {
  local dst="$TARGET/CLAUDE.md"

  if [ -L "$dst" ]; then
    rm -- "$dst"
    warn "CLAUDE.md — removed a symlink; Claude Code does not load those"
  elif [ -e "$dst" ] && ! grep -q '^@AGENTS\.md$' "$dst" 2>/dev/null; then
    warn "CLAUDE.md — a different real file exists here; left it alone"
    warn "    it must contain a line reading exactly '@AGENTS.md' to be useful"
    return
  fi

  cat > "$dst" <<EOF
# CLAUDE.md — worktree

@AGENTS.md

This is a worktree of the CLIde checkout at \`$MAIN\`. The import above is this
branch's own tracked guide. Host-specific facts — ports, services, the deploy
loop, the branch-test harness — are in \`$MAIN/CLAUDE.md\`; read it when the task
needs them. Never build or deploy this worktree to the production port.
EOF
  ok "CLAUDE.md — wrote worktree stub (real file, imports this branch's AGENTS.md)"
}

write_claude_stub
link_from_main .claude

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

# .gitignore has `.claude/` with a trailing slash, which only matches real
# directories — a symlink to one still shows as untracked. info/exclude lives in
# the shared git dir, so one entry covers every worktree and is never committed.
EXCLUDE="$(git -C "$TARGET" rev-parse --git-common-dir)/info/exclude"
if [ -f "$EXCLUDE" ] && ! grep -qx '.claude' "$EXCLUDE"; then
  printf '.claude\n' >> "$EXCLUDE"
  ok ".claude — added to git info/exclude so it stays out of git status"
fi

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

# --- playwright ------------------------------------------------------------
# Check the node_modules this worktree will actually resolve, which is main's
# only when the symlink is in place.
if [ -d "$TARGET/node_modules/playwright" ]; then
  ok "playwright — installed"
else
  warn "playwright — missing from this worktree's node_modules"
  warn "    install with:  cd '$TARGET' && npm install --save-dev playwright"
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
