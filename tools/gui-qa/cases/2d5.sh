#!/bin/zsh
# 2D.5: useServer=false forces CLI. Settings restored after.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"
SET="$HOME/Library/Application Support/Code/User/settings.json"

activate
cp "$SET" /tmp/gui-qa-settings.bak
python3 -c "import json; p='$SET'; d=json.load(open(p)); d['docscribe.useServer']=False; json.dump(d, open(p,'w'))"
open_file "$STAND/clean.rb"
palette_run "DocScribe: Check current file"
palette_run "DocScribe: Doctor"
cp /tmp/gui-qa-settings.bak "$SET"
pageup 4
assert_ocr "2d5-top" "Server mode: Available" || return 1
pagedown 2
assert_ocr "2d5" "Backend: CLI" || return 1
shot "2d5b"
ocr_text | grep -qi "disabled in settings" || return 1
return 0
