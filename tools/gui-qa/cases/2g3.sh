#!/bin/zsh
# 2G.3: root .gitignore (gen/ + !gen/keep negation); nested .gitignore
# must be ignored. Oracle: Output lists gen/keep, never gen/c.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"

mk_ws_stand || return 1
trust_off
trap 'trust_restore' EXIT
fresh_window_checked "$WS_STAND" "ws-stand" || return 1
front_window "v ws-stand" || return 1
escape
# Write .gitignore BEFORE opening anything: the extension computes the
# file list at check time from current disk state, and open_file's
# --reuse-window focus can trigger an auto-check on the PRE-gitignore list
# whose Output then satisfies nothing (proven 2026-09-14: hunts scanned a
# 3-file JSON that predated the .gitignore write). Sleep past the mtime
# granularity: the daemon keys results by (file, strategy, mtime) at
# 1-SECOND granularity, and mk_ws_stand recreates fixtures within the same
# second as the previous case's check — identical mtimes serve STALE
# results missing fresh files (proven 2026-09-14: keep.rb absent from a
# 4-file batch until the second tick).
printf 'gen/\n!gen/keep.rb\n' > "$WS_STAND/.gitignore"
printf 'lib/\n' > "$WS_STAND/gen/.gitignore"
sleep 2
open_file "$WS_STAND/lib/a.rb"
# Belt and suspenders vs the daemon file_cache: the daemon keys results by
# (file, strategy, mtime, sig_hash) and CANNOT see .gitignore edits (it
# reuses per-file results when only the ignore set changed — proven
# 2026-09-14: keep.rb stayed out of Output until daemon restart). Bounce
# the daemon so the batch runs on the current file list; the file list
# itself is computed fresh by the extension on every check.
pkill -9 -f "docscribe server" 2>/dev/null
sleep 2
# Sleep past the daemon mtime granularity (1 second): recreated fixtures
# share mtimes with the previous case's cached results otherwise (proven
# 2026-09-14, 2g3). The pkill above cannot help — the NEW daemon re-reads
# the same mtimes and re-serves stale entries.
sleep 2
palette_run "DocScribe: Check entire workspace"
# Negated file survives...
pathhunt "2g3" "gen/keep" \
  || { echo "negated gen/keep missing from workspace check" >&2; return 1; }
# ...ignored sibling does not (full-range absence: the viewport sits on
# keep.rb after the hunt, so a static shot proves nothing). The nested
# gen/.gitignore (lib/) must change nothing: lib/a.rb is not under gen/,
# so no nesting semantics apply — this pins "nested gitignores are not
# read" (documented in loadGitignorePatterns).
path_absent "2g3" "gen/c" \
  || { echo "gen/c leaked despite root gitignore" >&2; return 1; }
pathhunt "2g3-lib" "lib/a" \
  || { echo "nested gitignore wrongly excluded lib/" >&2; return 1; }
rm -f "$WS_STAND/.gitignore" "$WS_STAND/gen/.gitignore"
return 0
