#!/bin/zsh
# 2B.6: quickfix widget lists per-method + fix-all entries (no apply; fixture stays pristine).
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"

activate
mkstand
open_file "$STAND/gui-undoc.rb"
palette_run "DocScribe: Check current file"
ctrl_g 2
palette "Quick Fix..."
sleep 1
osascript -e 'tell application "System Events" to key code 36'
sleep 2
shot "2b6"
w=$(ocr_text)
escape
rmstand
echo "$w" | grep -qi "fix all in file (safe)" || { echo "widget miss: fix-all safe" >&2; return 1; }
echo "$w" | grep -qi "fix all in file (aggressive)" || { echo "widget miss: fix-all aggressive" >&2; return 1; }
return 0
