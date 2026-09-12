#!/bin/zsh
# 2A.8: broken commandPath -> error toast + status error. Settings restored after.
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
STAND="${STAND:-$HOME/qa-stand}"
SET="$HOME/Library/Application Support/Code/User/settings.json"

activate
cp "$SET" /tmp/gui-qa-settings.bak
python3 -c "import json; p='$SET'; d=json.load(open(p)); d['docscribe.commandPath']='/nonexistent/xyz'; d['docscribe.useServer']=False; json.dump(d, open(p,'w'))"
mkstand
open_file "$STAND/gui-undoc.rb"
palette_run "DocScribe: Check current file"
cp /tmp/gui-qa-settings.bak "$SET"
rmstand
assert_ocr "2a8" "see output for details" || return 1
shot "2a8-status"
ocr_text | grep -qi "DocScribe: error" || return 1
return 0
