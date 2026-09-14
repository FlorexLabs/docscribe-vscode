#!/bin/zsh
# 2G.2: docscribe.yml filter.files — exclude spec/, include lib only,
# no-yml fallback (spec excluded). Oracle: Output file list, confined to
# the panel (explorer shows everything). Absence in the panel area is
# honest: explorer lives above the panel tabs.
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
fresh_window_checked "$WS_STAND" "ws-stand" || return 1
front_window "v ws-stand" || return 1
escape
open_file "$WS_STAND/lib/a.rb"

# Write the filter BEFORE opening anything (proven 2026-09-14, 2g3: an
# auto-check on the pre-filter list fills Output with JSON the hunts then
# scan in vain).
printf 'filter:\n  files:\n    exclude:\n      - spec/\n' > "$WS_STAND/docscribe.yml"
palette_run "DocScribe: Check entire workspace"
pathhunt "2g2-ex" "lib/a" \
  || { echo "lib/a missing with spec exclude" >&2; return 1; }
path_absent "2g2-ex" "spec/b_spec" \
  || { echo "spec leaked into workspace check" >&2; return 1; }

# Step 2: include lib only — same picture via the other mechanism.
printf 'filter:\n  files:\n    include:\n      - lib\n' > "$WS_STAND/docscribe.yml"
palette_run "DocScribe: Check entire workspace"
pathhunt "2g2-in" "lib/a" \
  || { echo "lib/a missing with lib include" >&2; return 1; }
path_absent "2g2-in" "spec/b_spec" \
  || { echo "spec leaked with lib include" >&2; return 1; }

# Step 3: no yml — fallback excludes spec.
rm -f "$WS_STAND/docscribe.yml"
palette_run "DocScribe: Check entire workspace"
pathhunt "2g2-fb" "lib/a" \
  || { echo "lib/a missing without yml" >&2; return 1; }
path_absent "2g2-fb" "spec/b_spec" \
  || { echo "spec leaked without yml (fallback broken)" >&2; return 1; }
return 0
