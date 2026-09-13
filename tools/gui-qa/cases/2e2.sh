#!/bin/zsh
# 2E.2: RBS project + collection file. GUI check runs (exthost log grows)
# and Doctor shows the collection string. Exact CLI flags (--rbs,
# --rbs-collection) and daemon cli_overrides are proven by the framework
# matrix (doctorRbsMatrix CLI/daemon suites); the driver proves the GUI path
# reaches the same resolveRbsContext choke point (flags are not surfaced in
# the Output panel by design).
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
RBS_STAND="${RBS_STAND:-/tmp/rbs-stand}"

mk_rbs_stand || return 1
trust_off
trap 'trust_restore' EXIT
fresh_window_checked "$RBS_STAND" "rbs-stand" || return 1
front_window "v rbs-stand" || return 1
escape
open_file "$RBS_STAND/widget.rb"
log=$(docscribe_log)
before=$(log_mark "$log")
palette_run_until_log "DocScribe: Check current file" "$log" "$before" \
  || { echo "check did not run (log unchanged)" >&2; return 1; }
palette_run "DocScribe: Doctor"
dochunt "2e2" 'RBS.? *enabled.*rbs_collection' || return 1
return 0
