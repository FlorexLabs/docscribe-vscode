#!/bin/zsh
# 2G.1: workspace check with one error file. Unreadable lib/a.rb (chmod 000)
# makes check_batch return status error -> Docscribe/Error entry,
# summary.error_count incremented, exitCode 1 (status bar "issues found").
# Oracle is Output-confined (panelhunt): explorer/tab titles show the same
# filename (2c8 false-green lesson). exitCode mapping itself is
# framework-covered (batchResultsToJson error tests + execCommand suites).
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"

mk_ws_stand || return 1
# Fresh-file daemon staleness (proven 2026-09-14, 2g3): the daemon keys
# results by (file, strategy, mtime, sig_hash); mk_ws_stand recreates every
# fixture, but sub-second mtimes can equal the cached entry, so the batch
# reuses STALE results. Bounce the daemon for a deterministic rerun.
pkill -9 -f "docscribe server" 2>/dev/null
sleep 2
# Sleep past the daemon mtime granularity (1 second): recreated fixtures
# share mtimes with the previous case's cached results otherwise (proven
# 2026-09-14, 2g3). The pkill above cannot help — the NEW daemon re-reads
# the same mtimes and re-serves stale entries.
sleep 2
trust_off
trap 'trust_restore' EXIT
window_gate "$WS_STAND" || return 1
trust_on "$WS_STAND" || return 1
# (front_window superseded by window_gate above)
escape
chmod 000 "$WS_STAND/lib/a.rb"
palette_run "DocScribe: Check entire workspace"
chmod 644 "$WS_STAND/lib/a.rb"
# Error entry + incremented counter land in Output JSON.
panelhunt "2g1" "Docscribe/Error" \
  || { echo "error entry missing in workspace Output" >&2; return 1; }
panelhunt "2g1-err" "error_count" \
  || { echo "error_count missing in workspace Output" >&2; return 1; }
return 0
