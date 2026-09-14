#!/bin/zsh
# 2G.3: root .gitignore (gen/ + !gen/keep negation); nested .gitignore
# must be ignored. Oracle: Output lists gen/keep, never gen/c.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"

mk_ws_stand || return 1
trust_off
trap 'trust_restore' EXIT
window_gate "$WS_STAND" || return 1
trust_on "$WS_STAND" || return 1
# (front_window superseded by window_gate above)
escape
# Write .gitignore BEFORE opening anything: the file list is computed at
# check time from disk. (Earlier theories about daemon mtime-staleness
# were wrong — the batch answers per requested file; the real failure was
# window focus, now fenced by window_gate. The sleeps/pkill below stay as
# cheap belt-and-suspenders.)
printf 'gen/\n!gen/keep.rb\n' > "$WS_STAND/.gitignore"
printf 'lib/\n' > "$WS_STAND/gen/.gitignore"
sleep 2
# No open_file before the workspace check: opening a file can trigger an
# auto-check whose Output then satisfies nothing (same trap as 2g5, proven
# 2026-09-14). Workspace check needs no active editor.
pkill -9 -f "docscribe server" 2>/dev/null
sleep 2
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
