#!/bin/zsh
# 2E.3: safe fix in an RBS project behaves like aggressive (-A -k):
# RBS types land in YARD comments, prose descriptions survive.
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
palette_run_until_log "DocScribe: Apply safe fixes to current file" "$log" "$before" \
  || { echo "fix did not run (log unchanged)" >&2; return 1; }
save_all
grep -q '@param \[Integer\]' "$RBS_STAND/widget.rb" \
  || { echo "RBS types not applied to widget.rb" >&2; return 1; }
grep -q 'Adds two numbers' "$RBS_STAND/widget.rb" \
  || { echo "description lost in widget.rb" >&2; return 1; }
return 0
