#!/bin/zsh
# 2G.6: lib/tasks/db + Rakefile are both workspace-checked, sorted by
# path. Sorting itself is framework-covered (collectWorkspaceFiles sorted
# test); the driver proves rake kinds reach the GUI path at all.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"

mk_ws_stand || return 1
# Fresh-file daemon staleness (proven 2026-09-14, 2g3): the daemon keys
# results by (file, strategy, mtime, sig_hash); mk_ws_stand recreates every
# fixture, but sub-second mtimes can equal the cached entry, so the batch
# reuses STALE results. Bounce the daemon for a deterministic rerun.
pkill -9 -f "docscribe server" 2>/dev/null
sleep 2
trust_off
trap 'trust_restore' EXIT
window_gate "$WS_STAND" || return 1
trust_on "$WS_STAND" || return 1
# (front_window superseded by window_gate above)
escape
open_file "$WS_STAND/lib/a.rb"
palette_run "DocScribe: Check entire workspace"
# NOTE: OCR splits the dotted path ("tasks/db. rake"), so the oracle uses
# the split-proof stem, not the full path.
pathhunt "2g6" "tasks/db" \
  || { echo "db.rake missing from workspace check" >&2; return 1; }
pathhunt "2g6-rf" "Rakefile" \
  || { echo "Rakefile missing from workspace check" >&2; return 1; }
return 0
