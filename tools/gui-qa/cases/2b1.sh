#!/bin/zsh
# 2B.1: bare chord shows VSCode second-key hint; palette check runs the check.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"

activate
open_file "$STAND/calc.rb"
ctrl_g 8
osascript -e 'tell application "System Events" to keystroke "d" using {command down, shift down}'
sleep 1.5
assert_ocr "2b1-chord" "Waiting for second key" || return 1
escape
log=$(docscribe_log)
before=$(stat -f "%m %z" "$log")
palette_run "DocScribe: Check current file"
after=$(stat -f "%m %z" "$log")
[[ "$after" != "$before" ]] || { echo "check did not run (log unchanged)" >&2; return 1; }
return 0
