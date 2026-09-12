#!/bin/zsh
# 2A.2: Doctor with no project root reports it quietly.
# Single-window discipline: close the stand window first, reopen after.
# Workspace Trust is disabled via settings for this case only (restored after).
source "$(dirname "$0")/../actions.sh"
source "$(dirname "$0")/../assert.sh"
SET="$HOME/Library/Application Support/Code/User/settings.json"

mkdir -p /tmp/qempty
printf 'hello\n' > /tmp/qempty/note.txt
cp "$SET" /tmp/gui-qa-settings.bak
python3 -c "import json; p='$SET'; d=json.load(open(p)); d['security.workspace.trust.enabled']=False; json.dump(d, open(p,'w'))"
activate
osascript -e 'tell application "System Events" to keystroke "w" using {command down, shift down}'
sleep 2
code -n /tmp/qempty >/dev/null 2>&1
sleep 3
activate
palette_run "Reload Window"
sleep 4
palette_run "DocScribe: Doctor"
rc=0
assert_ocr "2a2" "Not found" || rc=1
cp /tmp/gui-qa-settings.bak "$SET"
code --reuse-window "$HOME/qa-stand" >/dev/null 2>&1
sleep 2
return $rc
