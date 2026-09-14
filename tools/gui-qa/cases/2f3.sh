#!/bin/zsh
# 2F.3: update-types on an error input surfaces an error, never "success".
# NOTE (deviation, probe-proven 2026-09-13): the checklist expects a
# warning path with success=false + hasIssues=true (exit 1), but gem 1.6.2
# update_types only ever exits 0 (updated/ok) or 2 (errors: unreadable,
# missing target). Exit 1 is unreachable. This case covers the reachable
# non-success path (exit 2 -> error toast + error status); the exit-code
# mapping itself is framework-covered (execCommand suites).
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
chmod 000 "$RBS_STAND/widget.rb"
palette_run "DocScribe: Update types from RBS"
# Error toast is transient (~10s): poll immediately, restore perms after.
found=0
for i in 1 2 3; do
  shot "2f3-$i"
  ocr_text | grep -qi "see output for details" && { found=1; break; }
  sleep 2
done
chmod 644 "$RBS_STAND/widget.rb"
[[ $found -eq 1 ]] || { echo "no error toast on update-types failure" >&2; return 1; }
return 0
