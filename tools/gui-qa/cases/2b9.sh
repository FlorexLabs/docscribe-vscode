#!/bin/zsh
# 2B.9: chord U updates types (log), Doctor opens its channel (OCR). Fold: command runs clean.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"

activate
mkstand
open_file "$STAND/gui-undoc.rb"
log=$(docscribe_log)
osascript -e 'tell application "System Events" to keystroke "d" using {command down, shift down}'
sleep 1
osascript -e 'tell application "System Events" to keystroke "u"'
sleep 6
tail -c 2000 "$log" | grep -q "update_types: ok" || { echo "no update_types ok" >&2; rmstand; return 1; }
palette_run "DocScribe: Doctor"
rmstand
assert_ocr "2b9" "DocScribe Doctor" || return 1
return 0
