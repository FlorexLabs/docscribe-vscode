#!/bin/zsh
# 2H.7: no docscribe gem -> version Not detected + 3-line Troubleshooting.
# 2H.6 (ruby missing from PATH) is framework-only: stripping PATH breaks
# the whole VM toolchain (bundle/vocr/ssh) and can't be scoped to one
# window; the Ruby-not-found branch is covered by the Doctor-rows suite.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"

mk_nogem_stand || return 1
trust_off
trap 'trust_restore' EXIT
window_gate "$NOGEM_STAND" || return 1
trust_on "$NOGEM_STAND" || return 1
# (front_window superseded by window_gate above)
escape
open_file "$NOGEM_STAND/foo.rb"
palette_run "DocScribe: Doctor"
pageup 8
shot "2h7-head"
dochunt "2h7" "DocScribe version: Not detected" \
  || { echo "Not detected row missing" >&2; return 1; }
dochunt "2h7-ts" "Troubleshooting:" \
  || { echo "Troubleshooting block missing" >&2; return 1; }
dochunt "2h7-b" "bundle install" \
  || { echo "bundle install hint missing" >&2; return 1; }
return 0
