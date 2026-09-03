#!/usr/bin/env bash
# Interrupts iterative visual work that is being done the slow way.
#
# Repeated build:client with no dev server running is the observable signature of
# Tier 2 work (layout, styling, multi-round tweaking) being run as a series of
# Tier 1 fixes. Fires once per session so it interrupts without becoming noise.
set -uo pipefail

payload=$(cat)
command=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty')
session=$(printf '%s' "$payload" | jq -r '.session_id // "unknown"')

case "$command" in
  *build:client*) ;;
  *) exit 0 ;;
esac

state_dir="${XDG_RUNTIME_DIR:-/tmp}/clide-tier2-gate"
mkdir -p "$state_dir"
count_file="$state_dir/$session"
count=$(( $(cat "$count_file" 2>/dev/null || echo 0) + 1 ))
printf '%s' "$count" > "$count_file"

# A running dev server means the loop is already fast; builds are then deploys.
# Unit name is overridable so this file carries no host specifics; the default
# is the project convention, not a machine fact.
if systemctl --user is-active --quiet "${CLIDE_DEV_UNIT:-cloudcli-dev}"; then
  exit 0
fi

if [ "$count" -eq 2 ]; then
  cat >&2 <<'MSG'
BLOCKED once: this is the 2nd build:client this session with no dev server running.

Two builds means iterative visual work, which CLAUDE.md defines as Tier 2:
  start the dev server unit, then hand the user its URL
  (both are in your agent's own host config, not in this repo)

Edits hot-reload there, so stop rebuilding between rounds. Before the next visual
change, confirm you have read docs/maps/ui-standards.md and labelled each decision
standard / convention / taste.

If this genuinely is a one-off fix or the final deploy build, run it again — this
gate fires only once per session.
MSG
  exit 2
fi

exit 0
