#!/bin/zsh
# 2F.1: palette Update types rewrites the file via RPC, Output shows
# `update_types: ok (<dir>)`, open ruby docs are rechecked.
# Fixture: RBS project (sig/ + rbs gem) with STALE widget.rb (no YARD).
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
RBS_STAND="/tmp/ut-stand"

mk_rbs_stand || return 1
trust_off
trap 'trust_restore' EXIT
fresh_window_checked "$RBS_STAND" "ut-stand" || return 1
front_window "v ut-stand" || return 1
escape
open_file "$RBS_STAND/widget.rb"
log=$(docscribe_log)
before=$(log_mark "$log")
palette_run_until_log "DocScribe: Update types from RBS" "$log" "$before" \
  || { echo "update-types did not run (log unchanged)" >&2; return 1; }
# File rewritten with RBS types (probe-proven: @param [Integer] added).
grep -q '@param \[Integer\]' "$RBS_STAND/widget.rb" \
  || { echo "RBS types not applied to widget.rb" >&2; return 1; }
# RPC oracle: Output shows the update_types status line.
panelhunt "2f1" "update_types: *ok" \
  || { echo "update_types status missing in Output" >&2; return 1; }
return 0
