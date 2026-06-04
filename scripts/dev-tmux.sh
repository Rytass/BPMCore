#!/bin/sh
# Start every BPMCore dev server in one tiled tmux session:
#   pane 1: pnpm api     (NestJS GraphQL API, http://localhost:17603/graphql
#                         + root /auth/* and /attachments/*)
#   pane 2: pnpm client  (Next.js backoffice,  http://localhost:17602)
#
# The api/client aliases run nx with `--tui=false` so each pane shows plain
# streaming logs instead of nx taking over the terminal UI.
#
# Re-running attaches to the existing session instead of spawning duplicates.
# Stop everything with: tmux kill-session -t bpm-core-dev
#
# Note: this only launches the long-running servers. Seed/reset the develop
# database separately with `pnpm demo:reset` when you need a clean scenario.
set -eu

SESSION="bpm-core-dev"
WINDOW="dev"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is not installed. Install it (e.g. 'brew install tmux') or run" >&2
  echo "'pnpm api' and 'pnpm client' in separate terminals." >&2
  exit 1
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux attach -t "$SESSION"
  exit 0
fi

api_pane="$(tmux new-session -d -s "$SESSION" -n "$WINDOW" -c "$PWD" -P -F "#{pane_id}" "pnpm api")"
tmux split-window -h -t "$api_pane" -c "$PWD" "pnpm client"

tmux select-layout -t "$SESSION:$WINDOW" tiled >/dev/null
tmux attach -t "$SESSION"
