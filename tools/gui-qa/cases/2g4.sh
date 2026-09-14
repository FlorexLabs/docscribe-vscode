#!/bin/zsh
# 2G.4: safety-net dirs never enter the check: node_modules/, vendor/,
# .git/, hidden dirs, symlinked dirs. The 5000-file hard limit is
# framework-covered (collectWorkspaceFiles maxFiles test — building 5000
# fixtures in the driver would take longer than the whole suite).
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
mkdir -p "$WS_STAND/.git" "$WS_STAND/.hidden"
printf 'class G\n  def go(x)\n    x\n  end\nend\n' > "$WS_STAND/.git/g.rb"
printf 'class H\n  def go(x)\n    x\n  end\nend\n' > "$WS_STAND/.hidden/h.rb"
ln -sfn "$WS_STAND/lib" "$WS_STAND/linklib"
palette_run "DocScribe: Check entire workspace"
pathhunt "2g4" "lib/a" \
  || { echo "lib/a missing from workspace check" >&2; return 1; }
# Stem patterns (no extensions): OCR splits dotted paths ("g. rb").
# "git/g" / "hidden/h" qualify the bare stems so prose can't match.
for bad in "node_modules/x" "vendor/y" "git/g" "hidden/h"; do
  path_absent "2g4-${bad%%/*}" "$bad" \
    || { echo "$bad leaked into workspace check" >&2; return 1; }
done
rm -f "$WS_STAND/linklib"
rm -rf "$WS_STAND/.git" "$WS_STAND/.hidden"
return 0
