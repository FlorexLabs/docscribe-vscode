#!/bin/zsh
# 2G.5: Ignore Patterns **/gen/** skips gen/ in BOTH mechanisms:
# workspace check (collectWorkspaceFiles) and on-save file check
# (isIgnored + minimatch -> Problems stays quiet). Surgical settings
# toggle (trap owns the trust bak, 2e4 lesson).
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
SET="$HOME/Library/Application Support/Code/User/settings.json"

mk_ws_stand || return 1
# Fresh-file daemon staleness (proven 2026-09-14, 2g3): the daemon keys
# results by (file, strategy, mtime, sig_hash); mk_ws_stand recreates every
# fixture, but sub-second mtimes can equal the cached entry, so the batch
# reuses STALE results. Bounce the daemon for a deterministic rerun.
pkill -9 -f "docscribe server" 2>/dev/null
sleep 2
trust_off
trap 'trust_restore' EXIT
fresh_window_checked "$WS_STAND" "ws-stand" || return 1
front_window "v ws-stand" || return 1
escape
python3 -c "import json; p='$SET'; d=json.load(open(p)); d['docscribe.ignorePatterns']=['**/gen/**']; json.dump(d, open(p,'w'))"
# (No open_file before the check: a pre-toggle auto-check would fill Output
# with unfiltered JSON — same trap as 2g3, proven 2026-09-14.)
# Step 1: workspace check skips gen/.
palette_run "DocScribe: Check entire workspace"
pathhunt "2g5" "lib/a" \
  || { echo "lib/a missing with ignorePatterns" >&2; return 1; }
path_absent "2g5" "gen/c" \
  || { echo "gen/c leaked despite ignorePatterns" >&2; return 1; }
# Step 2: on-save check of a gen/ file stays quiet in Problems.
# Oracle on the group-header folder ("c.rb gen"): the bare "c.rb" also
# appears as editor tab title and chat context below the panel anchor
# (proven 2026-09-13, false red), but only a real diagnostic group carries
# the qualified folder. Positive control: the a.rb group must be visible
# (proves the Problems pipeline is live, not stale-empty).
open_file "$WS_STAND/gen/c.rb"
touch_check
sleep 4
problems
shot "2g5-quiet"
ocr_text | grep -qi "Problems" || { echo "problems view not open" >&2; return 1; }
panel_grep "$LAST_SHOT" "a\.rb" \
  || { echo "Problems pipeline looks dead (no a.rb group)" >&2; python3 -c "import json; b=json.load(open('/tmp/gui-qa-settings.bak')); json.dump(b, open('$SET','w'))"; return 1; }
panel_grep "$LAST_SHOT" "\\bgen\\b" \
  && { echo "gen/c.rb diagnosed despite ignorePatterns" >&2; python3 -c "import json; b=json.load(open('/tmp/gui-qa-settings.bak')); json.dump(b, open('$SET','w'))"; return 1; }
python3 -c "import json; b=json.load(open('/tmp/gui-qa-settings.bak')); json.dump(b, open('$SET','w'))"
return 0
